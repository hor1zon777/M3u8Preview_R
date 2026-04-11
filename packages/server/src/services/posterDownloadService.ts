import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const fsMkdir = promisify(fs.mkdir);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTERS_DIR = path.resolve(__dirname, '../../uploads/posters');

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const DOWNLOAD_TIMEOUT_MS = 15_000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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
