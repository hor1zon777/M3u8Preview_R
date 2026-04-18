import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export type JwtPurpose = 'access' | 'refresh';

/**
 * 验证 JWT，并支持基于 header.kid 的密钥轮换。
 *
 * 选择规则：
 *   - 若 token header.kid 与 config.jwt.kid 相同，或 kid 缺失 → 使用当前主密钥
 *   - 若 token header.kid 与 config.jwt.kidPrev 相同，且配置了上一代密钥 → 使用上一代密钥（过渡期）
 *   - 其它情况一律拒绝
 */
export function verifyJwt<T = unknown>(token: string, purpose: JwtPurpose): T {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    throw new jwt.JsonWebTokenError('malformed token');
  }

  const kid = decoded.header.kid;
  const current = purpose === 'access' ? config.jwt.secret : config.jwt.refreshSecret;
  const prev = purpose === 'access' ? config.jwt.secretPrev : config.jwt.refreshSecretPrev;

  let secret: string;
  if (!kid || kid === config.jwt.kid) {
    secret = current;
  } else if (config.jwt.kidPrev && kid === config.jwt.kidPrev && prev) {
    secret = prev;
  } else {
    throw new jwt.JsonWebTokenError('unknown kid');
  }

  return jwt.verify(token, secret, { algorithms: ['HS256'] }) as T;
}
