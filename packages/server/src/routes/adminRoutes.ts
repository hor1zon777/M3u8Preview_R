import { Router } from 'express';
import { adminController } from '../controllers/adminController.js';
import { backupController, backupUpload } from '../controllers/backupController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema, updateUserSchema, updateSettingSchema, batchDeleteSchema, batchStatusSchema, batchCategorySchema } from '@m3u8-preview/shared';

const router = Router();

// All admin routes require authentication and ADMIN role
router.use(authenticate, requireRole('ADMIN'));

// Dashboard
router.get('/dashboard', adminController.getDashboard);

// User management
router.get('/users', adminController.getUsers);
router.put('/users/:id', validate(idParamSchema, 'params'), validate(updateUserSchema), adminController.updateUser);
router.delete('/users/:id', validate(idParamSchema, 'params'), adminController.deleteUser);

// System settings
router.get('/settings', adminController.getSettings);
router.put('/settings', validate(updateSettingSchema), adminController.updateSetting);

// Media management (admin view with additional filters)
router.get('/media', adminController.getMedia);
router.post('/media/batch-delete', validate(batchDeleteSchema), adminController.batchDeleteMedia);
router.put('/media/batch-status', validate(batchStatusSchema), adminController.batchUpdateStatus);
router.put('/media/batch-category', validate(batchCategorySchema), adminController.batchUpdateCategory);

// Thumbnail management
router.post('/thumbnails/generate', adminController.generateThumbnails);
router.get('/thumbnails/status', adminController.getThumbnailStatus);

// Poster migration (外部封面下载到本地)
router.post('/posters/migrate', adminController.migratePosterImages);
router.get('/posters/status', adminController.getPosterMigrationStatus);

// Backup management
router.get('/backup/export', backupController.exportBackup);
router.post('/backup/import', backupUpload, backupController.importBackup);

export default router;
