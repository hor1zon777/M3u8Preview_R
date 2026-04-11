import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import type { MediaCreateRequest, MediaUpdateRequest, MediaQueryParams, PaginatedResponse, Media, ArtistInfo } from '@m3u8-preview/shared';
import { serializeMedia, serializeMediaList } from '../utils/serializers.js';
import { deleteThumbnail } from './thumbnailService.js';
import { resolveExternalPoster } from './posterDownloadService.js';

const mediaInclude = {
  category: true,
  tags: { include: { tag: true } },
};

/** 列表视图精简字段，排除 description 和 tags */
const mediaListSelect = {
  id: true,
  title: true,
  m3u8Url: true,
  posterUrl: true,
  year: true,
  rating: true,
  artist: true,
  views: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, slug: true, createdAt: true, updatedAt: true } },
};

export const mediaService = {
  async findAll(query: MediaQueryParams): Promise<PaginatedResponse<Media>> {
    const { page = 1, limit = 20, search, categoryId, tagId, artist, status, sortBy = 'createdAt', sortOrder = 'desc' } = query;
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const skip = (page - 1) * safeLimit;

    const where: Prisma.MediaWhereInput = {};
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
        { artist: { contains: search } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (status) where.status = status;
    if (artist) where.artist = artist;
    if (tagId) {
      where.tags = { some: { tagId } };
    }

    const [items, total] = await Promise.all([
      prisma.media.findMany({
        where,
        include: mediaInclude,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: safeLimit,
      }),
      prisma.media.count({ where }),
    ]);

    return {
      items: items.map(serializeMedia),
      total,
      page,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  },

  async findById(id: string): Promise<Media> {
    const media = await prisma.media.findUnique({
      where: { id },
      include: mediaInclude,
    });
    if (!media) {
      throw new AppError('Media not found', 404);
    }
    return serializeMedia(media);
  },

  async create(data: MediaCreateRequest): Promise<Media> {
    const { tagIds, ...mediaData } = data;
    const posterUrl = await resolveExternalPoster(mediaData.posterUrl);
    const media = await prisma.media.create({
      data: {
        ...mediaData,
        posterUrl,
        tags: tagIds?.length ? {
          create: tagIds.map(tagId => ({ tagId })),
        } : undefined,
      },
      include: mediaInclude,
    });
    return serializeMedia(media);
  },

  async update(id: string, data: MediaUpdateRequest): Promise<Media> {
    const existing = await prisma.media.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Media not found', 404);
    }

    const { tagIds, ...mediaData } = data;

    // 下载外部封面图到本地
    if (mediaData.posterUrl !== undefined) {
      mediaData.posterUrl = await resolveExternalPoster(mediaData.posterUrl) ?? undefined;
    }

    // M11: 使用事务确保 tag 替换的原子性
    const media = await prisma.$transaction(async (tx) => {
      if (tagIds !== undefined) {
        await tx.mediaTag.deleteMany({ where: { mediaId: id } });
        if (tagIds.length > 0) {
          await tx.mediaTag.createMany({
            data: tagIds.map(tagId => ({ mediaId: id, tagId })),
          });
        }
      }
      return tx.media.update({
        where: { id },
        data: mediaData,
        include: mediaInclude,
      });
    });

    return serializeMedia(media);
  },

  async delete(id: string): Promise<void> {
    const existing = await prisma.media.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Media not found', 404);
    }
    await prisma.media.delete({ where: { id } });
    deleteThumbnail(id).catch(() => {});
  },

  async incrementViews(id: string): Promise<void> {
    await prisma.media.update({
      where: { id },
      data: { views: { increment: 1 } },
    });
  },

  async getRandom(count: number = 10): Promise<Media[]> {
    const safeCount = Math.min(Math.max(1, count), 50);
    // Use tagged template literal for type-safe parameterized query
    const randomIds = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM Media WHERE status = 'ACTIVE' ORDER BY RANDOM() LIMIT ${safeCount}`,
    );

    if (randomIds.length === 0) return [];

    const items = await prisma.media.findMany({
      where: { id: { in: randomIds.map(i => i.id) } },
      select: mediaListSelect,
    });
    return items.map(serializeMediaList);
  },

  async getRecent(count: number = 10): Promise<Media[]> {
    const safeCount = Math.min(Math.max(1, count), 50);
    const items = await prisma.media.findMany({
      where: { status: 'ACTIVE' },
      select: mediaListSelect,
      orderBy: { createdAt: 'desc' },
      take: safeCount,
    });
    return items.map(serializeMediaList);
  },

  async getArtists(): Promise<ArtistInfo[]> {
    const result = await prisma.media.groupBy({
      by: ['artist'],
      where: {
        status: 'ACTIVE',
        artist: { not: null },
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });
    return result
      .filter((r): r is typeof r & { artist: string } => r.artist !== null && r.artist !== '')
      .map(r => ({ name: r.artist, videoCount: r._count.id }));
  },
};
