import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { resolveExternalPoster } from './posterDownloadService.js';
import type { Playlist, PlaylistItem } from '@m3u8-preview/shared';
import { serializePlaylist, serializePlaylistItem } from '../utils/serializers.js';

const playlistItemInclude = {
  media: {
    include: {
      category: true,
      tags: { include: { tag: true } },
    },
  },
};

export const playlistService = {
  async findAll(userId: string): Promise<Playlist[]> {
    const playlists = await prisma.playlist.findMany({
      where: { userId },
      include: {
        _count: { select: { items: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return playlists.map(serializePlaylist);
  },

  async findById(id: string, userId: string): Promise<Playlist> {
    const playlist = await prisma.playlist.findUnique({
      where: { id },
      include: {
        items: {
          include: playlistItemInclude,
          orderBy: { position: 'asc' },
        },
        _count: { select: { items: true } },
      },
    });

    if (!playlist) {
      throw new AppError('Playlist not found', 404);
    }

    // Only owner or public playlists can be accessed
    if (playlist.userId !== userId && !playlist.isPublic) {
      throw new AppError('Access denied', 403);
    }

    return serializePlaylist(playlist);
  },

  async create(userId: string, data: { name: string; description?: string; posterUrl?: string; isPublic?: boolean }): Promise<Playlist> {
    const posterUrl = await resolveExternalPoster(data.posterUrl);
    const playlist = await prisma.playlist.create({
      data: {
        name: data.name,
        description: data.description || null,
        posterUrl: posterUrl || null,
        isPublic: data.isPublic ?? true,
        userId,
      },
      include: {
        _count: { select: { items: true } },
      },
    });
    return serializePlaylist(playlist);
  },

  async update(id: string, userId: string, data: { name?: string; description?: string; posterUrl?: string; isPublic?: boolean }): Promise<Playlist> {
    const existing = await prisma.playlist.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Playlist not found', 404);
    }
    if (existing.userId !== userId) {
      throw new AppError('Access denied', 403);
    }

    // 下载外部封面图到本地
    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.posterUrl !== undefined) {
      updateData.posterUrl = await resolveExternalPoster(data.posterUrl) || null;
    }
    if (data.isPublic !== undefined) updateData.isPublic = data.isPublic;

    const playlist = await prisma.playlist.update({
      where: { id },
      data: updateData,
      include: {
        _count: { select: { items: true } },
      },
    });
    return serializePlaylist(playlist);
  },

  async delete(id: string, userId: string): Promise<void> {
    const existing = await prisma.playlist.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Playlist not found', 404);
    }
    if (existing.userId !== userId) {
      throw new AppError('Access denied', 403);
    }
    await prisma.playlist.delete({ where: { id } });
  },

  async addItem(playlistId: string, userId: string, mediaId: string): Promise<PlaylistItem> {
    const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
    if (!playlist) {
      throw new AppError('Playlist not found', 404);
    }
    if (playlist.userId !== userId) {
      throw new AppError('Access denied', 403);
    }

    // Check media exists
    const media = await prisma.media.findUnique({ where: { id: mediaId } });
    if (!media) {
      throw new AppError('Media not found', 404);
    }

    // Check if already in playlist
    const existingItem = await prisma.playlistItem.findUnique({
      where: { playlistId_mediaId: { playlistId, mediaId } },
    });
    if (existingItem) {
      throw new AppError('Media already in playlist', 409);
    }

    // Get max position and create item in a transaction to prevent race conditions
    const item = await prisma.$transaction(async (tx) => {
      const maxPosition = await tx.playlistItem.aggregate({
        where: { playlistId },
        _max: { position: true },
      });
      const nextPosition = (maxPosition._max.position ?? -1) + 1;

      return tx.playlistItem.create({
        data: {
          playlistId,
          mediaId,
          position: nextPosition,
        },
        include: playlistItemInclude,
      });
    });

    return serializePlaylistItem(item);
  },

  async removeItem(playlistId: string, userId: string, mediaId: string): Promise<void> {
    const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
    if (!playlist) {
      throw new AppError('Playlist not found', 404);
    }
    if (playlist.userId !== userId) {
      throw new AppError('Access denied', 403);
    }

    const item = await prisma.playlistItem.findUnique({
      where: { playlistId_mediaId: { playlistId, mediaId } },
    });
    if (!item) {
      throw new AppError('Item not found in playlist', 404);
    }

    await prisma.playlistItem.delete({
      where: { id: item.id },
    });
  },

  async reorderItems(playlistId: string, userId: string, itemIds: string[]): Promise<void> {
    const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
    if (!playlist) {
      throw new AppError('Playlist not found', 404);
    }
    if (playlist.userId !== userId) {
      throw new AppError('Access denied', 403);
    }

    // M10: 校验 itemIds 都属于该 playlist，并使用事务批量更新（消除 N+1）
    const existingItems = await prisma.playlistItem.findMany({
      where: { playlistId },
      select: { id: true },
    });
    const existingSet = new Set(existingItems.map(i => i.id));
    const invalidIds = itemIds.filter(id => !existingSet.has(id));
    if (invalidIds.length > 0) {
      throw new AppError('Some item IDs do not belong to this playlist', 400);
    }

    await prisma.$transaction(
      itemIds.map((itemId, i) =>
        prisma.playlistItem.update({
          where: { id: itemId },
          data: { position: i },
        }),
      ),
    );
  },

  async getPlaylistItems(
    playlistId: string,
    userId: string | undefined,
    page: number,
    limit: number,
    options?: { search?: string; sortBy?: string; sortOrder?: 'asc' | 'desc' },
  ): Promise<{ items: PlaylistItem[]; total: number; page: number; limit: number; totalPages: number }> {
    const { search, sortBy = 'position', sortOrder = 'asc' } = options || {};
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const skip = (page - 1) * safeLimit;

    // 检查合集是否存在
    const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } });
    if (!playlist) {
      throw new AppError('Playlist not found', 404);
    }

    // 访问权限：公开合集任何人可访问，私有合集仅 owner
    if (!playlist.isPublic) {
      if (!userId || playlist.userId !== userId) {
        throw new AppError('Access denied', 403);
      }
    }

    // 构建查询条件
    const where: any = { playlistId };
    if (search) {
      where.media = { title: { contains: search } };
    }

    // 构建排序
    let orderBy: any;
    switch (sortBy) {
      case 'title':
        orderBy = { media: { title: sortOrder } };
        break;
      case 'year':
        orderBy = { media: { year: sortOrder } };
        break;
      case 'createdAt':
        orderBy = { media: { createdAt: sortOrder } };
        break;
      case 'position':
      default:
        orderBy = { position: sortOrder };
        break;
    }

    const [items, total] = await Promise.all([
      prisma.playlistItem.findMany({
        where,
        include: playlistItemInclude,
        orderBy,
        skip,
        take: safeLimit,
      }),
      prisma.playlistItem.count({ where }),
    ]);

    return {
      items: items.map(serializePlaylistItem),
      total,
      page,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  },

  async getPublicPlaylists(page: number = 1, limit: number = 20, options?: { search?: string; sortBy?: string; sortOrder?: 'asc' | 'desc' }): Promise<{ items: Playlist[]; total: number; page: number; limit: number; totalPages: number }> {
    const { search, sortBy = 'updatedAt', sortOrder = 'desc' } = options || {};
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const skip = (page - 1) * safeLimit;

    const where: any = { isPublic: true };
    if (search) {
      where.name = { contains: search };
    }

    let orderBy: any;
    if (sortBy === 'itemCount') {
      orderBy = { items: { _count: sortOrder } };
    } else {
      orderBy = { [sortBy]: sortOrder };
    }

    const [playlists, total] = await Promise.all([
      prisma.playlist.findMany({
        where,
        include: {
          user: { select: { username: true } },
          _count: { select: { items: true } },
        },
        orderBy,
        skip,
        take: safeLimit,
      }),
      prisma.playlist.count({ where }),
    ]);

    return {
      items: playlists.map((p) => {
        const serialized = serializePlaylist(p);
        const { userId: _uid, ...rest } = serialized;
        return rest;
      }),
      total,
      page,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  },
};
