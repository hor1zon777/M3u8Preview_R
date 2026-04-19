import { Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { backupService } from '../services/backupService.js';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (_req, file, cb) => {
    const ext = '.' + (file.originalname.split('.').pop()?.toLowerCase() || 'zip');
    cb(null, `backup-${Date.now()}${ext === '.zip' ? ext : '.zip'}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();
    if (ext === '.zip') {
      cb(null, true);
    } else {
      cb(new AppError('仅支持 ZIP 格式文件', 400) as any);
    }
  },
});

export const backupUpload = upload.single('file');

// 临时文件存储：downloadId -> { filePath, filename, createdAt }
const pendingDownloads = new Map<string, { filePath: string; filename: string; createdAt: number }>();
// 待恢复文件：restoreId -> { filePath, createdAt }
const pendingRestores = new Map<string, { filePath: string; createdAt: number }>();
const DOWNLOAD_TTL = 10 * 60 * 1000; // 10 分钟

function cleanupExpired() {
  const now = Date.now();
  for (const [id, entry] of pendingDownloads) {
    if (now - entry.createdAt > DOWNLOAD_TTL) {
      try { fs.unlinkSync(entry.filePath); } catch { /* ignore */ }
      pendingDownloads.delete(id);
    }
  }
  for (const [id, entry] of pendingRestores) {
    if (now - entry.createdAt > DOWNLOAD_TTL) {
      try { fs.unlinkSync(entry.filePath); } catch { /* ignore */ }
      pendingRestores.delete(id);
    }
  }
}

export const backupController = {
  exportBackup: asyncHandler(async (req: Request, res: Response) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup-${timestamp}.zip`;
    const includePosters = req.query.includePosters !== 'false';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await backupService.exportBackup(res, { includePosters });
  }),

  exportBackupStream: asyncHandler(async (req: Request, res: Response) => {
    cleanupExpired();

    const includePosters = req.query.includePosters !== 'false';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (data: unknown) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      const { filePath, filename } = await backupService.exportBackupToFile({
        includePosters,
        onProgress: (progress) => sendEvent(progress),
      });

      const downloadId = crypto.randomBytes(16).toString('hex');
      pendingDownloads.set(downloadId, { filePath, filename, createdAt: Date.now() });

      sendEvent({
        phase: 'complete',
        message: '打包完成',
        current: 1,
        total: 1,
        percentage: 100,
        downloadId,
      });
    } catch (err: any) {
      sendEvent({
        phase: 'error',
        message: err.message || '打包失败',
        current: 0,
        total: 0,
        percentage: 0,
      });
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  }),

  downloadBackup: asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const entry = pendingDownloads.get(id);

    if (!entry || !fs.existsSync(entry.filePath)) {
      pendingDownloads.delete(id);
      throw new AppError('下载链接已过期或不存在', 404);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);

    const stat = fs.statSync(entry.filePath);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(entry.filePath);
    stream.pipe(res);
    stream.on('end', () => {
      try { fs.unlinkSync(entry.filePath); } catch { /* ignore */ }
      pendingDownloads.delete(id);
    });
    stream.on('error', () => {
      try { fs.unlinkSync(entry.filePath); } catch { /* ignore */ }
      pendingDownloads.delete(id);
    });
  }),

  importBackup: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError('请上传 ZIP 备份文件', 400);
    }

    const tmpPath = req.file.path;
    try {
      const zipBuffer = fs.readFileSync(tmpPath);
      const result = await backupService.importBackup(zipBuffer);
      res.json({ success: true, data: result });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }),

  uploadBackupFile: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError('请上传 ZIP 备份文件', 400);
    }
    cleanupExpired();

    const restoreId = crypto.randomBytes(16).toString('hex');
    pendingRestores.set(restoreId, { filePath: req.file.path, createdAt: Date.now() });

    res.json({ success: true, data: { restoreId } });
  }),

  importBackupStream: asyncHandler(async (req: Request, res: Response) => {
    const restoreId = req.params.id as string;
    const entry = pendingRestores.get(restoreId);

    if (!entry || !fs.existsSync(entry.filePath)) {
      pendingRestores.delete(restoreId);
      throw new AppError('恢复任务不存在或已过期', 404);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (data: unknown) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      const zipBuffer = fs.readFileSync(entry.filePath);
      const result = await backupService.importBackup(zipBuffer, (progress) => sendEvent(progress));

      sendEvent({
        phase: 'complete',
        message: '恢复完成',
        current: 1,
        total: 1,
        percentage: 100,
        result,
      });
    } catch (err: any) {
      sendEvent({
        phase: 'error',
        message: err.message || '恢复失败',
        current: 0,
        total: 0,
        percentage: 0,
      });
    } finally {
      try { fs.unlinkSync(entry.filePath); } catch { /* ignore */ }
      pendingRestores.delete(restoreId);
      if (!res.writableEnded) {
        res.end();
      }
    }
  }),
};
