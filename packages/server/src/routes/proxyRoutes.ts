import { Router } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signProxyUrl, verifyProxySignature } from '../utils/proxySign.js';
import { conditionalRateLimit } from '../middleware/conditionalRateLimit.js';
import { isPrivateHostname, validateResolvedIp, safeFetch } from '../utils/ssrfGuard.js';

const router = Router();

// 代理端点独立限流：每 IP 每 15 分钟最多 1500 次
// 一个 HLS 视频约 200-500 个 segment，切换清晰度/视频需要更多余量
const proxyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '代理请求过于频繁，请稍后再试' },
});

router.use(conditionalRateLimit(proxyLimiter));

// 签名端点独立限流：每 IP 每 15 分钟最多 60 次（正常使用每次播放只需 1 次签名）
const signLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '签名请求过于频繁，请稍后再试' },
});

// ==================== TTL 缓存工具 ====================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * 简易 TTL 内存缓存
 * - 读取时惰性淘汰过期条目
 * - 定时批量清理防内存泄漏
 */
class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(ttlMs: number, cleanupIntervalMs?: number) {
    this.ttlMs = ttlMs;
    // 默认每 10 分钟清理一次过期条目
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs ?? 600_000);
    // 不阻止进程退出
    this.cleanupTimer.unref();
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

// DNS 解析结果缓存：5 分钟 TTL（平衡安全性和性能）
const dnsCache = new TtlCache<true>(5 * 60 * 1000);

// 已验证的域名白名单缓存：10 分钟 TTL
const domainWhitelistCache = new TtlCache<true>(10 * 60 * 1000);

// 已验证的 m3u8 URL 缓存：10 分钟 TTL
const mediaUrlCache = new TtlCache<true>(10 * 60 * 1000);

// ==================== 安全校验 ====================

/** 允许代理的文件扩展名白名单（视频/HLS 相关；去掉图片类型，缩小 SSRF/代理滥用面） */
const ALLOWED_EXTENSIONS = new Set([
  '.m3u8', '.ts', '.m4s', '.mp4', '.aac', '.key',
]);

/** 提取路径最后一段的文件扩展名 */
function getPathExtension(pathname: string): string {
  const lastSegment = pathname.split('/').pop() || '';
  const cleanSegment = lastSegment.split('?')[0];
  const dotIndex = cleanSegment.lastIndexOf('.');
  return dotIndex >= 0 ? cleanSegment.slice(dotIndex).toLowerCase() : '';
}

/** DNS 解析结果缓存包装：命中缓存则跳过解析 */
async function validateResolvedIpCached(hostname: string): Promise<void> {
  if (dnsCache.get(hostname) !== undefined) return;
  await validateResolvedIp(hostname);
  dnsCache.set(hostname, true);
}

/** 校验代理 URL 合法性 */
async function validateProxyUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError('无效的 URL', 400);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError('仅支持 HTTP/HTTPS 协议', 400);
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new AppError('不允许代理内网地址', 403);
  }

  await validateResolvedIpCached(parsed.hostname);

  const ext = getPathExtension(parsed.pathname);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    throw new AppError('不支持代理此类型的资源', 400);
  }

  return parsed;
}

// ==================== m3u8 内容重写 ====================

/**
 * 重写 m3u8 playlist 中的相对/绝对路径为代理 URL
 * 所有重写出的 URL 均绑定传入 userId 签名，防止跨用户分享
 */
function rewriteM3u8Content(content: string, baseUrl: string, userId: string): string {
  const lines = content.split('\n');
  const proxyPrefix = '/api/v1/proxy/m3u8?url=';

  return lines
    .map(line => {
      const trimmed = line.trim();

      if (trimmed === '') return line;

      // 处理含 URI="..." 的标签
      if (trimmed.startsWith('#') && trimmed.includes('URI="')) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          const absoluteUrl = resolveUrl(uri, baseUrl);
          const signed = signProxyUrl(absoluteUrl, userId);
          return `URI="${proxyPrefix}${encodeURIComponent(absoluteUrl)}${signed}"`;
        });
      }

      if (trimmed.startsWith('#')) return line;

      const absoluteUrl = resolveUrl(trimmed, baseUrl);
      const signed = signProxyUrl(absoluteUrl, userId);
      return `${proxyPrefix}${encodeURIComponent(absoluteUrl)}${signed}`;
    })
    .join('\n');
}

/** 将可能的相对路径解析为绝对 URL */
function resolveUrl(url: string, baseUrl: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  try {
    return new URL(url, baseUrl).href;
  } catch {
    console.warn(`[proxy] 无法解析相对 URL: ${url}, base: ${baseUrl}`);
    return url;
  }
}

// ==================== 数据库校验（带缓存） ====================

/**
 * 校验数据库中是否存在该 m3u8Url 对应的媒体记录
 * @param userId 请求用户 ID（当前所有用户共享 ACTIVE 媒体，未来引入私有合集时在此处收紧权限）
 */
async function validateMediaExists(targetUrl: URL, userId: string): Promise<void> {
  const fullUrl = targetUrl.href;
  const cacheKey = `${userId}:${fullUrl}`;

  // 命中缓存直接返回
  if (mediaUrlCache.get(cacheKey) !== undefined) {
    return;
  }

  // 当前策略：所有登录用户均可访问 ACTIVE 媒体
  // 如引入隐私 playlist / VIP 合集，应在此处按 userId 做归属校验，例如：
  //   where: { m3u8Url, status: 'ACTIVE', OR: [{ ownerId: userId }, { visibility: 'PUBLIC' }] }
  const exactMatch = await prisma.media.findFirst({
    where: { m3u8Url: fullUrl, status: 'ACTIVE' },
    select: { id: true },
  });
  if (exactMatch) {
    mediaUrlCache.set(cacheKey, true);
    return;
  }

  // 回退：去掉查询参数后匹配
  const urlWithoutSearch = `${targetUrl.protocol}//${targetUrl.host}${targetUrl.pathname}`;
  const prefixMatch = await prisma.media.findFirst({
    where: {
      m3u8Url: { startsWith: urlWithoutSearch },
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  if (prefixMatch) {
    mediaUrlCache.set(cacheKey, true);
    return;
  }

  throw new AppError('未找到对应的媒体记录，拒绝代理', 403);
}

/** 校验 segment 请求的域名是否存在于数据库的某条 m3u8Url 中 */
async function validateSegmentDomain(targetUrl: URL): Promise<void> {
  const hostPrefix = `${targetUrl.protocol}//${targetUrl.host}`;

  // 命中缓存直接返回
  if (domainWhitelistCache.get(hostPrefix) !== undefined) {
    return;
  }

  const domainMatch = await prisma.media.findFirst({
    where: {
      m3u8Url: { startsWith: hostPrefix },
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  if (!domainMatch) {
    throw new AppError('未找到对应的媒体记录，拒绝代理', 403);
  }

  // 域名校验通过，缓存结果
  domainWhitelistCache.set(hostPrefix, true);
}

/** 判断 content-type 是否为 m3u8 类型 */
function isM3u8ContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  return (
    lower.includes('mpegurl') ||
    lower.includes('vnd.apple.mpegurl') ||
    lower === 'audio/mpegurl'
  );
}

function isSurritHostname(hostname: string): boolean {
  return hostname === 'surrit.com' || hostname.endsWith('.surrit.com');
}

// ==================== 路由处理器 ====================

/** 整体请求超时时间（含流式传输） */
const TOTAL_TIMEOUT_MS = 120_000;
/** fetch 连接超时时间 */
const CONNECT_TIMEOUT_MS = 15_000;

/**
 * GET /api/v1/proxy/sign?url=<encoded_url>
 * 为指定 m3u8 URL 生成带 HMAC 签名的代理入口 URL
 */
router.get('/sign', conditionalRateLimit(signLimiter), authenticate, asyncHandler(async (req, res) => {
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) {
    throw new AppError('缺少 url 参数', 400);
  }

  const userId = req.user?.userId;
  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const targetUrl = await validateProxyUrl(rawUrl);

  // 签名端点仅处理 m3u8 文件
  const pathname = targetUrl.pathname.toLowerCase();
  if (!pathname.endsWith('.m3u8')) {
    throw new AppError('签名端点仅支持 m3u8 URL', 400);
  }

  // 数据库校验：确保 URL 对应的媒体记录存在且用户有权访问
  await validateMediaExists(targetUrl, userId);

  const signedParams = signProxyUrl(rawUrl, userId);
  const proxyUrl = `/api/v1/proxy/m3u8?url=${encodeURIComponent(rawUrl)}${signedParams}`;

  res.json({ success: true, proxyUrl });
}));

/** 校验 Range 头格式，仅允许 bytes=<num>-<num?> */
function isValidRangeHeader(value: string): boolean {
  return /^bytes=\d+-\d*$/.test(value);
}

/**
 * GET /api/v1/proxy/m3u8?url=<encoded_url>
 * 代理外部 m3u8/ts 等媒体资源，解决 CORS 问题
 * 需要登录 + 签名（签名绑定登录用户）
 */
router.get('/m3u8', authenticate, asyncHandler(async (req, res) => {
  const rawUrl = req.query.url as string | undefined;
  if (!rawUrl) {
    throw new AppError('缺少 url 参数', 400);
  }

  const userId = req.user?.userId;
  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const targetUrl = await validateProxyUrl(rawUrl);

  // 签名验证（绑定 userId，防止签名被他人分享）
  const expires = req.query.expires as string | undefined;
  const sig = req.query.sig as string | undefined;
  if (!expires || !sig || !verifyProxySignature(rawUrl, expires, sig, userId)) {
    throw new AppError('签名无效或已过期', 403);
  }

  const pathname = targetUrl.pathname.toLowerCase();
  const isM3u8 = pathname.endsWith('.m3u8');

  // m3u8 入口 URL 的数据库校验已在 /sign 端点完成，此处跳过
  // segment 请求仍需校验域名白名单，防止恶意 m3u8 内容引用任意域名
  if (!isM3u8) {
    await validateSegmentDomain(targetUrl);
  }

  const shouldSendMissavReferer = isSurritHostname(targetUrl.hostname);

  // 校验并过滤 Range 头，防止畸形值转发给上游
  const rawRange = req.headers.range;
  const safeRange = typeof rawRange === 'string' && isValidRangeHeader(rawRange) ? rawRange : undefined;

  // 连接级别超时控制
  const connectController = new AbortController();
  const connectTimeout = setTimeout(() => connectController.abort(), CONNECT_TIMEOUT_MS);

  // 整体请求超时控制（含流式传输）
  const totalController = new AbortController();
  const totalTimeout = setTimeout(() => totalController.abort(), TOTAL_TIMEOUT_MS);

  connectController.signal.addEventListener('abort', () => totalController.abort());

  try {
    // safeFetch 使用 redirect: 'manual' + 每跳 DNS 校验，防止上游 302 到内网
    const response = await safeFetch(targetUrl.href, {
      signal: totalController.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(shouldSendMissavReferer ? { Referer: 'https://missav.ws' } : {}),
        Accept: '*/*',
        ...(safeRange ? { Range: safeRange } : {}),
      },
      maxRedirects: 3,
    });

    clearTimeout(connectTimeout);

    if (!response.ok) {
      clearTimeout(totalTimeout);
      res.status(response.status).json({
        success: false,
        error: `上游服务器返回 ${response.status}`,
      });
      return;
    }

    // 转发关键响应头
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      res.setHeader('Content-Range', contentRange);
      res.status(206);
    }

    // 缓存策略：签名绑定用户，必须禁止共享缓存，避免签名过期后 CDN 命中被他人复用
    if (isM3u8) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'private, max-age=600');
    }

    // 对 m3u8 内容进行路径重写
    const shouldRewrite = isM3u8 && isM3u8ContentType(contentType);
    if (shouldRewrite) {
      const body = await response.text();
      clearTimeout(totalTimeout);
      const rewritten = rewriteM3u8Content(body, targetUrl.href, userId);
      res.removeHeader('Content-Length');
      res.send(rewritten);
      return;
    }

    // 非 m3u8 内容：使用 Node.js stream pipeline 流式转发
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);

      req.on('close', () => {
        nodeStream.destroy();
        clearTimeout(totalTimeout);
      });

      totalController.signal.addEventListener('abort', () => {
        nodeStream.destroy(new Error('总超时'));
      });

      try {
        await pipeline(nodeStream, res);
      } finally {
        clearTimeout(totalTimeout);
      }
    } else {
      clearTimeout(totalTimeout);
      res.end();
    }
  } catch (error: unknown) {
    clearTimeout(connectTimeout);
    clearTimeout(totalTimeout);

    if (error instanceof Error && error.name === 'AbortError') {
      if (!res.headersSent) {
        res.status(504).json({ success: false, error: '代理请求超时' });
      }
      return;
    }

    throw error;
  }
}));

export default router;
