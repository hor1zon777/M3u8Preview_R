import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { prisma } from '../lib/prisma.js';

const fsMkdir = promisify(fs.mkdir);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTERS_DIR = path.resolve(__dirname, '../../uploads/posters');

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const DOWNLOAD_TIMEOUT_MS = 15_000;
/** 每分钟最多下载封面数（出站请求速率限制） */
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─── 令牌桶速率限制器（控制出站封面下载频率） ─────────────────
class TokenBucketRateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;
  private lastRefillTime: number;
  private readonly waitQueue: Array<() => void> = [];

  constructor(maxTokens: number, windowMs: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillIntervalMs = windowMs / maxTokens;
    this.lastRefillTime = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    const newTokens = Math.floor(elapsed / this.refillIntervalMs);
    if (newTokens > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
      this.lastRefillTime += newTokens * this.refillIntervalMs;
    }
  }

  private drainQueue(): void {
    while (this.waitQueue.length > 0) {
      this.refill();
      if (this.tokens <= 0) break;
      this.tokens--;
      const resolve = this.waitQueue.shift()!;
      resolve();
    }
  }

  /** 获取一个令牌，令牌不足时等待直到可用 */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
      const waitMs = this.refillIntervalMs;
      setTimeout(() => this.drainQueue(), waitMs);
    });
  }
}

const downloadRateLimiter = new TokenBucketRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

/** 判断 posterUrl 是否为外部 URL（http/https 开头） */
export function isExternalUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/** 提取路径最后一段的文件扩展名 */
function getPathExtension(pathname: string): string {
  const lastSegment = pathname.split('/').pop() || '';
  const cleanSegment = lastSegment.split('?')[0];
  const dotIndex = cleanSegment.lastIndexOf('.');
  return dotIndex >= 0 ? cleanSegment.slice(dotIndex).toLowerCase() : '';
}

/** 根据域名判断是否需要特殊 Referer */
function getRefererForHost(hostname: string): string | undefined {
  const lower = hostname.toLowerCase();
  if (lower === 'fourhoi.com' || lower.endsWith('.fourhoi.com') ||
      lower === 'surrit.com' || lower.endsWith('.surrit.com')) {
    return 'https://missav.ws';
  }
  return undefined;
}

/** 从 Content-Type 推断扩展名 */
function extFromContentType(contentType: string): string | null {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  return map[mime] ?? null;
}

async function ensureDir() {
  await fsMkdir(POSTERS_DIR, { recursive: true });
}

/**
 * 下载外部图片到 uploads/posters/ 目录
 * @returns 本地路径如 /uploads/posters/{uuid}.jpg，下载失败返回 null
 */
export async function downloadPoster(externalUrl: string): Promise<string | null> {
  try {
    const parsed = new URL(externalUrl);

    // 从 URL 路径推断扩展名
    let ext = getPathExtension(parsed.pathname);
    const referer = getRefererForHost(parsed.hostname);

    await ensureDir();

    // 等待速率限制令牌（每分钟最多 100 次出站请求）
    await downloadRateLimiter.acquire();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    try {
      const response = await fetch(parsed.href, {
        signal: controller.signal,
        headers: {
          'User-Agent': UA,
          Accept: 'image/*',
          ...(referer ? { Referer: referer } : {}),
        },
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`[PosterDownload] HTTP ${response.status} for ${externalUrl}`);
        return null;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        console.warn(`[PosterDownload] 非图片类型 ${contentType} for ${externalUrl}`);
        return null;
      }

      // 如果 URL 路径没有扩展名或扩展名不在白名单，则从 Content-Type 推断
      if (!ext || !ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        ext = extFromContentType(contentType) || '.jpg';
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_FILE_SIZE) {
        console.warn(`[PosterDownload] 文件过大 ${contentLength} bytes for ${externalUrl}`);
        return null;
      }

      const filename = `${randomUUID()}${ext}`;
      const outputPath = path.join(POSTERS_DIR, filename);
      const localUrl = `/uploads/posters/${filename}`;

      if (!response.body) {
        return null;
      }

      const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
      const fileStream = fs.createWriteStream(outputPath);

      // 限制实际写入大小
      let bytesWritten = 0;
      nodeStream.on('data', (chunk: Buffer) => {
        bytesWritten += chunk.length;
        if (bytesWritten > MAX_FILE_SIZE) {
          nodeStream.destroy(new Error('文件大小超过限制'));
        }
      });

      await pipeline(nodeStream, fileStream);

      console.log(`[PosterDownload] 已下载 ${externalUrl} -> ${localUrl} (${bytesWritten} bytes)`);
      return localUrl;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  } catch (err) {
    console.error(`[PosterDownload] 下载失败 ${externalUrl}:`, err);
    return null;
  }
}

/**
 * 如果 posterUrl 是外部 URL，下载到本地并返回本地路径；否则原样返回。
 * 下载失败时返回原 URL（不阻塞业务流程）。
 */
export async function resolveExternalPoster(posterUrl: string | null | undefined): Promise<string | null> {
  if (!posterUrl) return null;
  if (!isExternalUrl(posterUrl)) return posterUrl;

  const localPath = await downloadPoster(posterUrl);
  return localPath ?? posterUrl;
}

// ─── 后台封面迁移队列 ───────────────────────────────────────

class PosterMigrationQueue {
  private queue: Array<{ id: string; posterUrl: string }> = [];
  private active = 0;
  private readonly concurrency: number;
  private processing = false;
  private completed = 0;
  private failed = 0;
  private skipped = 0;
  private total = 0;

  constructor() {
    const envVal = parseInt(process.env.POSTER_MIGRATION_CONCURRENCY || '', 10);
    this.concurrency = envVal > 0 && envVal <= 10 ? envVal : 2;
  }

  /** 将待迁移的媒体记录批量入队 */
  enqueueBatch(items: Array<{ id: string; posterUrl: string }>) {
    this.queue.push(...items);
    this.total += items.length;
    this.process();
  }

  getStatus() {
    return {
      pending: this.queue.length,
      active: this.active,
      completed: this.completed,
      failed: this.failed,
      skipped: this.skipped,
      total: this.total,
      concurrency: this.concurrency,
      running: this.processing || this.active > 0,
    };
  }

  private async process() {
    this.processing = true;
    while (this.active < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active++;
      this.migrateOne(item)
        .finally(() => {
          this.active--;
          this.process();
        });
    }
    if (this.active === 0 && this.queue.length === 0) {
      this.processing = false;
      console.log(
        `[PosterMigration] 迁移完成: 成功 ${this.completed}, 失败 ${this.failed}, 跳过 ${this.skipped}, 总计 ${this.total}`,
      );
    }
  }

  private async migrateOne(item: { id: string; posterUrl: string }) {
    try {
      const localPath = await downloadPoster(item.posterUrl);
      if (!localPath) {
        // 下载失败，保持原 URL 不变
        this.failed++;
        return;
      }

      await prisma.media.update({
        where: { id: item.id },
        data: { posterUrl: localPath },
      });

      this.completed++;
      console.log(`[PosterMigration] ${item.id}: ${item.posterUrl} -> ${localPath}`);
    } catch (err) {
      this.failed++;
      console.error(`[PosterMigration] 迁移失败 ${item.id}:`, err);
    }
  }
}

export const posterMigrationQueue = new PosterMigrationQueue();

/**
 * 查询所有 posterUrl 为外部 URL 的 ACTIVE 媒体，批量入队下载到本地。
 * @returns 入队数量
 */
export async function migrateExternalPosters(): Promise<number> {
  const externals = await prisma.media.findMany({
    where: {
      status: 'ACTIVE',
      posterUrl: { not: null },
      OR: [
        { posterUrl: { startsWith: 'http://' } },
        { posterUrl: { startsWith: 'https://' } },
      ],
    },
    select: { id: true, posterUrl: true },
  });

  if (externals.length === 0) {
    console.log('[PosterMigration] 没有需要迁移的外部封面');
    return 0;
  }

  const items = externals
    .filter((m): m is { id: string; posterUrl: string } => m.posterUrl !== null)
    .map(m => ({ id: m.id, posterUrl: m.posterUrl }));

  posterMigrationQueue.enqueueBatch(items);
  console.log(`[PosterMigration] 已入队 ${items.length} 个外部封面待迁移`);
  return items.length;
}
