import { Request, Response } from 'express';
import { adminService } from '../services/adminService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { safePagination } from '../utils/pagination.js';
import { generateAllMissing, thumbnailQueue } from '../services/thumbnailService.js';
import { migrateExternalPosters, posterMigrationQueue } from '../services/posterDownloadService.js';
import { invalidateRateLimitSettingCache } from '../middleware/conditionalRateLimit.js';

type Params = { id: string };

export const adminController = {
  /**
   * GET /admin/dashboard - Get dashboard statistics
   */
  getDashboard: asyncHandler(async (_req: Request, res: Response) => {
    const stats = await adminService.getDashboardStats();
    res.json({ success: true, data: stats });
  }),

  /**
   * GET /admin/users - Get paginated user list
   */
  getUsers: asyncHandler(async (req: Request, res: Response) => {
    const { page, limit } = safePagination(
      parseInt(req.query.page as string) || 1,
      parseInt(req.query.limit as string) || 20,
    );
    const search = req.query.search as string | undefined;
    const result = await adminService.getAllUsers(page, limit, search);
    res.json({ success: true, data: result });
  }),

  /**
   * PUT /admin/users/:id - Update user role or active status
   * 参数验证已由路由层 validate 中间件处理
   */
  updateUser: asyncHandler(async (req: Request<Params>, res: Response) => {
    const { role, isActive } = req.body;
    const currentUserId = req.user?.userId;
    const user = await adminService.updateUser(req.params.id, { role, isActive }, currentUserId);
    res.json({ success: true, data: user });
  }),

  /**
   * DELETE /admin/users/:id - Delete a user
   */
  deleteUser: asyncHandler(async (req: Request<Params>, res: Response) => {
    await adminService.deleteUser(req.params.id);
    res.json({ success: true, message: 'User deleted successfully' });
  }),

  /**
   * GET /admin/settings - Get all system settings
   */
  getSettings: asyncHandler(async (_req: Request, res: Response) => {
    const settings = await adminService.getSystemSettings();
    res.json({ success: true, data: settings });
  }),

  /**
   * PUT /admin/settings - Update a system setting
   * 参数验证已由路由层 validate 中间件处理
   */
  updateSetting: asyncHandler(async (req: Request, res: Response) => {
    const { key, value } = req.body;
    const setting = await adminService.updateSystemSetting(key, value);

    if (key === 'enableRateLimit') {
      invalidateRateLimitSettingCache();
    }

    res.json({ success: true, data: setting });
  }),

  /**
   * GET /admin/media - Get paginated media list with admin filters
   */
  getMedia: asyncHandler(async (req: Request, res: Response) => {
    const { page, limit } = safePagination(
      parseInt(req.query.page as string) || 1,
      parseInt(req.query.limit as string) || 20,
    );
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const result = await adminService.getAllMedia(page, limit, search, status);
    res.json({ success: true, data: result });
  }),

  /**
   * POST /admin/thumbnails/generate - Generate thumbnails for all media missing posterUrl
   */
  generateThumbnails: asyncHandler(async (_req: Request, res: Response) => {
    const count = await generateAllMissing();
    res.json({ success: true, data: { enqueuedCount: count } });
  }),

  /**
   * GET /admin/thumbnails/status - 查询缩略图生成队列状态
   */
  getThumbnailStatus: asyncHandler(async (_req: Request, res: Response) => {
    const status = thumbnailQueue.getStatus();
    res.json({ success: true, data: status });
  }),

  /**
   * POST /admin/media/batch-delete - 批量删除媒体
   */
  batchDeleteMedia: asyncHandler(async (req: Request, res: Response) => {
    const { ids } = req.body;
    const result = await adminService.batchDeleteMedia(ids);
    res.json({ success: true, data: result });
  }),

  /**
   * PUT /admin/media/batch-status - 批量修改媒体状态
   */
  batchUpdateStatus: asyncHandler(async (req: Request, res: Response) => {
    const { ids, status } = req.body;
    const result = await adminService.batchUpdateStatus(ids, status);
    res.json({ success: true, data: result });
  }),

  /**
   * PUT /admin/media/batch-category - 批量修改媒体分类
   */
  batchUpdateCategory: asyncHandler(async (req: Request, res: Response) => {
    const { ids, categoryId } = req.body;
    const result = await adminService.batchUpdateCategory(ids, categoryId);
    res.json({ success: true, data: result });
  }),

  /**
   * POST /admin/posters/migrate - 将外部封面图下载到本地
   */
  migratePosterImages: asyncHandler(async (_req: Request, res: Response) => {
    const count = await migrateExternalPosters();
    res.json({ success: true, data: { enqueuedCount: count } });
  }),

  /**
   * GET /admin/posters/status - 查询封面迁移队列状态
   */
  getPosterMigrationStatus: asyncHandler(async (_req: Request, res: Response) => {
    const status = posterMigrationQueue.getStatus();
    res.json({ success: true, data: status });
  }),
};
