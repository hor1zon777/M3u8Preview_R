import { Request } from 'express';
import { config } from '../config.js';

/**
 * 从 Express 请求中提取真实客户端 IP。
 *
 * 链路与信任模型：
 *  1. 无 CDN（默认）：client -> nginx -> node
 *     nginx 显式 `proxy_set_header X-Forwarded-For $remote_addr`（覆盖客户端传入值）
 *     Express `trust proxy` 设为 1，req.ip 即为客户端真实 IP。
 *     此模式下必须忽略 CF-Connecting-IP / True-Client-IP（客户端可伪造）。
 *
 *  2. 有 CDN（TRUST_CDN=true）：client -> CDN -> nginx -> node
 *     CDN 覆盖 XFF/加 CF-Connecting-IP；nginx 看到的 remote_addr 是 CDN 边缘节点，
 *     所以 req.ip 拿不到真实客户端，必须从 CDN 回源头读。
 *     仅在站点确实部署在 CDN 后启用 TRUST_CDN，否则攻击者可伪造这些头旁路限流。
 */
export function getClientIp(req: Request): string {
  if (config.trustCdn) {
    // Cloudflare
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && isValidIp(cf)) return normalize(cf);

    // Cloudflare Enterprise / Akamai
    const trueClient = req.headers['true-client-ip'];
    if (typeof trueClient === 'string' && isValidIp(trueClient)) return normalize(trueClient);
  }

  // 非 CDN 模式：严格只用 Express 根据 trust proxy 解析出的 req.ip
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!ip || ip === 'unknown') return 'unknown';
  return normalize(ip);
}

/** 规范化 IPv4-mapped IPv6：::ffff:1.2.3.4 -> 1.2.3.4 */
function normalize(ip: string): string {
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : ip;
}

function isValidIp(ip: string): boolean {
  if (!ip || ip === 'unknown') return false;
  // 过滤常见本地回环（CDN 头不应该是这些值）
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '0.0.0.0'];
  return !local.includes(ip);
}
