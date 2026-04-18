import { Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import { backupService } from '../services/backupService.js';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// H2: 改用磁盘存储，避免 500MB 文件占满进程内存导致 OOM
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

export const backupController = {
  exportBackup: asyncHandler(async (req: Request, res: Response) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup-${timestamp}.zip`;
    const includePosters = req.query.includePosters !== 'false';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await backupService.exportBackup(res, { includePosters });
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
      // 无论成功失败都清理临时文件
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }),
};
