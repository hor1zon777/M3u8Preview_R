import { Writable } from 'stream';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { prisma } from '../lib/prisma.js';
import { invalidateRateLimitSettingCache } from '../middleware/conditionalRateLimit.js';
import { AppError } from '../middleware/errorHandler.js';
import type { RestoreResult } from '@m3u8-preview/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, '../../uploads');

export interface ExportOptions {
  includePosters?: boolean;
}

export const backupService = {
  async exportBackup(outputStream: Writable, options: ExportOptions = {}): Promise<void> {
    const { includePosters = true } = options;
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(outputStream);

    // 并行查询所有表
    const [
      users,
      categories,
      tags,
      media,
      mediaTags,
      favorites,
      playlists,
      playlistItems,
      watchHistory,
      importLogs,
      rawSystemSettings,
    ] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          username: true,
          passwordHash: true,
          role: true,
          avatar: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.category.findMany(),
      prisma.tag.findMany(),
      prisma.media.findMany(),
      prisma.mediaTag.findMany(),
      prisma.favorite.findMany(),
      prisma.playlist.findMany(),
      prisma.playlistItem.findMany(),
      prisma.watchHistory.findMany(),
      prisma.importLog.findMany(),
      prisma.systemSetting.findMany(),
    ]);

    const systemSettings = rawSystemSettings.filter(setting => setting.key !== 'enableRateLimit');

    const backupData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      tables: {
        users,
        categories,
        tags,
        media,
        mediaTags,
        favorites,
        playlists,
        playlistItems,
        watchHistory,
        importLogs,
        systemSettings,
      },
    };

    // 添加 backup.json
    archive.append(JSON.stringify(backupData, null, 2), { name: 'backup.json' });

    // 添加 uploads 目录
    if (fs.existsSync(uploadsDir)) {
      if (includePosters) {
        archive.directory(uploadsDir, 'uploads');
      } else {
        // 不包含封面：排除 posters 子目录，仅打包其余上传文件
        const postersSubdir = path.join(uploadsDir, 'posters');
        const children = fs.readdirSync(uploadsDir);
        for (const child of children) {
          const childPath = path.join(uploadsDir, child);
          if (childPath === postersSubdir) continue;
          const stat = fs.statSync(childPath);
          if (stat.isDirectory()) {
            archive.directory(childPath, `uploads/${child}`);
          } else {
            archive.file(childPath, { name: `uploads/${child}` });
          }
        }
      }
    }

    await archive.finalize();
  },

  async importBackup(zipBuffer: Buffer): Promise<RestoreResult> {
    const startTime = Date.now();

    // 解析 ZIP
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch {
      throw new AppError('无法解析 ZIP 文件，请确认文件格式正确', 400);
    }

    // 读取 backup.json
    const backupEntry = zip.getEntry('backup.json');
    if (!backupEntry) {
      throw new AppError('ZIP 文件中缺少 backup.json', 400);
    }

    let backupData: any;
    try {
      backupData = JSON.parse(backupEntry.getData().toString('utf-8'));
    } catch {
      throw new AppError('backup.json 格式无效', 400);
    }

    // 校验结构
    if (!backupData.version || !backupData.tables) {
      throw new AppError('backup.json 结构不完整，缺少 version 或 tables', 400);
    }

    const requiredTables = [
      'users', 'categories', 'tags', 'media', 'mediaTags',
      'favorites', 'playlists', 'playlistItems', 'watchHistory',
      'importLogs', 'systemSettings',
    ];
    for (const table of requiredTables) {
      if (!Array.isArray(backupData.tables[table])) {
        throw new AppError(`backup.json 中缺少表: ${table}`, 400);
      }
    }

    const tables = backupData.tables;
    let totalRecords = 0;

    // 在事务中执行清空 + 写入
    await prisma.$transaction(async (tx) => {
      // 删除阶段（逆外键依赖顺序）
      await tx.playlistItem.deleteMany();
      await tx.watchHistory.deleteMany();
      await tx.favorite.deleteMany();
      await tx.mediaTag.deleteMany();
      await tx.playlist.deleteMany();
      await tx.importLog.deleteMany();
      await tx.media.deleteMany();
      await tx.tag.deleteMany();
      await tx.category.deleteMany();
      await tx.systemSetting.deleteMany();
      await tx.refreshToken.deleteMany();
      await tx.user.deleteMany();

      // 写入阶段（正序，先写无依赖的表）
      if (tables.users.length > 0) {
        await tx.user.createMany({ data: tables.users });
        totalRecords += tables.users.length;
      }

      if (tables.categories.length > 0) {
        await tx.category.createMany({ data: tables.categories });
        totalRecords += tables.categories.length;
      }

      if (tables.tags.length > 0) {
        await tx.tag.createMany({ data: tables.tags });
        totalRecords += tables.tags.length;
      }

      if (tables.media.length > 0) {
        await tx.media.createMany({ data: tables.media });
        totalRecords += tables.media.length;
      }

      if (tables.mediaTags.length > 0) {
        await tx.mediaTag.createMany({ data: tables.mediaTags });
        totalRecords += tables.mediaTags.length;
      }

      if (tables.favorites.length > 0) {
        await tx.favorite.createMany({ data: tables.favorites });
        totalRecords += tables.favorites.length;
      }

      if (tables.playlists.length > 0) {
        await tx.playlist.createMany({ data: tables.playlists });
        totalRecords += tables.playlists.length;
      }

      if (tables.playlistItems.length > 0) {
        await tx.playlistItem.createMany({ data: tables.playlistItems });
        totalRecords += tables.playlistItems.length;
      }

      if (tables.watchHistory.length > 0) {
        await tx.watchHistory.createMany({ data: tables.watchHistory });
        totalRecords += tables.watchHistory.length;
      }

      if (tables.importLogs.length > 0) {
        await tx.importLog.createMany({ data: tables.importLogs });
        totalRecords += tables.importLogs.length;
      }

      // systemSettings 使用 upsert（主键为 key 字符串）
      for (const setting of tables.systemSettings) {
        if (setting.key === 'enableRateLimit') {
          continue;
        }

        await tx.systemSetting.upsert({
          where: { key: setting.key },
          update: { value: setting.value },
          create: { key: setting.key, value: setting.value },
        });
        totalRecords++;
      }

      await tx.systemSetting.upsert({
        where: { key: 'enableRateLimit' },
        update: { value: 'true' },
        create: { key: 'enableRateLimit', value: 'true' },
      });
      totalRecords++;
    }, { timeout: 60000 });

    // 事务成功后恢复上传文件（文件系统不支持事务）
    let uploadsRestored = 0;
    const uploadEntries = zip.getEntries().filter(
      (e) => e.entryName.startsWith('uploads/') && !e.isDirectory,
    );

    if (uploadEntries.length > 0) {
      // 清空 uploads 目录内容（仅删除子项，保留目录本身，避免 Docker 卷挂载点无法删除的问题）
      if (fs.existsSync(uploadsDir)) {
        for (const child of fs.readdirSync(uploadsDir)) {
          fs.rmSync(path.join(uploadsDir, child), { recursive: true, force: true });
        }
      } else {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      for (const entry of uploadEntries) {
        const targetPath = path.resolve(uploadsDir, '..', entry.entryName);
        // 防止路径穿越
        if (!targetPath.startsWith(uploadsDir)) {
          continue;
        }
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(targetPath, entry.getData());
        uploadsRestored++;
      }
    }

    invalidateRateLimitSettingCache();

    const tablesRestored = requiredTables.filter(
      (t) => tables[t] && tables[t].length > 0,
    ).length;

    return {
      tablesRestored,
      totalRecords,
      uploadsRestored,
      duration: Math.round((Date.now() - startTime) / 1000),
    };
  },
};
