import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { mediaController } from '../controllers/mediaController.js';
import { validate } from '../middleware/validate.js';
import { authenticate, optionalAuth, requireRole } from '../middleware/auth.js';
import { conditionalRateLimit } from '../middleware/conditionalRateLimit.js';
import { mediaCreateSchema, mediaUpdateSchema, mediaQuerySchema, idParamSchema } from '@m3u8-preview/shared';

const router = Router();

// M13: incrementViews 限流，按 userId（登录）或 IP（未登录）分桶
// 防止攻击者通过多 IP 放大刷量
const viewsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = req.user?.userId;
    return userId ? `u:${userId}` : `ip:${req.ip}`;
  },
  message: { success: false, error: 'Too many view requests' },
});

// Public routes (with optional auth for user-specific data)
router.get('/', validate(mediaQuerySchema, 'query'), mediaController.findAll);
router.get('/recent', mediaController.getRecent);
router.get('/random', mediaController.getRandom);
router.get('/artists', authenticate, mediaController.getArtists);
router.get('/:id', validate(idParamSchema, 'params'), mediaController.findById);

// Authenticated routes — optionalAuth 让 keyGenerator 能拿到 userId
router.post('/:id/views', optionalAuth, conditionalRateLimit(viewsLimiter), validate(idParamSchema, 'params'), mediaController.incrementViews);

// Admin routes
router.post('/', authenticate, requireRole('ADMIN'), validate(mediaCreateSchema), mediaController.create);
router.put('/:id', authenticate, requireRole('ADMIN'), validate(idParamSchema, 'params'), validate(mediaUpdateSchema), mediaController.update);
router.delete('/:id', authenticate, requireRole('ADMIN'), validate(idParamSchema, 'params'), mediaController.delete);
router.post('/:id/thumbnail', authenticate, requireRole('ADMIN'), validate(idParamSchema, 'params'), mediaController.regenerateThumbnail);

export default router;
