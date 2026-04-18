import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';

export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  // 生产环境只记录 eventId，避免 stack 泄露表名/SQL/路径等到集中日志
  const eventId = crypto.randomUUID();
  if (config.nodeEnv === 'production') {
    // 仅输出定位信息，不含 stack
    console.error(`[error] eventId=${eventId} name=${err.name}`);
  } else {
    console.error(`[error] eventId=${eventId} unexpected error:`, err);
  }

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    eventId,
  });
}
