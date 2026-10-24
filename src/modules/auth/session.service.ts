import { createHash, randomBytes } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { PrismaService } from '../../database/prisma.service.js';
import { publicUserSelect } from './auth.types.js';

export const SESSION_COOKIE = 'dicebound_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class SessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionService.name);
  private readonly cookieOptions: CookieOptions;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.cookieOptions = {
      httpOnly: true,
      secure: config.getOrThrow<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/api/v1',
    };
  }

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpired().catch(() =>
        this.logger.error('Expired session cleanup failed'),
      );
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  readToken(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
      ? token
      : undefined;
  }
  
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(userId: string, previousToken?: string) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      // Re-login rotates this browser's session, while other devices stay signed in.
      if (previousToken) {
        await tx.authSession.deleteMany({
          where: { tokenHash: this.hashToken(previousToken) },
        });
      }
      await tx.authSession.create({
        data: { userId, tokenHash: this.hashToken(token), expiresAt },
      });
    });
    return { token, expiresAt };
  }

  async authenticate(token?: string) {
    if (!token) return null;
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      select: { id: true, expiresAt: true, user: { select: publicUserSelect } },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) return null;
    return { sessionId: session.id, user: session.user };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.authSession.deleteMany({ where: { id: sessionId } });
  }

  async cleanupExpired(): Promise<void> {
    await this.prisma.authSession.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
  }

  setCookie(
    response: Response,
    session: { token: string; expiresAt: Date },
  ): void {
    response.cookie(SESSION_COOKIE, session.token, {
      ...this.cookieOptions,
      maxAge: Math.max(0, session.expiresAt.getTime() - Date.now()),
      expires: session.expiresAt,
    });
  }

  clearCookie(response: Response): void {
    response.clearCookie(SESSION_COOKIE, this.cookieOptions);
  }
}
