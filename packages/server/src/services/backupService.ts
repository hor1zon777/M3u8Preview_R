import { Writable } from 'stream';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { prisma } from '../lib/prisma.js';
import { invalidateRateLimitSettingCache } from '../middleware/conditionalRateLimit.js';
import { AppError } from '../middleware/errorHandler.js';
import type { RestoreResult } from '@m3u8-preview/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, '../../uploads');

export interface ExportOptions {
  includePosters?: boolean;
}

export const backupService = {
  async exportBackup(outputStream: Writable, options: ExportOptions = {}): Promise<void> {
    const { includePosters = true } = options;
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(outputStream);

    // 并行查询所有表
    const [
      users,
      categories,
      tags,
      media,
      mediaTags,
      favorites,
      playlists,
      playlistItems,
      watchHistory,
      importLogs,
      rawSystemSettings,
    ] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          username: true,
          passwordHash: true,
          role: true,
          avatar: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.category.findMany(),
      prisma.tag.findMany(),
      prisma.media.findMany(),
      prisma.mediaTag.findMany(),
      prisma.favorite.findMany(),
      prisma.playlist.findMany(),
      prisma.playlistItem.findMany(),
      prisma.watchHistory.findMany(),
      prisma.importLog.findMany(),
      prisma.systemSetting.findMany(),
    ]);

    const systemSettings = rawSystemSettings.filter(setting => setting.key !== 'enableRateLimit');

    const backupData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      tables: {
        users,
        categories,
        tags,
        media,
        mediaTags,
        favorites,
        playlists,
        playlistItems,
        watchHistory,
        importLogs,
        systemSettings,
      },
    };

    // 添加 backup.json
    archive.append(JSON.stringify(backupData, null, 2), { name: 'backup.json' });

    // 添加 uploads 目录
    if (fs.existsSync(uploadsDir)) {
      if (includePosters) {
        archive.directory(uploadsDir, 'uploads');
      } else {
        // 不包含封面：排除 posters 子目录，仅打包其余上传文件
        const postersSubdir = path.join(uploadsDir, 'posters');
        const children = fs.readdirSync(uploadsDir);
        for (const child of children) {
          const childPath = path.join(uploadsDir, child);
          if (childPath === postersSubdir) continue;
          const stat = fs.statSync(childPath);
          if (stat.isDirectory()) {
            archive.directory(childPath, `uploads/${child}`);
          } else {
            archive.file(childPath, { name: `uploads/${child}` });
          }
        }
      }
    }

    await archive.finalize();
  },

  async importBackup(zipBuffer: Buffer): Promise<RestoreResult> {
    const startTime = Date.now();

    // 解析 ZIP
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch {
      throw new AppError('无法解析 ZIP 文件，请确认文件格式正确', 400);
    }

    // zip-bomb 防护：累计未压缩大小不得超过 MAX_UNCOMPRESSED_SIZE
    const MAX_UNCOMPRESSED_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
    const MAX_ENTRIES = 50000;
    const entries = zip.getEntries();
    if (entries.length > MAX_ENTRIES) {
      throw new AppError('ZIP 包含过多条目，疑似异常文件', 400);
    }
    let totalUncompressed = 0;
    for (const entry of entries) {
      totalUncompressed += entry.header.size;
      if (totalUncompressed > MAX_UNCOMPRESSED_SIZE) {
        throw new AppError('ZIP 解压后体积过大，疑似 zip-bomb', 400);
      }
    }

    // 读取 backup.json
    const backupEntry = zip.getEntry('backup.json');
    if (!backupEntry) {
      throw new AppError('ZIP 文件中缺少 backup.json', 400);
    }

    let backupData: any;
    try {
      backupData = JSON.parse(backupEntry.getData().toString('utf-8'));
    } catch {
      throw new AppError('backup.json 格式无效', 400);
    }

    // 校验结构
    if (!backupData.version || !backupData.tables) {
      throw new AppError('backup.json 结构不完整，缺少 version 或 tables', 400);
    }

    // 严格 version 白名单（未来升级格式时新增版本）
    const SUPPORTED_VERSIONS = new Set(['1.0']);
    if (!SUPPORTED_VERSIONS.has(String(backupData.version))) {
      throw new AppError(
        `不支持的备份版本 ${backupData.version}，当前支持: ${[...SUPPORTED_VERSIONS].join(', ')}`,
        400,
      );
    }

    const requiredTables = [
      'users', 'categories', 'tags', 'media', 'mediaTags',
      'favorites', 'playlists', 'playlistItems', 'watchHistory',
      'importLogs', 'systemSettings',
    ];
    for (const table of requiredTables) {
      if (!Array.isArray(backupData.tables[table])) {
        throw new AppError(`backup.json 中缺少表: ${table}`, 400);
      }
    }

    const tables = backupData.tables;

    // ── 字段白名单工具 ──
    // 每个表只接受已知列，抵御注入额外字段（攻击扩面或适配新 schema）
    const USER_FIELDS = ['id', 'username', 'passwordHash', 'role', 'avatar', 'isActive', 'createdAt', 'updatedAt'] as const;
    const CATEGORY_FIELDS = ['id', 'name', 'slug', 'posterUrl', 'createdAt', 'updatedAt'] as const;
    const TAG_FIELDS = ['id', 'name', 'createdAt', 'updatedAt'] as const;
    const MEDIA_FIELDS = ['id', 'title', 'm3u8Url', 'posterUrl', 'description', 'year', 'rating', 'duration', 'artist', 'views', 'status', 'categoryId', 'createdAt', 'updatedAt'] as const;
    const MEDIA_TAG_FIELDS = ['mediaId', 'tagId'] as const;
    const FAVORITE_FIELDS = ['id', 'userId', 'mediaId', 'createdAt'] as const;
    const PLAYLIST_FIELDS = ['id', 'name', 'description', 'posterUrl', 'userId', 'isPublic', 'createdAt', 'updatedAt'] as const;
    const PLAYLIST_ITEM_FIELDS = ['id', 'playlistId', 'mediaId', 'position', 'createdAt'] as const;
    const WATCH_HISTORY_FIELDS = ['id', 'userId', 'mediaId', 'progress', 'duration', 'percentage', 'completed', 'createdAt', 'updatedAt'] as const;
    const IMPORT_LOG_FIELDS = ['id', 'userId', 'format', 'fileName', 'totalCount', 'successCount', 'failedCount', 'status', 'errors', 'createdAt'] as const;
    const SYSTEM_SETTING_FIELDS = ['key', 'value', 'updatedAt'] as const;
    const ALLOWED_ROLES = new Set(['USER', 'ADMIN']);
    const ALLOWED_SETTING_KEYS = new Set(['siteName', 'allowRegistration', 'enableRateLimit']);

    function pickFields<T extends Record<string, unknown>>(row: unknown, fields: readonly string[]): Partial<T> {
      if (!row || typeof row !== 'object') return {};
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        if (f in (row as Record<string, unknown>)) {
          out[f] = (row as Record<string, unknown>)[f];
        }
      }
      return out as Partial<T>;
    }

    function sanitizeRows(rows: unknown[], fields: readonly string[]): Record<string, unknown>[] {
      return rows.map((r) => pickFields(r, fields));
    }

    // users：白名单 + role 值校验 + 强制类型，防止注入未知字段、非法 role
    const sanitizedUsers = tables.users.map((u: unknown) => {
      const picked = pickFields<{ username: string; role: string; isActive: boolean }>(u, USER_FIELDS);
      if (typeof picked.username !== 'string' || picked.username.length === 0) {
        throw new AppError('users 表存在非法记录（username 缺失）', 400);
      }
      if (typeof picked.role !== 'string' || !ALLOWED_ROLES.has(picked.role)) {
        throw new AppError(`users 表存在非法 role: ${String(picked.role)}`, 400);
      }
      if (typeof picked.isActive !== 'boolean') {
        picked.isActive = true;
      }
      return picked;
    });

    // media：白名单 + m3u8Url 协议校验（防止通过备份恢复注入内网 URL 绕过代理 SSRF 防护）
    const sanitizedMedia = tables.media.map((m: unknown) => {
      const picked = pickFields<{ m3u8Url: string; title: string }>(m, MEDIA_FIELDS);
      if (typeof picked.m3u8Url === 'string' && !/^https?:\/\//i.test(picked.m3u8Url)) {
        throw new AppError('media 表存在非法 m3u8Url（仅允许 HTTP/HTTPS）', 400);
      }
      return picked;
    });

    const sanitizedCategories = sanitizeRows(tables.categories, CATEGORY_FIELDS);
    const sanitizedTags = sanitizeRows(tables.tags, TAG_FIELDS);
    const sanitizedMediaTags = sanitizeRows(tables.mediaTags, MEDIA_TAG_FIELDS);
    const sanitizedFavorites = sanitizeRows(tables.favorites, FAVORITE_FIELDS);
    const sanitizedPlaylists = sanitizeRows(tables.playlists, PLAYLIST_FIELDS);
    const sanitizedPlaylistItems = sanitizeRows(tables.playlistItems, PLAYLIST_ITEM_FIELDS);
    const sanitizedWatchHistory = sanitizeRows(tables.watchHistory, WATCH_HISTORY_FIELDS);
    const sanitizedImportLogs = sanitizeRows(tables.importLogs, IMPORT_LOG_FIELDS);
    const sanitizedSystemSettings = tables.systemSettings
      .map((s: unknown) => pickFields<{ key: string; value: string }>(s, SYSTEM_SETTING_FIELDS))
      .filter((s: Record<string, unknown>) => typeof s.key === 'string' && ALLOWED_SETTING_KEYS.has(s.key as string));

    let totalRecords = 0;

    // 在事务中执行清空 + 写入
    await prisma.$transaction(async (tx) => {
      // 删除阶段（逆外键依赖顺序）
      await tx.playlistItem.deleteMany();
      await tx.watchHistory.deleteMany();
      await tx.favorite.deleteMany();
      await tx.mediaTag.deleteMany();
      await tx.playlist.deleteMany();
      await tx.importLog.deleteMany();
      await tx.media.deleteMany();
      await tx.tag.deleteMany();
      await tx.category.deleteMany();
      await tx.systemSetting.deleteMany();
      await tx.refreshToken.deleteMany();
      await tx.user.deleteMany();

      // 写入阶段（正序，先写无依赖的表）
      if (sanitizedUsers.length > 0) {
        await tx.user.createMany({ data: sanitizedUsers as never });
        totalRecords += sanitizedUsers.length;
      }

      if (sanitizedCategories.length > 0) {
        await tx.category.createMany({ data: sanitizedCategories as never });
        totalRecords += sanitizedCategories.length;
      }

      if (sanitizedTags.length > 0) {
        await tx.tag.createMany({ data: sanitizedTags as never });
        totalRecords += sanitizedTags.length;
      }

      if (sanitizedMedia.length > 0) {
        await tx.media.createMany({ data: sanitizedMedia as never });
        totalRecords += sanitizedMedia.length;
      }

      if (sanitizedMediaTags.length > 0) {
        await tx.mediaTag.createMany({ data: sanitizedMediaTags as never });
        totalRecords += sanitizedMediaTags.length;
      }

      if (sanitizedFavorites.length > 0) {
        await tx.favorite.createMany({ data: sanitizedFavorites as never });
        totalRecords += sanitizedFavorites.length;
      }

      if (sanitizedPlaylists.length > 0) {
        await tx.playlist.createMany({ data: sanitizedPlaylists as never });
        totalRecords += sanitizedPlaylists.length;
      }

      if (sanitizedPlaylistItems.length > 0) {
        await tx.playlistItem.createMany({ data: sanitizedPlaylistItems as never });
        totalRecords += sanitizedPlaylistItems.length;
      }

      if (sanitizedWatchHistory.length > 0) {
        await tx.watchHistory.createMany({ data: sanitizedWatchHistory as never });
        totalRecords += sanitizedWatchHistory.length;
      }

      if (sanitizedImportLogs.length > 0) {
        await tx.importLog.createMany({ data: sanitizedImportLogs as never });
        totalRecords += sanitizedImportLogs.length;
      }

      // systemSettings 使用 upsert（主键为 key 字符串）
      for (const setting of sanitizedSystemSettings) {
        if (setting.key === 'enableRateLimit') {
          continue;
        }

        await tx.systemSetting.upsert({
          where: { key: setting.key as string },
          update: { value: setting.value as string },
          create: { key: setting.key as string, value: setting.value as string },
        });
        totalRecords++;
      }

      await tx.systemSetting.upsert({
        where: { key: 'enableRateLimit' },
        update: { value: 'true' },
        create: { key: 'enableRateLimit', value: 'true' },
      });
      totalRecords++;
    }, { timeout: 60000 });

    // 事务成功后恢复上传文件（文件系统不支持事务）
    let uploadsRestored = 0;
    const uploadEntries = zip.getEntries().filter(
      (e) => e.entryName.startsWith('uploads/') && !e.isDirectory,
    );

    if (uploadEntries.length > 0) {
      // 清空 uploads 目录内容（仅删除子项，保留目录本身，避免 Docker 卷挂载点无法删除的问题）
      if (fs.existsSync(uploadsDir)) {
        for (const child of fs.readdirSync(uploadsDir)) {
          fs.rmSync(path.join(uploadsDir, child), { recursive: true, force: true });
        }
      } else {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      for (const entry of uploadEntries) {
        // 去掉 "uploads/" 前缀，剩余部分作为相对路径；拒绝含绝对路径 / 穿越的条目
        const rawName = entry.entryName;
        if (!rawName.startsWith('uploads/')) continue;
        const relativeName = rawName.slice('uploads/'.length);
        if (relativeName.length === 0) continue;

        // 规范化：不允许绝对路径、盘符、反斜杠分隔符
        if (
          path.isAbsolute(relativeName) ||
          /^[a-zA-Z]:[\\/]/.test(relativeName) ||
          relativeName.includes('\\')
        ) {
          continue;
        }

        const targetPath = path.join(uploadsDir, relativeName);
        const rel = path.relative(uploadsDir, targetPath);
        // rel 不得以 '..' 开头、不得包含段级 '..'、不得为绝对路径
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).includes('..')) {
          continue;
        }

        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(targetPath, entry.getData());
        uploadsRestored++;
      }
    }

    invalidateRateLimitSettingCache();

    const tablesRestored = requiredTables.filter(
      (t) => tables[t] && tables[t].length > 0,
    ).length;

    return {
      tablesRestored,
      totalRecords,
      uploadsRestored,
      duration: Math.round((Date.now() - startTime) / 1000),
    };
  },
};
