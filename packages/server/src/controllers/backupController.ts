import { Request, Response } from 'express';
import multer from 'multer';
import { backupService } from '../services/backupService.js';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// 配置 multer 内存存储，限制 500MB，仅接受 .zip 文件
const storage = multer.memoryStorage();
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

    const result = await backupService.importBackup(req.file.buffer);
    res.json({ success: true, data: result });
  }),
};
