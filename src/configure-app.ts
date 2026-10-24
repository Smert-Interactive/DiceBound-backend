import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';

/** Shared by the HTTP entry point and E2E applications. */
export function configureApp(app: INestApplication): void {
  const origins = app
    .get(ConfigService)
    .getOrThrow<string[]>('ALLOWED_ORIGINS');
  app.use(cookieParser());
  app.enableCors({ origin: origins, credentials: true });
}
