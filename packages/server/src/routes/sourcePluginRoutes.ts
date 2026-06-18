import { Router } from 'express';
import { sourcePluginController } from '../controllers/sourcePluginController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// 列出可用解析插件（登录用户可见，用于导入页选择与详情页判断）
router.get('/', authenticate, sourcePluginController.list);

export default router;
