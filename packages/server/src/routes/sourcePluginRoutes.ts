import { Router } from 'express';
import { sourcePluginController, pluginUpload } from '../controllers/sourcePluginController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  sourcePluginPreviewSchema,
  sourcePluginIdParamSchema,
  sourcePluginToggleSchema,
  sourcePluginConfigSchema,
} from '@m3u8-preview/shared';

const router = Router();

// 列出可用解析插件（登录用户可见，仅已启用，用于导入页选择与详情页判断）
router.get('/', authenticate, sourcePluginController.list);

// 测试解析（管理员）：输入原始链接，实时验证插件解析能力
router.post('/parse', authenticate, requireRole('ADMIN'), validate(sourcePluginPreviewSchema), sourcePluginController.testParse);

// ── 插件管理（管理员）──
// 列出全部插件（含启用状态、配置、配置项声明）
router.get('/admin', authenticate, requireRole('ADMIN'), sourcePluginController.listAll);

// 上传安装插件（.js / .zip）
router.post('/admin/install', authenticate, requireRole('ADMIN'), pluginUpload, sourcePluginController.install);

// 启用 / 禁用
router.patch(
  '/admin/:id/enabled',
  authenticate,
  requireRole('ADMIN'),
  validate(sourcePluginIdParamSchema, 'params'),
  validate(sourcePluginToggleSchema),
  sourcePluginController.toggle,
);

// 更新配置
router.put(
  '/admin/:id/config',
  authenticate,
  requireRole('ADMIN'),
  validate(sourcePluginIdParamSchema, 'params'),
  validate(sourcePluginConfigSchema),
  sourcePluginController.updateConfig,
);

// 卸载（仅上传来源可删）
router.delete(
  '/admin/:id',
  authenticate,
  requireRole('ADMIN'),
  validate(sourcePluginIdParamSchema, 'params'),
  sourcePluginController.uninstall,
);

export default router;
