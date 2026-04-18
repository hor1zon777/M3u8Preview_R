import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService.js';
import { loginRecordService } from '../services/loginRecordService.js';
import { getClientIp } from '../utils/getClientIp.js';

export const authController = {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { username, password } = req.body;
      const { refreshToken, ...result } = await authService.register(username, password);

      // M9: 注册也设置 refreshToken cookie，避免需要二次登录
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/api/v1/auth',
      });

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { username, password } = req.body;
      const { refreshToken, ...result } = await authService.login(username, password);

      // 记录登录行为（fire-and-forget，不阻塞登录响应）
      const ip = getClientIp(req);
      const userAgent = req.headers['user-agent'] || null;
      loginRecordService.createRecord(result.user.id, ip, userAgent).catch(err => {
        console.error('Failed to record login:', err);
      });

      // Set refresh token as httpOnly cookie
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/api/v1/auth',
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.refreshToken;
      if (!token) {
        res.status(401).json({ success: false, error: 'No refresh token provided' });
        return;
      }

      const { accessToken, refreshToken: newRefreshToken, user } = await authService.refresh(token);

      res.cookie('refreshToken', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/v1/auth',
      });

      res.json({ success: true, data: { accessToken, user } });
    } catch (error) {
      next(error);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies?.refreshToken;
      if (token) {
        await authService.logout(token);
      }

      res.clearCookie('refreshToken', {
        path: '/api/v1/auth',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
      res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  },

  async getRegisterStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const allowRegistration = await authService.getRegisterStatus();
      res.json({ success: true, data: { allowRegistration } });
    } catch (error) {
      next(error);
    }
  },

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await authService.getProfile(req.user!.userId);
      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  },

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { oldPassword, newPassword } = req.body;
      await authService.changePassword(req.user!.userId, oldPassword, newPassword);

      // 清除当前设备的 refreshToken cookie
      res.clearCookie('refreshToken', {
        path: '/api/v1/auth',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });

      res.json({ success: true, message: '密码修改成功，请重新登录' });
    } catch (error) {
      next(error);
    }
  },
};
