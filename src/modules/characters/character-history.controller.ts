import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SESSION_COOKIE } from '../auth/session.service.js';
import { CharacterHistoryService } from './character-history.service.js';
import {
  CharacterVersionDto,
  CharacterVersionSummaryDto,
  RestoreResultDto,
} from './dto/character-history-response.dto.js';
import { ParseVersionNumberPipe } from './parse-version-number.pipe.js';

@ApiTags('Character history')
@ApiCookieAuth(SESSION_COOKIE)
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@ApiBadRequestResponse({
  description: 'Invalid UUID or positive version number',
})
@ApiNotFoundResponse({
  description: 'Character or version is missing or inaccessible',
})
@ApiParam({ name: 'id', format: 'uuid' })
@Controller('api/v1/characters/:id/versions')
export class CharacterHistoryController {
  constructor(private readonly history: CharacterHistoryService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List version metadata for OWNER or VIEW with visible history',
  })
  @ApiOkResponse({ type: [CharacterVersionSummaryDto] })
  list(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.history.list(request.auth.user.id, id);
  }

  @Get(':versionNumber')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Read a full historical snapshot without recalculating fields',
  })
  @ApiParam({
    name: 'versionNumber',
    schema: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
  })
  @ApiOkResponse({ type: CharacterVersionDto })
  get(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('versionNumber', new ParseVersionNumberPipe()) versionNumber: number,
  ) {
    return this.history.get(request.auth.user.id, id, versionNumber);
  }

  @Post(':versionNumber/restore')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Restore an older snapshot and delete newer versions (OWNER only)',
  })
  @ApiParam({
    name: 'versionNumber',
    schema: { type: 'integer', minimum: 1, maximum: 2_147_483_647 },
  })
  @ApiOkResponse({ type: RestoreResultDto })
  @ApiForbiddenResponse({ description: 'Missing or disallowed Origin' })
  @ApiConflictResponse({
    description: 'RESTORE_NOT_ALLOWED: the version is already current',
  })
  restore(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('versionNumber', new ParseVersionNumberPipe()) versionNumber: number,
  ) {
    return this.history.restore(request.auth.user.id, id, versionNumber);
  }
}
