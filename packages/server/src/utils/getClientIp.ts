import { Request } from 'express';

/**
 * 从 Express 请求中提取真实客户端 IP。
 * 依赖 app.set('trust proxy', 1) 配置。
 * 优先级: X-Real-IP > X-Forwarded-For > req.ip
 */
export function getClientIp(req: Request): string {
  const xRealIp = req.headers['x-real-ip'];
  if (typeof xRealIp === 'string') return xRealIp;

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();

  return req.ip || 'unknown';
}
