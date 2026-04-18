import { Router } from 'express';
import { playlistController } from '../controllers/playlistController.js';
import { authenticate, requireRole, optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  playlistCreateSchema,
  playlistUpdateSchema,
  playlistItemsQuerySchema,
  idParamSchema,
  addItemBodySchema,
  reorderBodySchema,
} from '@m3u8-preview/shared';
import { z } from 'zod';

const router = Router();

const mediaIdParamSchema = z.object({
  id: z.string().uuid(),
  mediaId: z.string().uuid(),
});

// Public route
router.get('/public', playlistController.getPublicPlaylists);

// 合集内媒体分页查询（公开合集无需认证，私有合集需认证）
router.get('/:id/items', optionalAuth, validate(idParamSchema, 'params'), validate(playlistItemsQuerySchema, 'query'), playlistController.getPlaylistItems);

// All other routes require authentication
router.get('/', authenticate, playlistController.findAll);
router.get('/:id', authenticate, validate(idParamSchema, 'params'), playlistController.findById);
router.post('/', authenticate, requireRole('ADMIN'), validate(playlistCreateSchema), playlistController.create);
router.put('/:id', authenticate, requireRole('ADMIN'), validate(idParamSchema, 'params'), validate(playlistUpdateSchema), playlistController.update);
router.delete('/:id', authenticate, requireRole('ADMIN'), validate(idParamSchema, 'params'), playlistController.delete);
router.post('/:id/items', authenticate, validate(idParamSchema, 'params'), validate(addItemBodySchema), playlistController.addItem);
router.delete('/:id/items/:mediaId', authenticate, validate(mediaIdParamSchema, 'params'), playlistController.removeItem);
router.put('/:id/reorder', authenticate, validate(idParamSchema, 'params'), validate(reorderBodySchema), playlistController.reorderItems);

export default router;
