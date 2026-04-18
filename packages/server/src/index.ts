import app from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { checkFfmpeg } from './services/thumbnailService.js';
import { migrateExternalPosters } from './services/posterDownloadService.js';
import { ensureDefaultSettings } from './services/settingsMigration.js';
import type { Server } from 'http';

let server: Server;

async function main() {
  // Test database connection
  await prisma.$connect();
  console.log('Database connected');

  // 数据库设置项迁移：补全新版本新增的默认设置
  await ensureDefaultSettings();

  // Check ffmpeg availability for thumbnail generation
  await checkFfmpeg();

  // 监听地址：生产默认 127.0.0.1（搭配 nginx 反代 + host 网络模式，避免 3000 端口暴露到宿主机所有网卡）
  // 开发环境默认 0.0.0.0 便于局域网调试；可通过 BIND_ADDRESS 显式覆盖
  const bindAddress = process.env.BIND_ADDRESS
    || (config.nodeEnv === 'production' ? '127.0.0.1' : '0.0.0.0');

  server = app.listen(config.port, bindAddress, () => {
    console.log(`Server running on http://${bindAddress}:${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
  });

  // 后台迁移外部封面图到本地（不阻塞启动）
  migrateExternalPosters().catch((err) => {
    console.error('[PosterMigration] 启动迁移失败:', err);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// L8: 未捕获异常和未处理 Promise rejection
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// L9: 优雅关闭 - 等待请求完成
async function gracefulShutdown(signal: string) {
  console.log(`${signal} received, shutting down gracefully...`);
  if (server) {
    server.close(async () => {
      console.log('HTTP server closed');
      await prisma.$disconnect();
      process.exit(0);
    });
    // 超时强制退出
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    await prisma.$disconnect();
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
