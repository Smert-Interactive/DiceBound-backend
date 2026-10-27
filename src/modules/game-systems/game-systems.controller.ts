import {
  Body,
  Controller,
  Delete,
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
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SESSION_COOKIE } from '../auth/session.service.js';
import { GameSystemResponseDto } from './dto/game-system-response.dto.js';
import { SheetSchemaSummaryResponseDto } from './dto/sheet-schema-response.dto.js';
import { GameSystemsService } from './game-systems.service.js';
import {
  ImportGameSystemDto,
  importGameSystemSchema,
  ValidateGameSystemDto,
  validateGameSystemSchema,
} from './dto/import-game-system.dto.js';
import {
  ImportedSystemResponseDto,
  SchemaImportErrorResponseDto,
  SchemaValidationResponseDto,
} from './dto/schema-validation-response.dto.js';

@ApiTags('Game Systems')
@ApiCookieAuth(SESSION_COOKIE)
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@Controller('api/v1/systems')
export class GameSystemsController {
  constructor(private readonly systems: GameSystemsService) {}

  @Post('import/validate')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Validate a JSON sheet definition without storing it',
  })
  @ApiOkResponse({
    type: SchemaValidationResponseDto,
    description: 'Invalid JSON/schemas also return 200 with valid=false',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request body or schema_text over 64 KiB',
  })
  @ApiForbiddenResponse({ description: 'Missing or disallowed Origin' })
  validate(
    @Body(new ZodValidationPipe(validateGameSystemSchema))
    input: ValidateGameSystemDto,
  ) {
    return this.systems.validate(input.schema_text);
  }

  @Post('import')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Import a private game system and its published schema atomically',
  })
  @ApiCreatedResponse({ type: ImportedSystemResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid request body or schema_text over 64 KiB',
  })
  @ApiForbiddenResponse({ description: 'Missing or disallowed Origin' })
  @ApiUnprocessableEntityResponse({ type: SchemaImportErrorResponseDto })
  import(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(importGameSystemSchema))
    input: ImportGameSystemDto,
  ) {
    return this.systems.import(request.auth.user.id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Archive an owned imported system while retaining characters and schemas',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiForbiddenResponse({
    description: 'Built-in system or missing/disallowed Origin',
  })
  @ApiNotFoundResponse({
    description: 'Game system is missing, archived or inaccessible',
  })
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.systems.remove(request.auth.user.id, id);
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'List active built-in systems and the current user’s imported systems',
  })
  @ApiOkResponse({ type: GameSystemResponseDto, isArray: true })
  list(@Req() request: AuthenticatedRequest) {
    return this.systems.list(request.auth.user.id);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Get a selectable game system' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: GameSystemResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiNotFoundResponse({
    description: 'Game system is missing or inaccessible',
  })
  get(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.systems.get(request.auth.user.id, id);
  }

  @Get(':id/schemas')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'List sheet schemas for a selectable game system' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SheetSchemaSummaryResponseDto, isArray: true })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiNotFoundResponse({
    description: 'Game system is missing or inaccessible',
  })
  schemas(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.systems.listSchemas(request.auth.user.id, id);
  }
}
