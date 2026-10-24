import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { PrismaService } from '../../database/prisma.service.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SessionService,
} from './session.service.js';

function fixture(environment = 'test') {
  const prisma = {
    authSession: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findUnique: vi.fn(),
    },
  };
  const service = new SessionService(
    prisma as unknown as PrismaService,
    new ConfigService({ NODE_ENV: environment }),
  );
  return { service, prisma };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('SessionService', () => {
  it.each(['production', 'development'])(
    'uses matching cookie scope/flags when setting and clearing (%s)',
    (environment) => {
      const { service } = fixture(environment);
      const response = { cookie: vi.fn(), clearCookie: vi.fn() };
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      service.setCookie(response as unknown as Response, {
        token: 'token',
        expiresAt,
      });
      service.clearCookie(response as unknown as Response);
      const options = {
        httpOnly: true,
        secure: environment === 'production',
        sameSite: 'lax',
        path: '/api/v1',
      };
      expect(response.cookie).toHaveBeenCalledWith(
        SESSION_COOKIE,
        'token',
        expect.objectContaining({ ...options, expires: expiresAt }),
      );
      expect(response.clearCookie).toHaveBeenCalledWith(
        SESSION_COOKIE,
        options,
      );
    },
  );

  it('rejects a session exactly at its expiration boundary', async () => {
    const { service, prisma } = fixture();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    prisma.authSession.findUnique.mockResolvedValue({
      id: 'id',
      user: { id: 'user' },
      expiresAt: new Date(now),
    });
    expect(await service.authenticate('token')).toBeNull();
  });

  it('runs hourly cleanup and stops its timer on shutdown', async () => {
    vi.useFakeTimers();
    const { service, prisma } = fixture();
    service.onModuleInit();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(prisma.authSession.deleteMany).toHaveBeenCalledOnce();
    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(prisma.authSession.deleteMany).toHaveBeenCalledOnce();
  });
});
