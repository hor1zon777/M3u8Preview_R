import { Router } from 'express';
import { sourcePluginController } from '../controllers/sourcePluginController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { sourcePluginPreviewSchema } from '@m3u8-preview/shared';

const router = Router();

// 列出可用解析插件（登录用户可见，用于导入页选择与详情页判断）
router.get('/', authenticate, sourcePluginController.list);

// 测试解析（管理员）：输入原始链接，实时验证插件解析能力
router.post('/parse', authenticate, requireRole('ADMIN'), validate(sourcePluginPreviewSchema), sourcePluginController.testParse);

export default router;
