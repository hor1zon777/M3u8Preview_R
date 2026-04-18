import { Request, Response } from 'express';
import multer from 'multer';
import { importService } from '../services/importService.js';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** 文件扩展名 → 期望的文件 magic bytes（前 N 字节） */
const MAGIC_BYTES: Record<string, Uint8Array[]> = {
  // XLSX = ZIP：PK\x03\x04（也可能是 PK\x05\x06 空 zip、PK\x07\x08 spanned）
  '.xlsx': [
    new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    new Uint8Array([0x50, 0x4b, 0x07, 0x08]),
  ],
};

function bufferStartsWith(buf: Buffer, prefix: Uint8Array): boolean {
  if (buf.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (buf[i] !== prefix[i]) return false;
  }
  return true;
}

/** 校验 upload 文件内容的前几个字节是否匹配预期格式（防止伪装成 xlsx 的恶意 zip / 普通文件） */
function validateFileMagic(file: Express.Multer.File): void {
  const ext = '.' + (file.originalname.split('.').pop()?.toLowerCase() || '');
  const expectedMagics = MAGIC_BYTES[ext];
  if (!expectedMagics) return; // 文本类文件（csv/json/txt）不做 magic 校验
  if (!file.buffer || file.buffer.length === 0) {
    throw new AppError('文件内容为空', 400);
  }
  const matched = expectedMagics.some((m) => bufferStartsWith(file.buffer, m));
  if (!matched) {
    throw new AppError('文件内容与扩展名不匹配，拒绝处理', 400);
  }
}

// Configure multer for import file uploads (memory storage)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowedExtensions = ['.csv', '.xlsx', '.json', '.txt'];
    const ext = '.' + file.originalname.split('.').pop()?.toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new AppError('Unsupported file format. Allowed: csv, xlsx, json, txt', 400) as any);
    }
  },
});

export const importUpload = upload.single('file');

export const importController = {
  preview: asyncHandler(async (req: Request, res: Response) => {
    if (req.file) validateFileMagic(req.file);
    const { items, format, fileName } = await importService.detectFormatAndParse(req.file, req.body);
    if (items.length > 1000) {
      throw new AppError('Maximum 1000 items per import', 400);
    }
    const preview = importService.preview(items);

    res.json({
      success: true,
      data: {
        ...preview,
        format,
        fileName,
      },
    });
  }),

  execute: asyncHandler(async (req: Request, res: Response) => {
    const { items, format, fileName } = req.body;
    if (!items || !Array.isArray(items)) {
      throw new AppError('Items array is required', 400);
    }
    // H7: 限制单次导入数据量，防止 DoS
    if (items.length > 1000) {
      throw new AppError('Maximum 1000 items per import', 400);
    }

    const result = await importService.execute(
      req.user!.userId,
      items,
      format || 'TEXT',
      fileName,
    );
    res.json({ success: true, data: result });
  }),

  getTemplates: asyncHandler(async (req: Request, res: Response) => {
    const { format } = req.params;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="import-template.csv"');
      // Add BOM for Excel UTF-8 compatibility
      res.send('\ufeff' + importService.generateCsvTemplate());
    } else if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="import-template.json"');
      res.send(importService.generateJsonTemplate());
    } else {
      throw new AppError('Unsupported template format. Use csv or json.', 400);
    }
  }),

  getLogs: asyncHandler(async (_req: Request, res: Response) => {
    const serialized = await importService.getLogs();
    res.json({ success: true, data: serialized });
  }),
};
