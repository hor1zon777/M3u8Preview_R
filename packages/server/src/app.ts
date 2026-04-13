import express, { type Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/authRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import tagRoutes from './routes/tagRoutes.js';
import historyRoutes from './routes/historyRoutes.js';
import favoriteRoutes from './routes/favoriteRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import playlistRoutes from './routes/playlistRoutes.js';
import importRoutes from './routes/importRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import proxyRoutes from './routes/proxyRoutes.js';
import { conditionalRateLimit, isRateLimitToggleRequest } from './middleware/conditionalRateLimit.js';

function shouldBypassGlobalRateLimit(req: Request): boolean {
  return isRateLimitToggleRequest(req);
}


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, '../uploads');

const app = express();

// Trust proxy chain (nginx + docker network) so req.ip reflects X-Forwarded-For / X-Real-IP
// 在 Docker 环境中，请求经过 nginx 容器和 docker 网络，需要信任整个代理链
app.set('trust proxy', true);

// Rate limiter for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'blob:', 'https:'],
      connectSrc: ["'self'", 'https:'],
      fontSrc: ["'self'"],
    },
  },
}));

// 代理路由：挂载在 compression/json/cookie 之前，跳过不必要的中间件开销
// 代理路由处理的是流式二进制转发，不需要 body 解析、cookie、gzip 压缩
app.use('/api/v1/proxy', cors({ origin: config.cors.origin, credentials: true }), proxyRoutes);

app.use(compression());
app.use(cors({
  origin: config.cors.origin,
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging
if (config.nodeEnv !== 'test') {
  app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
}

// H5: 使用绝对路径提供静态文件，添加安全头
app.use('/uploads', (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  next();
}, express.static(uploadsDir));

// Global API rate limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/v1', conditionalRateLimit(globalLimiter, shouldBypassGlobalRateLimit));

// API routes
app.use('/api/v1/auth', conditionalRateLimit(authLimiter), authRoutes);
app.use('/api/v1/media', mediaRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/tags', tagRoutes);
app.use('/api/v1/history', historyRoutes);
app.use('/api/v1/favorites', favoriteRoutes);
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/v1/playlists', playlistRoutes);
app.use('/api/v1/import', express.json({ limit: '10mb' }), importRoutes);
app.use('/api/v1/admin', adminRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Error handler (must be last)
app.use(errorHandler);

export default app;
