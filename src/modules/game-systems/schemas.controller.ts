import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SESSION_COOKIE } from '../auth/session.service.js';
import { SheetSchemaResponseDto } from './dto/sheet-schema-response.dto.js';
import { GameSystemsService } from './game-systems.service.js';

@ApiTags('Sheet Schemas')
@ApiCookieAuth(SESSION_COOKIE)
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@Controller('api/v1/schemas')
export class SchemasController {
  constructor(private readonly systems: GameSystemsService) {}

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get a published sheet definition',
    description:
      'Available for a selectable system or a character owned by/shared with the current user through VIEW, including characters on archived systems.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SheetSchemaResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiNotFoundResponse({
    description: 'Sheet schema is missing or inaccessible',
  })
  get(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.systems.getSchema(request.auth.user.id, id);
  }
}
