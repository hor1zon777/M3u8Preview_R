import { Writable } from 'stream';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { prisma } from '../lib/prisma.js';
import { invalidateRateLimitSettingCache } from '../middleware/conditionalRateLimit.js';
import { AppError } from '../middleware/errorHandler.js';
import type { RestoreResult, ExportProgress, BackupProgress } from '@m3u8-preview/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, '../../uploads');

export interface ExportOptions {
  includePosters?: boolean;
}

export type ProgressCallback = (progress: ExportProgress) => void;

function countFilesRecursive(dir: string, excludeDir?: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const child of fs.readdirSync(dir)) {
    const childPath = path.join(dir, child);
    if (excludeDir && childPath === excludeDir) continue;
    const stat = fs.statSync(childPath);
    if (stat.isDirectory()) {
      count += countFilesRecursive(childPath);
    } else {
      count++;
    }
  }
  return count;
}

function walkFiles(dir: string, basePath: string, excludeDir?: string): Array<{ absPath: string; archiveName: string }> {
  const result: Array<{ absPath: string; archiveName: string }> = [];
  if (!fs.existsSync(dir)) return result;
  for (const child of fs.readdirSync(dir)) {
    const childPath = path.join(dir, child);
    if (excludeDir && childPath === excludeDir) continue;
    const stat = fs.statSync(childPath);
    if (stat.isDirectory()) {
      result.push(...walkFiles(childPath, `${basePath}/${child}`));
    } else {
      result.push({ absPath: childPath, archiveName: `${basePath}/${child}` });
    }
  }
  return result;
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

  async exportBackupToFile(
    options: ExportOptions & { onProgress?: ProgressCallback },
  ): Promise<{ filePath: string; filename: string }> {
    const { includePosters = true, onProgress } = options;
    const DB_TABLES = 11;

    const report = (p: Partial<ExportProgress> & { phase: ExportProgress['phase'] }) => {
      onProgress?.({
        message: '',
        current: 0,
        total: 0,
        percentage: 0,
        ...p,
      });
    };

    // ── 阶段 1：查询数据库 ──
    report({ phase: 'db', message: '正在查询数据库...', current: 0, total: DB_TABLES, percentage: 0 });

    const queryTable = async <T>(fn: () => Promise<T>, idx: number, name: string): Promise<T> => {
      const result = await fn();
      report({
        phase: 'db',
        message: `已查询 ${name}`,
        current: idx + 1,
        total: DB_TABLES,
        percentage: Math.round(((idx + 1) / DB_TABLES) * 30),
      });
      return result;
    };

    const users = await queryTable(() => prisma.user.findMany({
      select: { id: true, username: true, passwordHash: true, role: true, avatar: true, isActive: true, createdAt: true, updatedAt: true },
    }), 0, 'users');
    const categories = await queryTable(() => prisma.category.findMany(), 1, 'categories');
    const tags = await queryTable(() => prisma.tag.findMany(), 2, 'tags');
    const media = await queryTable(() => prisma.media.findMany(), 3, 'media');
    const mediaTags = await queryTable(() => prisma.mediaTag.findMany(), 4, 'mediaTags');
    const favorites = await queryTable(() => prisma.favorite.findMany(), 5, 'favorites');
    const playlists = await queryTable(() => prisma.playlist.findMany(), 6, 'playlists');
    const playlistItems = await queryTable(() => prisma.playlistItem.findMany(), 7, 'playlistItems');
    const watchHistory = await queryTable(() => prisma.watchHistory.findMany(), 8, 'watchHistory');
    const importLogs = await queryTable(() => prisma.importLog.findMany(), 9, 'importLogs');
    const rawSystemSettings = await queryTable(() => prisma.systemSetting.findMany(), 10, 'systemSettings');

    const systemSettings = rawSystemSettings.filter(setting => setting.key !== 'enableRateLimit');

    const backupData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      tables: { users, categories, tags, media, mediaTags, favorites, playlists, playlistItems, watchHistory, importLogs, systemSettings },
    };

    // ── 阶段 2：打包文件 ──
    const excludeDir = includePosters ? undefined : path.join(uploadsDir, 'posters');
    const files = walkFiles(uploadsDir, 'uploads', excludeDir);
    const totalFiles = files.length;

    report({ phase: 'files', message: `正在打包文件 (共 ${totalFiles} 个)...`, current: 0, total: totalFiles, percentage: 30 });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup-${timestamp}.zip`;
    const filePath = path.join(os.tmpdir(), `m3u8-backup-${Date.now()}.zip`);
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    const archiveReady = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
    });

    archive.pipe(output);
    archive.append(JSON.stringify(backupData, null, 2), { name: 'backup.json' });

    let filesDone = 0;
    for (const file of files) {
      archive.file(file.absPath, { name: file.archiveName });
      filesDone++;
      if (filesDone % 20 === 0 || filesDone === totalFiles) {
        report({
          phase: 'files',
          message: `正在打包文件 (${filesDone}/${totalFiles})`,
          current: filesDone,
          total: totalFiles,
          percentage: 30 + Math.round((filesDone / Math.max(totalFiles, 1)) * 60),
        });
      }
    }

    // ── 阶段 3：完成打包 ──
    report({ phase: 'finalize', message: '正在压缩并写入文件...', current: 0, total: 0, percentage: 90 });
    await archive.finalize();
    await archiveReady;

    report({ phase: 'complete', message: '打包完成', current: 1, total: 1, percentage: 100 });

    return { filePath, filename };
  },

  async importBackup(zipBuffer: Buffer, onProgress?: (p: BackupProgress) => void): Promise<RestoreResult> {
    const startTime = Date.now();

    const report = (p: Partial<BackupProgress> & { phase: BackupProgress['phase'] }) => {
      onProgress?.({ message: '', current: 0, total: 0, percentage: 0, ...p });
    };

    // ── 阶段：解析 ZIP ──
    report({ phase: 'parse', message: '正在解析 ZIP 文件...', percentage: 0 });

    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch {
      throw new AppError('无法解析 ZIP 文件，请确认文件格式正确', 400);
    }

    // zip-bomb 防护：累计未压缩大小不得超过 MAX_UNCOMPRESSED_SIZE
    const MAX_UNCOMPRESSED_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
    const MAX_ENTRIES = 50000;
    const entries = zip.getEntries();
    if (entries.length > MAX_ENTRIES) {
      throw new AppError('ZIP 包含过多条目，疑似异常文件', 400);
    }
    let totalUncompressed = 0;
    for (const entry of entries) {
      totalUncompressed += entry.header.size;
      if (totalUncompressed > MAX_UNCOMPRESSED_SIZE) {
        throw new AppError('ZIP 解压后体积过大，疑似 zip-bomb', 400);
      }
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

    // 严格 version 白名单（未来升级格式时新增版本）
    const SUPPORTED_VERSIONS = new Set(['1.0']);
    if (!SUPPORTED_VERSIONS.has(String(backupData.version))) {
      throw new AppError(
        `不支持的备份版本 ${backupData.version}，当前支持: ${[...SUPPORTED_VERSIONS].join(', ')}`,
        400,
      );
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

    // ── 字段白名单工具 ──
    // 每个表只接受已知列，抵御注入额外字段（攻击扩面或适配新 schema）
    const USER_FIELDS = ['id', 'username', 'passwordHash', 'role', 'avatar', 'isActive', 'createdAt', 'updatedAt'] as const;
    const CATEGORY_FIELDS = ['id', 'name', 'slug', 'posterUrl', 'createdAt', 'updatedAt'] as const;
    const TAG_FIELDS = ['id', 'name', 'createdAt', 'updatedAt'] as const;
    const MEDIA_FIELDS = ['id', 'title', 'm3u8Url', 'posterUrl', 'description', 'year', 'rating', 'duration', 'artist', 'views', 'status', 'categoryId', 'createdAt', 'updatedAt'] as const;
    const MEDIA_TAG_FIELDS = ['mediaId', 'tagId'] as const;
    const FAVORITE_FIELDS = ['id', 'userId', 'mediaId', 'createdAt'] as const;
    const PLAYLIST_FIELDS = ['id', 'name', 'description', 'posterUrl', 'userId', 'isPublic', 'createdAt', 'updatedAt'] as const;
    const PLAYLIST_ITEM_FIELDS = ['id', 'playlistId', 'mediaId', 'position', 'createdAt'] as const;
    const WATCH_HISTORY_FIELDS = ['id', 'userId', 'mediaId', 'progress', 'duration', 'percentage', 'completed', 'createdAt', 'updatedAt'] as const;
    const IMPORT_LOG_FIELDS = ['id', 'userId', 'format', 'fileName', 'totalCount', 'successCount', 'failedCount', 'status', 'errors', 'createdAt'] as const;
    const SYSTEM_SETTING_FIELDS = ['key', 'value', 'updatedAt'] as const;
    const ALLOWED_ROLES = new Set(['USER', 'ADMIN']);
    const ALLOWED_SETTING_KEYS = new Set(['siteName', 'allowRegistration', 'enableRateLimit']);

    function pickFields<T extends Record<string, unknown>>(row: unknown, fields: readonly string[]): Partial<T> {
      if (!row || typeof row !== 'object') return {};
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        if (f in (row as Record<string, unknown>)) {
          out[f] = (row as Record<string, unknown>)[f];
        }
      }
      return out as Partial<T>;
    }

    function sanitizeRows(rows: unknown[], fields: readonly string[]): Record<string, unknown>[] {
      return rows.map((r) => pickFields(r, fields));
    }

    // users：白名单 + role 值校验 + 强制类型，防止注入未知字段、非法 role
    const sanitizedUsers = tables.users.map((u: unknown) => {
      const picked = pickFields<{ username: string; role: string; isActive: boolean }>(u, USER_FIELDS);
      if (typeof picked.username !== 'string' || picked.username.length === 0) {
        throw new AppError('users 表存在非法记录（username 缺失）', 400);
      }
      if (typeof picked.role !== 'string' || !ALLOWED_ROLES.has(picked.role)) {
        throw new AppError(`users 表存在非法 role: ${String(picked.role)}`, 400);
      }
      if (typeof picked.isActive !== 'boolean') {
        picked.isActive = true;
      }
      return picked;
    });

    // media：白名单 + m3u8Url 协议校验（防止通过备份恢复注入内网 URL 绕过代理 SSRF 防护）
    const sanitizedMedia = tables.media.map((m: unknown) => {
      const picked = pickFields<{ m3u8Url: string; title: string }>(m, MEDIA_FIELDS);
      if (typeof picked.m3u8Url === 'string' && !/^https?:\/\//i.test(picked.m3u8Url)) {
        throw new AppError('media 表存在非法 m3u8Url（仅允许 HTTP/HTTPS）', 400);
      }
      return picked;
    });

    const sanitizedCategories = sanitizeRows(tables.categories, CATEGORY_FIELDS);
    const sanitizedTags = sanitizeRows(tables.tags, TAG_FIELDS);
    const sanitizedMediaTags = sanitizeRows(tables.mediaTags, MEDIA_TAG_FIELDS);
    const sanitizedFavorites = sanitizeRows(tables.favorites, FAVORITE_FIELDS);
    const sanitizedPlaylists = sanitizeRows(tables.playlists, PLAYLIST_FIELDS);
    const sanitizedPlaylistItems = sanitizeRows(tables.playlistItems, PLAYLIST_ITEM_FIELDS);
    const sanitizedWatchHistory = sanitizeRows(tables.watchHistory, WATCH_HISTORY_FIELDS);
    const sanitizedImportLogs = sanitizeRows(tables.importLogs, IMPORT_LOG_FIELDS);
    const sanitizedSystemSettings = tables.systemSettings
      .map((s: unknown) => pickFields<{ key: string; value: string }>(s, SYSTEM_SETTING_FIELDS))
      .filter((s: Record<string, unknown>) => typeof s.key === 'string' && ALLOWED_SETTING_KEYS.has(s.key as string));

    report({ phase: 'parse', message: '数据校验完成', percentage: 5 });

    let totalRecords = 0;
    const DELETE_TABLES = 12;
    const WRITE_TABLES = 11;

    // ── 阶段：删除 + 写入（事务） ──
    report({ phase: 'delete', message: '正在清空现有数据...', current: 0, total: DELETE_TABLES, percentage: 5 });

    await prisma.$transaction(async (tx) => {
      let delIdx = 0;
      const del = async (fn: () => Promise<unknown>, name: string) => {
        await fn();
        delIdx++;
        report({
          phase: 'delete',
          message: `已清空 ${name}`,
          current: delIdx,
          total: DELETE_TABLES,
          percentage: 5 + Math.round((delIdx / DELETE_TABLES) * 15),
        });
      };

      await del(() => tx.playlistItem.deleteMany(), 'playlistItems');
      await del(() => tx.watchHistory.deleteMany(), 'watchHistory');
      await del(() => tx.favorite.deleteMany(), 'favorites');
      await del(() => tx.mediaTag.deleteMany(), 'mediaTags');
      await del(() => tx.playlist.deleteMany(), 'playlists');
      await del(() => tx.importLog.deleteMany(), 'importLogs');
      await del(() => tx.media.deleteMany(), 'media');
      await del(() => tx.tag.deleteMany(), 'tags');
      await del(() => tx.category.deleteMany(), 'categories');
      await del(() => tx.systemSetting.deleteMany(), 'systemSettings');
      await del(() => tx.refreshToken.deleteMany(), 'refreshTokens');
      await del(() => tx.user.deleteMany(), 'users');

      // ── 写入阶段 ──
      report({ phase: 'write', message: '正在写入数据...', current: 0, total: WRITE_TABLES, percentage: 20 });

      let writeIdx = 0;
      const writeTable = async (fn: () => Promise<unknown>, name: string, count: number) => {
        if (count > 0) {
          await fn();
          totalRecords += count;
        }
        writeIdx++;
        report({
          phase: 'write',
          message: `已写入 ${name} (${count} 条)`,
          current: writeIdx,
          total: WRITE_TABLES,
          percentage: 20 + Math.round((writeIdx / WRITE_TABLES) * 55),
        });
      };

      await writeTable(() => tx.user.createMany({ data: sanitizedUsers as never }), 'users', sanitizedUsers.length);
      await writeTable(() => tx.category.createMany({ data: sanitizedCategories as never }), 'categories', sanitizedCategories.length);
      await writeTable(() => tx.tag.createMany({ data: sanitizedTags as never }), 'tags', sanitizedTags.length);
      await writeTable(() => tx.media.createMany({ data: sanitizedMedia as never }), 'media', sanitizedMedia.length);
      await writeTable(() => tx.mediaTag.createMany({ data: sanitizedMediaTags as never }), 'mediaTags', sanitizedMediaTags.length);
      await writeTable(() => tx.favorite.createMany({ data: sanitizedFavorites as never }), 'favorites', sanitizedFavorites.length);
      await writeTable(() => tx.playlist.createMany({ data: sanitizedPlaylists as never }), 'playlists', sanitizedPlaylists.length);
      await writeTable(() => tx.playlistItem.createMany({ data: sanitizedPlaylistItems as never }), 'playlistItems', sanitizedPlaylistItems.length);
      await writeTable(() => tx.watchHistory.createMany({ data: sanitizedWatchHistory as never }), 'watchHistory', sanitizedWatchHistory.length);
      await writeTable(() => tx.importLog.createMany({ data: sanitizedImportLogs as never }), 'importLogs', sanitizedImportLogs.length);

      // systemSettings 使用 upsert
      for (const setting of sanitizedSystemSettings) {
        if (setting.key === 'enableRateLimit') continue;
        await tx.systemSetting.upsert({
          where: { key: setting.key as string },
          update: { value: setting.value as string },
          create: { key: setting.key as string, value: setting.value as string },
        });
        totalRecords++;
      }
      await tx.systemSetting.upsert({
        where: { key: 'enableRateLimit' },
        update: { value: 'true' },
        create: { key: 'enableRateLimit', value: 'true' },
      });
      totalRecords++;
      writeIdx++;
      report({ phase: 'write', message: '已写入 systemSettings', current: WRITE_TABLES, total: WRITE_TABLES, percentage: 75 });
    }, { timeout: 60000 });

    // 事务成功后恢复上传文件（文件系统不支持事务）
    let uploadsRestored = 0;
    const uploadEntries = zip.getEntries().filter(
      (e) => e.entryName.startsWith('uploads/') && !e.isDirectory,
    );
    const totalUploadFiles = uploadEntries.length;

    report({ phase: 'files', message: `正在恢复文件 (共 ${totalUploadFiles} 个)...`, current: 0, total: totalUploadFiles, percentage: 75 });

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
        // 去掉 "uploads/" 前缀，剩余部分作为相对路径；拒绝含绝对路径 / 穿越的条目
        const rawName = entry.entryName;
        if (!rawName.startsWith('uploads/')) continue;
        const relativeName = rawName.slice('uploads/'.length);
        if (relativeName.length === 0) continue;

        // 规范化：不允许绝对路径、盘符、反斜杠分隔符
        if (
          path.isAbsolute(relativeName) ||
          /^[a-zA-Z]:[\\/]/.test(relativeName) ||
          relativeName.includes('\\')
        ) {
          continue;
        }

        const targetPath = path.join(uploadsDir, relativeName);
        const rel = path.relative(uploadsDir, targetPath);
        // rel 不得以 '..' 开头、不得包含段级 '..'、不得为绝对路径
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).includes('..')) {
          continue;
        }

        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(targetPath, entry.getData());
        uploadsRestored++;
        if (uploadsRestored % 20 === 0 || uploadsRestored === totalUploadFiles) {
          report({
            phase: 'files',
            message: `正在恢复文件 (${uploadsRestored}/${totalUploadFiles})`,
            current: uploadsRestored,
            total: totalUploadFiles,
            percentage: 75 + Math.round((uploadsRestored / Math.max(totalUploadFiles, 1)) * 20),
          });
        }
      }
    }

    invalidateRateLimitSettingCache();

    const tablesRestored = requiredTables.filter(
      (t) => tables[t] && tables[t].length > 0,
    ).length;

    const result: RestoreResult = {
      tablesRestored,
      totalRecords,
      uploadsRestored,
      duration: Math.round((Date.now() - startTime) / 1000),
    };

    report({ phase: 'complete', message: '恢复完成', current: 1, total: 1, percentage: 100, result });

    return result;
  },
};
