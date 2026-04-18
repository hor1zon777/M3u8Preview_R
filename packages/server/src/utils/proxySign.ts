import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * 为代理 URL 生成 HMAC-SHA256 签名参数。
 * 签名与用户身份绑定：相同 URL 对不同用户产生不同签名，防止签名被他人分享滥用。
 * @param url 目标 URL
 * @param userId 签名归属用户 ID（调用方必须保证非空）
 * @returns 查询参数字符串 `&expires=T&sig=S`
 */
export function signProxyUrl(url: string, userId: string): string {
  const expires = Math.floor(Date.now() / 1000) + config.proxy.signatureTtl;
  const sig = computeSignature(url, String(expires), userId);
  return `&expires=${expires}&sig=${sig}`;
}

/**
 * 验证代理 URL 的 HMAC 签名
 * - 校验 expires 未过期
 * - 校验与当前用户绑定
 * - 使用 crypto.timingSafeEqual 防时序攻击
 */
export function verifyProxySignature(
  url: string,
  expires: string,
  sig: string,
  userId: string,
): boolean {
  // 校验过期时间
  const expiresNum = Number(expires);
  if (!Number.isFinite(expiresNum) || expiresNum < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = computeSignature(url, expires, userId);

  // 对两个值取 SHA-256 hash 后再比较，消除长度不等时的时序泄露
  const sigHash = crypto.createHash('sha256').update(sig).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();

  return crypto.timingSafeEqual(sigHash, expectedHash);
}

/** 计算 HMAC-SHA256(secret, url + "\n" + expires + "\n" + userId) */
function computeSignature(url: string, expires: string, userId: string): string {
  return crypto
    .createHmac('sha256', config.proxy.secret)
    .update(`${url}\n${expires}\n${userId}`)
    .digest('hex');
}
