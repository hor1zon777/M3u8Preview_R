import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 先加载根目录 .env（全局配置），再加载 packages/server/.env（本地覆盖）
dotenvConfig({ path: path.resolve(__dirname, '../../../.env') });
dotenvConfig({ path: path.resolve(__dirname, '../.env'), override: true });

const nodeEnv = process.env.NODE_ENV || 'development';

// 生产环境强制校验密钥配置（强度 + 非默认值）
if (nodeEnv === 'production') {
  const weakDefaults = ['change-me-in-production', 'change-me-in-production-refresh', 'dev-jwt-secret', 'dev-jwt-refresh-secret', 'm3u8preview-docker-default-secret-key-change-me', 'm3u8preview-docker-default-refresh-key-change-me', 'dev-proxy-secret'];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || weakDefaults.includes(process.env.JWT_SECRET)) {
    console.error('FATAL: JWT_SECRET must be at least 32 characters and not a known default');
    process.exit(1);
  }
  if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32 || weakDefaults.includes(process.env.JWT_REFRESH_SECRET)) {
    console.error('FATAL: JWT_REFRESH_SECRET must be at least 32 characters and not a known default');
    process.exit(1);
  }
  if (!process.env.PROXY_SECRET || process.env.PROXY_SECRET.length < 32 || weakDefaults.includes(process.env.PROXY_SECRET)) {
    console.error('FATAL: PROXY_SECRET must be at least 32 characters and not a known default');
    process.exit(1);
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  database: {
    url: process.env.DATABASE_URL || 'file:./data/m3u8preview.db',
  },
  jwt: {
    secret: process.env.JWT_SECRET || (nodeEnv === 'production' ? '' : 'dev-jwt-secret'),
    refreshSecret: process.env.JWT_REFRESH_SECRET || (nodeEnv === 'production' ? '' : 'dev-jwt-refresh-secret'),
    accessExpiresIn: '15m' as const,
    refreshExpiresIn: '7d' as const,
    // 密钥轮换支持：kid 标识当前主密钥；secretPrev + kidPrev 用于过渡期接受旧签发的 token
    kid: process.env.JWT_KID || 'v1',
    kidPrev: process.env.JWT_KID_PREV || undefined,
    secretPrev: process.env.JWT_SECRET_PREV || undefined,
    refreshSecretPrev: process.env.JWT_REFRESH_SECRET_PREV || undefined,
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },
  upload: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  },
  proxy: {
    secret: process.env.PROXY_SECRET || (nodeEnv === 'production' ? '' : 'dev-proxy-secret'),
    signatureTtl: 4 * 60 * 60, // 签名有效期 4 小时（秒）
  },
  // 是否信任 CDN 回源头（CF-Connecting-IP / True-Client-IP）
  // 默认 true：适配站点部署在 Cloudflare/Akamai 等 CDN 后的常见场景
  // 注意：若实际未部署 CDN 或未在 nginx/防火墙层限制回源 IP，攻击者可绕过 CDN 直连伪造这些头。
  // 此时应显式设置 TRUST_CDN=false
  trustCdn: process.env.TRUST_CDN === undefined
    ? true
    : /^(1|true|yes)$/i.test(process.env.TRUST_CDN),
  bcrypt: {
    saltRounds: 12,
  },
};
