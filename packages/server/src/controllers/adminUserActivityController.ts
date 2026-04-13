import { Request, Response } from 'express';
import { loginRecordService } from '../services/loginRecordService.js';
import { watchHistoryService } from '../services/watchHistoryService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { safePagination } from '../utils/pagination.js';

export const adminUserActivityController = {
  /** GET /admin/users/:userId/login-records */
  getLoginRecords: asyncHandler(async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const { page, limit } = safePagination(
      parseInt(req.query.page as string) || 1,
      parseInt(req.query.limit as string) || 20,
    );
    const result = await loginRecordService.getRecordsByUser(userId, page, limit);
    res.json({ success: true, data: result });
  }),

  /** GET /admin/users/:userId/watch-history */
  getWatchHistory: asyncHandler(async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const { page, limit } = safePagination(
      parseInt(req.query.page as string) || 1,
      parseInt(req.query.limit as string) || 20,
    );
    const result = await watchHistoryService.getHistory(userId, page, limit);
    res.json({ success: true, data: result });
  }),

  /** GET /admin/users/:userId/activity-summary */
  getActivitySummary: asyncHandler(async (req: Request, res: Response) => {
    const userId = req.params.userId as string;
    const summary = await loginRecordService.getActivitySummary(userId);
    res.json({ success: true, data: summary });
  }),

  /** GET /admin/activity - 全局用户行为聚合数据 */
  getActivityAggregate: asyncHandler(async (_req: Request, res: Response) => {
    const aggregate = await loginRecordService.getActivityAggregate();
    res.json({ success: true, data: aggregate });
  }),
};
