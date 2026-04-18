import { prisma } from '../lib/prisma.js';
import { importItemSchema } from '@m3u8-preview/shared';
import type { ImportItem, ImportPreviewResponse, ImportResult, ImportError } from '@m3u8-preview/shared';
import { AppError } from '../middleware/errorHandler.js';
import { parseText, parseCsv, parseJson, parseExcel } from '../parsers/index.js';
import { thumbnailQueue } from './thumbnailService.js';
import { resolveExternalPoster } from './posterDownloadService.js';

export const importService = {
  /**
   * 检测文件格式并解析为导入条目数组。
   * 从 importController 抽取到 service 层，保持 controller 只负责 HTTP 协议处理。
   */
  async detectFormatAndParse(file?: Express.Multer.File, body?: any): Promise<{ items: any[]; format: string; fileName?: string }> {
    // If file is provided, parse based on file extension
    if (file) {
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      const fileName = file.originalname;

      switch (ext) {
        case 'csv':
          return { items: parseCsv(file.buffer.toString('utf-8')), format: 'CSV', fileName };
        case 'xlsx':
          return { items: await parseExcel(file.buffer), format: 'EXCEL', fileName };
        case 'json':
          return { items: parseJson(file.buffer.toString('utf-8')), format: 'JSON', fileName };
        case 'txt':
          return { items: parseText(file.buffer.toString('utf-8')), format: 'TEXT', fileName };
        default:
          throw new AppError(`Unsupported file format: ${ext}`, 400);
      }
    }

    // If no file, parse from body content
    if (body?.content) {
      const format = body.format?.toUpperCase() || 'TEXT';
      switch (format) {
        case 'TEXT':
          return { items: parseText(body.content), format: 'TEXT' };
        case 'CSV':
          return { items: parseCsv(body.content), format: 'CSV' };
        case 'JSON':
          return { items: parseJson(body.content), format: 'JSON' };
        default:
          return { items: parseText(body.content), format: 'TEXT' };
      }
    }

    throw new AppError('No file or content provided', 400);
  },
  preview(items: ImportItem[]): ImportPreviewResponse {
    const errors: ImportError[] = [];
    let validCount = 0;

    items.forEach((item, index) => {
      const result = importItemSchema.safeParse(item);
      if (result.success) {
        validCount++;
      } else {
        result.error.errors.forEach(err => {
          errors.push({
            row: index + 1,
            field: err.path.join('.'),
            message: err.message,
          });
        });
      }
    });

    return {
      items,
      totalCount: items.length,
      validCount,
      invalidCount: items.length - validCount,
      errors,
    };
  },

  async execute(userId: string, items: ImportItem[], format: string, fileName?: string): Promise<ImportResult> {
    const errors: ImportError[] = [];
    let successCount = 0;
    const createdMediaForThumbnails: Array<{ mediaId: string; m3u8Url: string }> = [];

    // 预校验所有条目
    const validItems: { index: number; item: ImportItem }[] = [];
    for (let i = 0; i < items.length; i++) {
      const validation = importItemSchema.safeParse(items[i]);
      if (!validation.success) {
        validation.error.errors.forEach(err => {
          errors.push({ row: i + 1, field: err.path.join('.'), message: err.message });
        });
      } else {
        validItems.push({ index: i, item: items[i] });
      }
    }

    // 预收集所有唯一分类名和标签名
    const uniqueCategoryNames = new Set<string>();
    const uniqueTagNames = new Set<string>();
    for (const { item } of validItems) {
      if (item.categoryName) uniqueCategoryNames.add(item.categoryName);
      if (item.tagNames) item.tagNames.forEach(t => uniqueTagNames.add(t));
    }

    // 预下载外部封面图到本地（在事务外执行，避免长时间持锁）
    const posterUrlMap = new Map<number, string | null>();
    for (const { index, item } of validItems) {
      const resolved = await resolveExternalPoster(item.posterUrl);
      posterUrlMap.set(index, resolved);
    }

    try {
      await prisma.$transaction(async (tx) => {
        // 批量 upsert 分类，构建 name→id Map
        const categoryMap = new Map<string, string>();
        for (const name of uniqueCategoryNames) {
          let slug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          if (!slug) {
            // 对非 ASCII 名称使用简单哈希
            const hash = Array.from(name).reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0);
            slug = `cat-${Math.abs(hash).toString(36)}`;
          }
          const category = await tx.category.upsert({
            where: { name },
            update: {},
            create: { name, slug },
          });
          categoryMap.set(name, category.id);
        }

        // 批量 upsert 标签，构建 name→id Map
        const tagMap = new Map<string, string>();
        for (const name of uniqueTagNames) {
          const tag = await tx.tag.upsert({
            where: { name },
            update: {},
            create: { name },
          });
          tagMap.set(name, tag.id);
        }

        // 逐条创建 media 并批量关联标签
        for (const { index, item } of validItems) {
          try {
            const media = await tx.media.create({
              data: {
                title: item.title,
                m3u8Url: item.m3u8Url,
                posterUrl: posterUrlMap.get(index) ?? null,
                description: item.description || null,
                year: item.year || null,
                artist: item.artist || null,
                categoryId: item.categoryName ? (categoryMap.get(item.categoryName) || null) : null,
              },
            });

            // 批量创建 mediaTag 关联
            if (item.tagNames && item.tagNames.length > 0) {
              const tagData = item.tagNames
                .map(name => tagMap.get(name))
                .filter((id): id is string => !!id)
                .map(tagId => ({ mediaId: media.id, tagId }));
              if (tagData.length > 0) {
                await tx.mediaTag.createMany({ data: tagData });
              }
            }

            if (!media.posterUrl) {
              createdMediaForThumbnails.push({ mediaId: media.id, m3u8Url: media.m3u8Url });
            }

            successCount++;
          } catch (err: any) {
            errors.push({ row: index + 1, field: 'general', message: err.message || 'Unknown error' });
          }
        }
      });
    } catch (err: any) {
      // 事务整体失败时，所有有效条目都失败
      // 清空缩略图队列——事务回滚后 media 记录已不存在
      createdMediaForThumbnails.length = 0;
      successCount = 0;
      errors.push({ row: 0, field: 'transaction', message: err.message || 'Transaction failed' });
    }

    // Enqueue thumbnail generation for newly created media without posterUrl
    if (createdMediaForThumbnails.length > 0) {
      thumbnailQueue.enqueueBatch(createdMediaForThumbnails);
    }

    // Log the import
    const status = successCount === items.length ? 'SUCCESS' : successCount > 0 ? 'PARTIAL' : 'FAILED';
    await prisma.importLog.create({
      data: {
        userId,
        format,
        fileName: fileName || null,
        totalCount: items.length,
        successCount,
        failedCount: items.length - successCount,
        status,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
      },
    });

    return {
      totalCount: items.length,
      successCount,
      failedCount: items.length - successCount,
      errors,
    };
  },

  generateCsvTemplate(): string {
    return 'title,m3u8Url,posterUrl,description,year,artist,category,tags\n"\u793a\u4f8b\u89c6\u9891","https://example.com/video.m3u8","https://example.com/poster.jpg","\u89c6\u9891\u63cf\u8ff0",2024,"\u5f20\u4e09","\u7535\u5f71","\u52a8\u4f5c,\u79d1\u5e7b"\n';
  },

  generateJsonTemplate(): string {
    return JSON.stringify([
      {
        title: '\u793a\u4f8b\u89c6\u9891',
        m3u8Url: 'https://example.com/video.m3u8',
        posterUrl: 'https://example.com/poster.jpg',
        description: '\u89c6\u9891\u63cf\u8ff0',
        year: 2024,
        artist: '\u5f20\u4e09',
        categoryName: '\u7535\u5f71',
        tagNames: ['\u52a8\u4f5c', '\u79d1\u5e7b'],
      },
    ], null, 2);
  },

  /**
   * 获取导入日志列表
   */
  async getLogs(limit: number = 50) {
    const logs = await prisma.importLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return logs.map(log => ({
      ...log,
      createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : log.createdAt,
    }));
  },
};
