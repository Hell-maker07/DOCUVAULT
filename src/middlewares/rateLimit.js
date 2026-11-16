import rateLimit from 'express-rate-limit';
import AppError from '../utils/AppError.js';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(new AppError('Too many requests, please try again later', 429, 'RATE_LIMITED'));
  },
  skip: () => process.env.NODE_ENV === 'test',
});
