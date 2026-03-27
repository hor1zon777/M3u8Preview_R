import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { mediaController } from '../controllers/mediaController.js';
import { validate } from '../middleware/validate.js';
import { authenticate, optionalAuth, requireRole } from '../middleware/auth.js';
import { conditionalRateLimit } from '../middleware/conditionalRateLimit.js';
import { mediaCreateSchema, mediaUpdateSchema, mediaQuerySchema, idParamSchema } from '@m3u8-preview/shared';

const router = Router();

// M13: incrementViews 限流，每 IP 每 15 分钟最多 100 次
const viewsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many view requests' },
});

// Public routes (with optional auth for user-specific data)
router.get('/', validate(mediaQuerySchema, 'query'), mediaController.findAll);
router.get('/recent', mediaController.getRecent);
router.get('/random', mediaController.getRandom);
router.get('/artists', authenticate, mediaController.getArtists);
router.get('/:id', validate(idParamSchema, 'params'), mediaController.findById);

// Authenticated routes
router.post('/:id/views', conditionalRateLimit(viewsLimiter), validate(idParamSchema, 'params'), mediaController.incrementViews);

// Admin routes
router.post('/', authenticate, requireRole('ADMIN'), validate(mediaCreateSchema), mediaController.create);
router.put('/:id', authenticate, requireRole('ADMIN'), validate(idParamSchema, 'params'), validate(mediaUpdateSchema), mediaController.update);
router.delete('/:id', authenticate, requireRole('ADMIN'), validate(idParamSchema, 'params'), mediaController.delete);
router.post('/:id/thumbnail', authenticate, requireRole('ADMIN'), validate(idParamSchema, 'params'), mediaController.regenerateThumbnail);

export default router;
