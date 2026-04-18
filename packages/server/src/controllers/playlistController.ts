import { Request, Response, NextFunction } from 'express';
import { playlistService } from '../services/playlistService.js';
import { safePagination } from '../utils/pagination.js';

type IdParams = { id: string };
type ItemParams = { id: string; mediaId: string };

export const playlistController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const playlists = await playlistService.findAll(req.user!.userId);
      res.json({ success: true, data: playlists });
    } catch (error) {
      next(error);
    }
  },

  async findById(req: Request<IdParams>, res: Response, next: NextFunction) {
    try {
      const playlist = await playlistService.findById(req.params.id, req.user!.userId);
      res.json({ success: true, data: playlist });
    } catch (error) {
      next(error);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const playlist = await playlistService.create(req.user!.userId, req.body);
      res.status(201).json({ success: true, data: playlist });
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request<IdParams>, res: Response, next: NextFunction) {
    try {
      const playlist = await playlistService.update(req.params.id, req.user!.userId, req.body);
      res.json({ success: true, data: playlist });
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request<IdParams>, res: Response, next: NextFunction) {
    try {
      await playlistService.delete(req.params.id, req.user!.userId);
      res.json({ success: true, message: 'Playlist deleted successfully' });
    } catch (error) {
      next(error);
    }
  },

  async addItem(req: Request<IdParams>, res: Response, next: NextFunction) {
    try {
      const { mediaId } = req.body;
      const item = await playlistService.addItem(req.params.id, req.user!.userId, mediaId);
      res.status(201).json({ success: true, data: item });
    } catch (error) {
      next(error);
    }
  },

  async removeItem(req: Request<ItemParams>, res: Response, next: NextFunction) {
    try {
      await playlistService.removeItem(req.params.id, req.user!.userId, req.params.mediaId);
      res.json({ success: true, message: 'Item removed from playlist' });
    } catch (error) {
      next(error);
    }
  },

  async reorderItems(req: Request<IdParams>, res: Response, next: NextFunction) {
    try {
      const { itemIds } = req.body;
      await playlistService.reorderItems(req.params.id, req.user!.userId, itemIds);
      res.json({ success: true, message: 'Items reordered successfully' });
    } catch (error) {
      next(error);
    }
  },

  async getPublicPlaylists(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = safePagination(
        parseInt(req.query.page as string) || 1,
        parseInt(req.query.limit as string) || 20,
      );
      const { search, sortBy, sortOrder } = req.query;
      const allowedSortBy = ['updatedAt', 'createdAt', 'name', 'itemCount'] as const;
      const safeSortBy = allowedSortBy.includes(sortBy as any) ? (sortBy as typeof allowedSortBy[number]) : 'updatedAt';
      const safeSortOrder = sortOrder === 'asc' ? 'asc' as const : 'desc' as const;
      const result = await playlistService.getPublicPlaylists(page, limit, {
        search: search as string,
        sortBy: safeSortBy,
        sortOrder: safeSortOrder,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async getPlaylistItems(req: Request<IdParams>, res: Response, next: NextFunction) {
    try {
      const { page, limit } = safePagination(
        parseInt(req.query.page as string) || 1,
        parseInt(req.query.limit as string) || 24,
      );
      const { search, sortBy, sortOrder } = req.query;

      // 可选认证：userId 可能为 undefined（公开合集无需认证）
      const userId = req.user?.userId;

      const result = await playlistService.getPlaylistItems(
        req.params.id,
        userId,
        page,
        limit,
        {
          search: search as string,
          sortBy: sortBy as string,
          sortOrder: sortOrder as any,
        },
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
};
