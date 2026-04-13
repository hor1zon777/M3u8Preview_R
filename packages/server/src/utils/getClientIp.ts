import { Request } from 'express';

/**
 * 从 Express 请求中提取真实客户端 IP。
 * 支持多种场景：直连、nginx 代理、CDN（Cloudflare/AWS CloudFront 等）
 *
 * 优先级:
 * 1. CF-Connecting-IP (Cloudflare)
 * 2. True-Client-IP (Cloudflare Enterprise / Akamai)
 * 3. X-Real-IP (nginx / 通用代理)
 * 4. X-Forwarded-For 第一个 IP (标准代理头)
 * 5. req.ip / req.socket.remoteAddress (直连)
 */
export function getClientIp(req: Request): string {
  // 调试日志：打印所有相关头信息
  if (process.env.NODE_ENV !== 'production') {
    console.log('[getClientIp] Headers:', {
      'cf-connecting-ip': req.headers['cf-connecting-ip'],
      'true-client-ip': req.headers['true-client-ip'],
      'x-real-ip': req.headers['x-real-ip'],
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'req.ip': req.ip,
      'socket.remoteAddress': req.socket?.remoteAddress,
    });
  }

  // Cloudflare CDN
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string' && isValidIp(cfConnectingIp)) {
    return cfConnectingIp;
  }

  // Cloudflare Enterprise / Akamai
  const trueClientIp = req.headers['true-client-ip'];
  if (typeof trueClientIp === 'string' && isValidIp(trueClientIp)) {
    return trueClientIp;
  }

  // nginx / 通用代理
  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string' && isValidIp(xRealIp)) {
    return xRealIp;
  }

  // 标准代理头（可能包含多个 IP，取第一个）
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const firstIp = forwarded.split(',')[0].trim();
    if (isValidIp(firstIp)) {
      return firstIp;
    }
  }

  // 直连或其他情况
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  // 过滤本地回环地址
  if (isValidIp(ip)) {
    return ip;
  }

  return 'unknown';
}

/**
 * 验证 IP 地址是否有效（非本地回环地址）
 */
function isValidIp(ip: string): boolean {
  if (!ip || ip === 'unknown') return false;

  // 过滤本地回环地址
  const localAddresses = [
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'localhost'
  ];

  return !localAddresses.includes(ip);
}
