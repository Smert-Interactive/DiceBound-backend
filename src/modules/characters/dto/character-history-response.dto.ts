import { ApiProperty } from '@nestjs/swagger';
import type { Prisma } from '../../../generated/prisma/client.js';
import { CharacterResponseDto } from './character-response.dto.js';

export class CharacterVersionSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version_number: number;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty()
  is_current: boolean;
}

export class CharacterVersionDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  character_id: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version_number: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  data: Prisma.JsonValue;

  @ApiProperty({ format: 'date-time' })
  created_at: string;
}

export class RestoreResultDto {
  @ApiProperty({ type: CharacterResponseDto })
  character: CharacterResponseDto;

  @ApiProperty({ type: 'integer', minimum: 1 })
  deleted_versions_count: number;
}
