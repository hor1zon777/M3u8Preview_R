import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { resolveExternalPoster } from './posterDownloadService.js';
import type { Category, CategoryCreateRequest } from '@m3u8-preview/shared';

function serializeCategory(category: any): Category {
  return {
    ...category,
    createdAt: category.createdAt instanceof Date ? category.createdAt.toISOString() : category.createdAt,
    updatedAt: category.updatedAt instanceof Date ? category.updatedAt.toISOString() : category.updatedAt,
  };
}

export const categoryService = {
  async findAll(options?: { search?: string; sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'mediaCount'; sortOrder?: 'asc' | 'desc' }): Promise<Category[]> {
    const { search, sortBy = 'name', sortOrder = 'asc' } = options || {};

    const where = search ? { name: { contains: search } } : {};

    // mediaCount 排序需要特殊处理
    let orderBy: any;
    if (sortBy === 'mediaCount') {
      orderBy = { media: { _count: sortOrder } };
    } else {
      orderBy = { [sortBy]: sortOrder };
    }

    const categories = await prisma.category.findMany({
      where,
      include: {
        _count: { select: { media: true } },
      },
      orderBy,
    });
    return categories.map(serializeCategory);
  },

  async findById(id: string): Promise<Category> {
    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: { select: { media: true } },
      },
    });
    if (!category) {
      throw new AppError('Category not found', 404);
    }
    return serializeCategory(category);
  },

  async create(data: CategoryCreateRequest): Promise<Category> {
    const existing = await prisma.category.findFirst({
      where: {
        OR: [{ name: data.name }, { slug: data.slug }],
      },
    });
    if (existing) {
      throw new AppError('Category with this name or slug already exists', 409);
    }

    const resolvedData = { ...data, posterUrl: await resolveExternalPoster(data.posterUrl) };
    const category = await prisma.category.create({
      data: resolvedData,
      include: {
        _count: { select: { media: true } },
      },
    });
    return serializeCategory(category);
  },

  async update(id: string, data: Partial<CategoryCreateRequest>): Promise<Category> {
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Category not found', 404);
    }

    // Check uniqueness if name or slug is being changed
    if (data.name || data.slug) {
      const conflict = await prisma.category.findFirst({
        where: {
          AND: [
            { id: { not: id } },
            {
              OR: [
                ...(data.name ? [{ name: data.name }] : []),
                ...(data.slug ? [{ slug: data.slug }] : []),
              ],
            },
          ],
        },
      });
      if (conflict) {
        throw new AppError('Category with this name or slug already exists', 409);
      }
    }

    // 下载外部封面图到本地
    if (data.posterUrl !== undefined) {
      data = { ...data, posterUrl: await resolveExternalPoster(data.posterUrl) ?? undefined };
    }

    const category = await prisma.category.update({
      where: { id },
      data,
      include: {
        _count: { select: { media: true } },
      },
    });
    return serializeCategory(category);
  },

  async delete(id: string): Promise<{ mediaCount: number }> {
    const existing = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { media: true } } },
    });
    if (!existing) {
      throw new AppError('Category not found', 404);
    }
    await prisma.category.delete({ where: { id } });
    return { mediaCount: existing._count.media };
  },
};
