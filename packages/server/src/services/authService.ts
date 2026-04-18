import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';
import { verifyJwt } from '../utils/verifyJwt.js';
import type { TokenPayload, AuthResponse, User } from '@m3u8-preview/shared';
import { UserRole } from '@m3u8-preview/shared';

/** Hash a refresh token with SHA-256 for secure storage */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createTokenFamilyId(): string {
  return crypto.randomUUID();
}

const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiresIn,
    algorithm: 'HS256',
    keyid: config.jwt.kid,
  } as jwt.SignOptions);
}

function generateRefreshToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
    algorithm: 'HS256',
    keyid: config.jwt.kid,
  } as jwt.SignOptions);
}

function sanitizeUser(user: any): User {
  const { passwordHash, ...rest } = user;
  return {
    ...rest,
    createdAt: rest.createdAt.toISOString(),
    updatedAt: rest.updatedAt.toISOString(),
  };
}

export const authService = {
  async register(username: string, password: string): Promise<AuthResponse & { refreshToken: string }> {
    // Check if registration is allowed
    const regSetting = await prisma.systemSetting.findUnique({ where: { key: 'allowRegistration' } });
    if (regSetting && regSetting.value === 'false') {
      throw new AppError('注册功能已关闭', 403);
    }

    // Check if user exists
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      throw new AppError('用户名已存在', 409);
    }

    const passwordHash = await bcrypt.hash(password, config.bcrypt.saltRounds);
    const user = await prisma.user.create({
      data: { username, passwordHash },
    });

    const tokenPayload: TokenPayload = { userId: user.id, role: user.role as UserRole };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Save hashed refresh token
    await prisma.refreshToken.create({
      data: {
        token: hashToken(refreshToken),
        familyId: createTokenFamilyId(),
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
      },
    });

    // M9: 注册也返回 refreshToken，与 login 一致
    return {
      user: sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  },

  async login(username: string, password: string): Promise<AuthResponse & { refreshToken: string }> {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      throw new AppError('用户名或密码错误', 401);
    }
    if (!user.isActive) {
      throw new AppError('账户已被禁用', 403);
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new AppError('用户名或密码错误', 401);
    }

    const tokenPayload: TokenPayload = { userId: user.id, role: user.role as UserRole };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Save hashed refresh token
    await prisma.refreshToken.create({
      data: {
        token: hashToken(refreshToken),
        familyId: createTokenFamilyId(),
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
      },
    });

    return {
      user: sanitizeUser(user),
      accessToken,
      refreshToken,
    };
  },

  async refresh(token: string): Promise<{ accessToken: string; refreshToken: string; user: User }> {
    // Verify the refresh token（支持 kid 轮换）
    let payload: TokenPayload;
    try {
      payload = verifyJwt<TokenPayload>(token, 'refresh');
    } catch {
      throw new AppError('Invalid refresh token', 401);
    }

    // Check if hashed token exists in DB
    const tokenHash = hashToken(token);
    const storedToken = await prisma.refreshToken.findUnique({ where: { token: tokenHash } });

    if (!storedToken) {
      // M3: 重放检测 — token 不在 DB 中，可能是已被轮换消费过的旧 token
      // 攻击者可能窃取了旧 token 并在合法用户之后使用
      // 安全策略：删除该用户所有同 family 的 token，强制重新登录
      console.warn('[auth] refresh token reuse detected', { userId: payload.userId });
      await prisma.refreshToken.deleteMany({ where: { userId: payload.userId } });
      throw new AppError('Refresh token reuse detected, all sessions revoked', 401);
    }

    if (storedToken.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new AppError('Refresh token expired', 401);
    }

    // Get fresh user data
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) {
      throw new AppError('User not found or inactive', 401);
    }

    // Rotate refresh token: delete old, create new with same familyId
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });

    const newPayload: TokenPayload = { userId: user.id, role: user.role as UserRole };
    const accessToken = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken(newPayload);

    await prisma.refreshToken.create({
      data: {
        token: hashToken(newRefreshToken),
        familyId: storedToken.familyId,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
      },
    });

    return { accessToken, refreshToken: newRefreshToken, user: sanitizeUser(user) };
  },

  async logout(token: string): Promise<void> {
    await prisma.refreshToken.deleteMany({ where: { token: hashToken(token) } });
  },

  async getRegisterStatus(): Promise<boolean> {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'allowRegistration' } });
    // 默认允许注册（未设置时）
    return !setting || setting.value !== 'false';
  },

  async getProfile(userId: string): Promise<User> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError('User not found', 404);
    }
    return sanitizeUser(user);
  },

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError('用户不存在', 404);
    }

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) {
      throw new AppError('旧密码错误', 401);
    }

    const newHash = await bcrypt.hash(newPassword, config.bcrypt.saltRounds);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newHash },
      }),
      // 删除该用户所有 refresh token，强制所有设备重新登录
      prisma.refreshToken.deleteMany({ where: { userId } }),
    ]);
  },
};
