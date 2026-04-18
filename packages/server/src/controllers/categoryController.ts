import { Request, Response, NextFunction } from 'express';
import { categoryService } from '../services/categoryService.js';

type Params = { id: string };

export const categoryController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, sortBy, sortOrder } = req.query;
      // H3: sortBy 白名单验证
      const allowedSortBy = ['name', 'createdAt', 'updatedAt', 'mediaCount'] as const;
      const safeSortBy = allowedSortBy.includes(sortBy as any) ? (sortBy as typeof allowedSortBy[number]) : 'name';
      const safeSortOrder = sortOrder === 'desc' ? 'desc' as const : 'asc' as const;
      const categories = await categoryService.findAll({
        search: search as string,
        sortBy: safeSortBy,
        sortOrder: safeSortOrder,
      });
      res.json({ success: true, data: categories });
    } catch (error) {
      next(error);
    }
  },

  async findById(req: Request<Params>, res: Response, next: NextFunction) {
    try {
      const category = await categoryService.findById(req.params.id);
      res.json({ success: true, data: category });
    } catch (error) {
      next(error);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const category = await categoryService.create(req.body);
      res.status(201).json({ success: true, data: category });
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request<Params>, res: Response, next: NextFunction) {
    try {
      const category = await categoryService.update(req.params.id, req.body);
      res.json({ success: true, data: category });
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request<Params>, res: Response, next: NextFunction) {
    try {
      await categoryService.delete(req.params.id);
      res.json({ success: true, message: 'Category deleted successfully' });
    } catch (error) {
      next(error);
    }
  },
};
