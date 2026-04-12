import app from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { checkFfmpeg } from './services/thumbnailService.js';
import { migrateExternalPosters } from './services/posterDownloadService.js';
import type { Server } from 'http';

let server: Server;

async function main() {
  // Test database connection
  await prisma.$connect();
  console.log('Database connected');

  // Check ffmpeg availability for thumbnail generation
  await checkFfmpeg();

  server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${config.port}`);
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
