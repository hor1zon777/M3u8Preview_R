import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { conditionalRateLimit } from '../middleware/conditionalRateLimit.js';
import { loginSchema, registerSchema, changePasswordSchema } from '@m3u8-preview/shared';

const router = Router();

// 注册单独限速：每 IP 每 24h 最多 5 次，比登录严苛，防止批量注册机器人
const registerLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '注册过于频繁，请稍后再试' },
});

// H4: 登录单独限速，收紧暴力破解窗口
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '登录尝试过于频繁，请稍后再试' },
});

// refresh 单独限速，限制 stolen refresh token 被高频试探
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '刷新会话过于频繁，请稍后再试' },
});

router.post('/register', conditionalRateLimit(registerLimiter), validate(registerSchema), authController.register);
router.post('/login', conditionalRateLimit(loginLimiter), validate(loginSchema), authController.login);
router.get('/register-status', authController.getRegisterStatus);
router.post('/refresh', conditionalRateLimit(refreshLimiter), authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.me);
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);

export default router;
