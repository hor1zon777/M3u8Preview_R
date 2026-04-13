import { prisma } from '../lib/prisma.js';
import { UAParser } from 'ua-parser-js';
import type { PaginatedResponse } from '@m3u8-preview/shared';
import type { LoginRecord, UserActivitySummary, UserActivityAggregate } from '@m3u8-preview/shared';

export const loginRecordService = {
  /**
   * 创建登录记录，解析 UA 后写入数据库
   */
  async createRecord(userId: string, ip: string | null, rawUA: string | null): Promise<void> {
    let browser: string | null = null;
    let os: string | null = null;
    let device: string | null = null;

    if (rawUA) {
      const result = new UAParser(rawUA).getResult();
      const b = result.browser;
      const o = result.os;
      const d = result.device;
      browser = b.name ? `${b.name} ${b.version || ''}`.trim() : null;
      os = o.name ? `${o.name} ${o.version || ''}`.trim() : null;
      device = d.type || 'Desktop';
    }

    await prisma.loginRecord.create({
      data: { userId, ip, userAgent: rawUA, browser, os, device },
    });
  },

  /**
   * 分页查询某用户的登录记录
   */
  async getRecordsByUser(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponse<LoginRecord>> {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      prisma.loginRecord.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.loginRecord.count({ where: { userId } }),
    ]);

    return {
      items: items.map(r => ({
        ...r,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      })) as LoginRecord[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  /**
   * 获取用户活动概览统计（含用户基本信息）
   */
  async getActivitySummary(userId: string): Promise<UserActivitySummary & { user: { username: string; role: string; isActive: boolean; createdAt: string } | null }> {
    const [user, loginCount, lastLogin, watchCount, completedCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, role: true, isActive: true, createdAt: true },
      }),
      prisma.loginRecord.count({ where: { userId } }),
      prisma.loginRecord.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, ip: true, browser: true, os: true, device: true },
      }),
      prisma.watchHistory.count({ where: { userId } }),
      prisma.watchHistory.count({ where: { userId, completed: true } }),
    ]);

    return {
      user: user
        ? {
            ...user,
            createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : String(user.createdAt),
          }
        : null,
      totalLogins: loginCount,
      lastLogin: lastLogin
        ? {
            ...lastLogin,
            createdAt: lastLogin.createdAt instanceof Date
              ? lastLogin.createdAt.toISOString()
              : String(lastLogin.createdAt),
          }
        : null,
      totalWatched: watchCount,
      totalCompleted: completedCount,
    };
  },

  /**
   * 获取所有用户行为聚合数据
   */
  async getActivityAggregate(): Promise<UserActivityAggregate> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);
    const weekStart = new Date(todayStart.getTime() - 7 * 86400000);

    const [
      totalLogins,
      uniqueUsers,
      todayLogins,
      yesterdayLogins,
      last7DaysLogins,
      totalWatchRecords,
      totalCompleted,
      // Sum of progress as rough watch time estimate
      { _sum: watchTimeSum },
      recentLoginsRaw,
      topWatchedRaw,
      topActiveUsersRaw,
    ] = await Promise.all([
      // Login stats
      prisma.loginRecord.count(),
      prisma.loginRecord.findMany({
        select: { userId: true },
        distinct: ['userId'],
      }).then(r => r.length),
      prisma.loginRecord.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.loginRecord.count({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.loginRecord.count({ where: { createdAt: { gte: weekStart } } }),
      // Watch stats
      prisma.watchHistory.count(),
      prisma.watchHistory.count({ where: { completed: true } }),
      prisma.watchHistory.aggregate({ _sum: { progress: true } }),
      // Recent logins (last 20)
      prisma.loginRecord.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, userId: true, ip: true, browser: true, os: true, device: true, createdAt: true,
        },
      }),
      // Top watched media
      prisma.watchHistory.groupBy({
        by: ['mediaId'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      // Top active users
      prisma.loginRecord.groupBy({
        by: ['userId'],
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
    ]);

    // Get media titles for top watched
    const mediaIds = topWatchedRaw.map(r => r.mediaId);
    const mediaMap = await prisma.media.findMany({
      where: { id: { in: mediaIds } },
      select: { id: true, title: true },
    });
    const mediaTitleMap = new Map(mediaMap.map(m => [m.id, m.title]));

    // Get watch completed count per media
    const completedByMedia = await prisma.watchHistory.groupBy({
      by: ['mediaId'],
      _count: { id: true },
      where: { mediaId: { in: mediaIds }, completed: true },
    });
    const completedMap = new Map(completedByMedia.map(r => [r.mediaId, r._count.id]));

    const topWatchedMedia = topWatchedRaw.map(r => ({
      mediaId: r.mediaId,
      title: mediaTitleMap.get(r.mediaId) || '未知',
      watchCount: r._count.id,
      completedCount: completedMap.get(r.mediaId) || 0,
    }));

    // Get usernames for top active users
    const topUserIds = topActiveUsersRaw.map(r => r.userId);
    const userMap = await prisma.user.findMany({
      where: { id: { in: topUserIds } },
      select: { id: true, username: true },
    });
    const usernameMap = new Map(userMap.map(u => [u.id, u.username]));

    // Get watch count per user for top active users
    const watchCountByUser = await prisma.watchHistory.groupBy({
      by: ['userId'],
      _count: { id: true },
      where: { userId: { in: topUserIds } },
    });
    const watchCountMap = new Map(watchCountByUser.map(r => [r.userId, r._count.id]));

    const topActiveUsers = topActiveUsersRaw.map(r => ({
      userId: r.userId,
      username: usernameMap.get(r.userId) || '未知',
      loginCount: r._count.id,
      watchCount: watchCountMap.get(r.userId) || 0,
    }));

    // Recent logins with username
    const recentLoginUserIds = [...new Set(recentLoginsRaw.map(r => r.userId))];
    const recentUsers = await prisma.user.findMany({
      where: { id: { in: recentLoginUserIds } },
      select: { id: true, username: true },
    });
    const recentUserMap = new Map(recentUsers.map(u => [u.id, u.username]));

    const recentLogins = recentLoginsRaw.map(r => ({
      ...r,
      username: recentUserMap.get(r.userId) || null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));

    return {
      loginStats: {
        totalLogins,
        uniqueUsers,
        todayLogins,
        yesterdayLogins,
        last7DaysLogins,
      },
      watchStats: {
        totalWatchRecords,
        totalCompleted,
        totalWatchTime: watchTimeSum?.progress || 0,
      },
      recentLogins,
      topWatchedMedia,
      topActiveUsers,
    };
  },
};
