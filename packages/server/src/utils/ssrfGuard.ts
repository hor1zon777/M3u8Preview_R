import dns from 'node:dns/promises';
import { AppError } from '../middleware/errorHandler.js';

/**
 * 通用 SSRF 防护 / 安全 fetch 工具
 * 同时支持：
 *  - hostname 字符串级检查（localhost/私有 IP/保留段）
 *  - DNS 解析后 IP 地址校验
 *  - 手动跟随重定向并对每一跳目标重新校验 DNS
 */

function isPrivateIp(ip: string): boolean {
  const v4Parts = ip.split('.').map(Number);
  if (v4Parts.length === 4 && v4Parts.every((p) => Number.isFinite(p) && p >= 0 && p <= 255)) {
    return (
      v4Parts[0] === 0 ||
      v4Parts[0] === 127 ||
      v4Parts[0] === 10 ||
      (v4Parts[0] === 172 && v4Parts[1] >= 16 && v4Parts[1] <= 31) ||
      (v4Parts[0] === 192 && v4Parts[1] === 168) ||
      (v4Parts[0] === 169 && v4Parts[1] === 254) ||
      (v4Parts[0] === 100 && v4Parts[1] >= 64 && v4Parts[1] <= 127) ||
      v4Parts[0] >= 224 // multicast & reserved
    );
  }
  return false;
}

export function isPrivateHostname(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (
    clean === 'localhost' ||
    clean === '127.0.0.1' ||
    clean === '0.0.0.0' ||
    clean === '::1' ||
    clean === '::ffff:127.0.0.1'
  ) {
    return true;
  }

  if (clean.endsWith('.local') || clean.endsWith('.internal') || clean.endsWith('.localhost')) {
    return true;
  }

  if (isPrivateIp(clean)) {
    return true;
  }

  const v4MappedMatch = clean.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4MappedMatch && isPrivateIp(v4MappedMatch[1])) {
    return true;
  }

  return false;
}

/** DNS 解析后校验所有 IPv4/IPv6 地址均不在私有段 */
export async function validateResolvedIp(hostname: string): Promise<void> {
  // IPv4
  try {
    const addresses = await dns.resolve4(hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        throw new AppError('不允许访问内网地址', 403);
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    // 忽略 ENOTFOUND，让 IPv6 接管
  }

  // IPv6
  try {
    const addresses = await dns.resolve6(hostname);
    for (const addr of addresses) {
      const clean = addr.replace(/^\[|\]$/g, '').toLowerCase();
      if (
        clean === '::1' ||
        clean.startsWith('fe80:') ||
        clean.startsWith('fc') ||
        clean.startsWith('fd')
      ) {
        throw new AppError('不允许访问内网地址', 403);
      }
      const v4Match = clean.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
      if (v4Match && isPrivateIp(v4Match[1])) {
        throw new AppError('不允许访问内网地址', 403);
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    // 忽略 ENOTFOUND（例如纯 v4 域名）
  }
}

/** 校验给定 URL 的协议和目标 IP 不在内网 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
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
    throw new AppError('不允许访问内网地址', 403);
  }

  await validateResolvedIp(parsed.hostname);
  return parsed;
}

export interface SafeFetchOptions extends Omit<RequestInit, 'redirect'> {
  /** 最多跟随几次重定向，默认 3 */
  maxRedirects?: number;
  /** 连接/整体超时对应的 AbortSignal（调用方自管） */
  signal?: AbortSignal;
}

/**
 * 在请求前对目标 URL 做 SSRF 校验，并以 `redirect: 'manual'` 模式手动跟随重定向，
 * 每一跳都重新校验 DNS，防止上游通过 302 到内网地址绕过检查。
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<Response> {
  const { maxRedirects = 3, ...rest } = options;

  let currentUrl = await assertSafeUrl(rawUrl);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(currentUrl.href, {
      ...rest,
      redirect: 'manual',
    });

    // fetch 在 redirect: 'manual' 下仍会使用 response.status 返回重定向状态
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return response; // 异常的 3xx 无 Location，原样返回交给调用方
      }
      if (hop >= maxRedirects) {
        throw new AppError('重定向次数过多', 502);
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        throw new AppError('重定向 Location 无效', 502);
      }
      // 每跳都要校验协议 + DNS
      currentUrl = await assertSafeUrl(nextUrl.href);
      continue;
    }

    return response;
  }

  // 理论上 maxRedirects 已经 cover，兜底
  throw new AppError('重定向次数过多', 502);
}
