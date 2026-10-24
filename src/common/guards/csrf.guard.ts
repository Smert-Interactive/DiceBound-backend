import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly origins: Set<string>;

  constructor(config: ConfigService) {
    this.origins = new Set(config.getOrThrow<string[]>('ALLOWED_ORIGINS'));
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;

    // Also protects public login/register against login CSRF. Missing/null Origin fails closed.
    const origin = request.get('origin');
    if (!origin || !this.origins.has(origin)) {
      throw new ForbiddenException('Request origin is not allowed');
    }
    return true;
  }
}
