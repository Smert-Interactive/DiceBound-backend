import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../decorators/public.decorator.js';
import type { AuthenticatedRequest } from '../../modules/auth/auth.types.js';
import { SessionService } from '../../modules/auth/session.service.js';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = await this.sessions.authenticate(
      this.sessions.readToken(request),
    );
    if (!auth) throw new UnauthorizedException('Authentication required');
    request.auth = auth;
    return true;
  }
}
