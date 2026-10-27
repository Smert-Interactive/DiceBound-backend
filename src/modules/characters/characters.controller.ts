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
  Put,
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
import { CharactersService } from './characters.service.js';
import {
  CreateCharacterDto,
  createCharacterSchema,
} from './dto/create-character.dto.js';
import {
  SaveCharacterDto,
  saveCharacterSchema,
} from './dto/save-character.dto.js';
import {
  CharacterDetailsDto,
  CharacterListDto,
  CharacterResponseDto,
  CharacterValidationErrorDto,
} from './dto/character-response.dto.js';

@ApiTags('Characters')
@ApiCookieAuth(SESSION_COOKIE)
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@Controller('api/v1/characters')
export class CharactersController {
  constructor(private readonly characters: CharactersService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List owned characters and independent EDIT copies',
  })
  @ApiOkResponse({ type: CharacterListDto })
  list(@Req() request: AuthenticatedRequest) {
    return this.characters.list(request.auth.user.id);
  }

  @Post()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Create a draft character and its initial full snapshot v1',
  })
  @ApiCreatedResponse({ type: CharacterResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid request body' })
  @ApiForbiddenResponse({ description: 'Missing or disallowed Origin' })
  @ApiNotFoundResponse({
    description: 'Schema is unavailable or belongs to another system',
  })
  @ApiUnprocessableEntityResponse({ type: CharacterValidationErrorDto })
  create(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createCharacterSchema))
    input: CreateCharacterDto,
  ) {
    return this.characters.create(request.auth.user.id, input);
  }

  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Get an owned character and owner permissions' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CharacterDetailsDto })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiNotFoundResponse({ description: 'Character is missing or inaccessible' })
  get(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.characters.get(request.auth.user.id, id);
  }

  @Put(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Replace all user fields, calculate derived fields and create one snapshot',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CharacterDetailsDto })
  @ApiBadRequestResponse({ description: 'Invalid UUID or request body' })
  @ApiForbiddenResponse({ description: 'Missing or disallowed Origin' })
  @ApiNotFoundResponse({ description: 'Character is missing or inaccessible' })
  @ApiUnprocessableEntityResponse({ type: CharacterValidationErrorDto })
  save(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(saveCharacterSchema)) input: SaveCharacterDto,
  ) {
    return this.characters.save(request.auth.user.id, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Delete an owned character, history and shares, preserving independent copies',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  @ApiForbiddenResponse({ description: 'Missing or disallowed Origin' })
  @ApiNotFoundResponse({ description: 'Character is missing or inaccessible' })
  async remove(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.characters.remove(request.auth.user.id, id);
  }
}
