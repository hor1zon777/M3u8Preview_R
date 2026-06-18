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
};
