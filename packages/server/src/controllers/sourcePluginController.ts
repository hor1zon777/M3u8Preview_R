import { Request, Response, NextFunction } from 'express';
import { sourcePluginService } from '../services/sourcePluginService.js';

export const sourcePluginController = {
  /** 列出可用的动态解析插件 */
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const plugins = sourcePluginService.listPlugins();
      res.json({ success: true, data: plugins });
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
