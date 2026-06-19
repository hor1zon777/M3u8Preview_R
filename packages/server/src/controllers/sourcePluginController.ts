import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { sourcePluginService } from '../services/sourcePluginService.js';
import { AppError } from '../middleware/errorHandler.js';

// 上传插件包：临时存储到系统 tmp，限 .js/.mjs/.zip 与 5MB
const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `plugin-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.js' || ext === '.mjs' || ext === '.zip') {
      cb(null, true);
    } else {
      cb(new AppError('仅支持 .js 或 .zip 插件文件', 400));
    }
  },
});
export const pluginUpload = upload.single('file');

export const sourcePluginController = {
  /** 公开：列出已启用的解析插件（导入页/详情页用） */
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const plugins = await sourcePluginService.listPlugins();
      res.json({ success: true, data: plugins });
    } catch (error) {
      next(error);
    }
  },

  /** 管理：列出全部插件（含启用状态、配置、配置项声明） */
  async listAll(_req: Request, res: Response, next: NextFunction) {
    try {
      const plugins = await sourcePluginService.listAll();
      res.json({ success: true, data: plugins });
    } catch (error) {
      next(error);
    }
  },

  /** 启用 / 禁用插件 */
  async toggle(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params as { id: string };
      const { enabled } = req.body as { enabled: boolean };
      await sourcePluginService.setEnabled(id, enabled);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },

  /** 更新插件配置 */
  async updateConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params as { id: string };
      const { config } = req.body as { config: Record<string, string | number | boolean> };
      await sourcePluginService.updateConfig(id, config);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },

  /** 安装上传的插件文件（.js / .zip） */
  async install(req: Request, res: Response, next: NextFunction) {
    const tmpPath = req.file?.path;
    try {
      if (!req.file) {
        throw new AppError('请上传插件文件（.js 或 .zip）', 400);
      }
      const info = await sourcePluginService.install(req.file.path, req.file.originalname);
      res.json({ success: true, data: info });
    } catch (error) {
      next(error);
    } finally {
      if (tmpPath) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }
    }
  },

  /** 卸载插件（仅上传来源） */
  async uninstall(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params as { id: string };
      await sourcePluginService.uninstall(id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },

  /** 测试解析：传入原始链接列表，返回每条解析结果（成功/失败） */
  async testParse(req: Request, res: Response, next: NextFunction) {
    try {
      const { pluginId, urls } = req.body as { pluginId?: string; urls: string[] };
      const results = await sourcePluginService.parseBatch(pluginId, urls);
      res.json({ success: true, data: results });
    } catch (error) {
      next(error);
    }
  },
};
