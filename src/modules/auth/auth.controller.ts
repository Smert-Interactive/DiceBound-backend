import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { AuthService } from './auth.service.js';
import { LoginDto, loginSchema } from './dto/login.dto.js';
import { RegisterDto, registerSchema } from './dto/register.dto.js';
import {
  CurrentUserResponseDto,
  UserResponseDto,
} from './dto/user-response.dto.js';
import { SESSION_COOKIE, SessionService } from './session.service.js';

@ApiTags('Auth')
@ApiForbiddenResponse({
  description: 'Missing or disallowed Origin on a state-changing request',
})
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a user without creating a session' })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid registration input' })
  @ApiConflictResponse({ description: 'Email is already registered' })
  @ApiResponse({ status: 429, description: 'Too many registration attempts' })
  register(@Body(new ZodValidationPipe(registerSchema)) input: RegisterDto) {
    return this.auth.register(input);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in and set an HttpOnly session cookie' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid login input' })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiResponse({ status: 429, description: 'Too many login attempts' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.auth.login(input);
    const session = await this.sessions.create(
      user.id,
      this.sessions.readToken(request),
    );
    response.setHeader('Cache-Control', 'no-store');
    this.sessions.setCookie(response, session);
    return user;
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOperation({ summary: 'Revoke the current session and clear its cookie' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revoke(request.auth.sessionId);
    this.sessions.clearCookie(response);
  }

  @Get('me')
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOperation({ summary: 'Get the current user and profile counts' })
  @ApiOkResponse({ type: CurrentUserResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  me(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.auth.me(request.auth.user);
  }
}
