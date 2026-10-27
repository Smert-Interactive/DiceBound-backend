import { ApiProperty } from '@nestjs/swagger';
import type { Prisma } from '../../../generated/prisma/client.js';

export const characterSelect = {
  id: true,
  ownerId: true,
  gameSystemId: true,
  sheetSchemaId: true,
  name: true,
  data: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { username: true } },
  versions: {
    select: { versionNumber: true },
    orderBy: { versionNumber: 'desc' },
    take: 1,
  },
} satisfies Prisma.CharacterSelect;

export const characterSummarySelect = {
  id: true,
  name: true,
  gameSystemId: true,
  updatedAt: true,
  sourceOwnerUsername: true,
  owner: { select: { username: true } },
  gameSystem: { select: { name: true } },
} satisfies Prisma.CharacterSelect;

type CharacterRow = Prisma.CharacterGetPayload<{
  select: typeof characterSelect;
}>;
type CharacterSummaryRow = Prisma.CharacterGetPayload<{
  select: typeof characterSummarySelect;
}>;

export class CharacterResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  owner_id: string;

  @ApiProperty({ format: 'uuid' })
  game_system_id: string;

  @ApiProperty({ format: 'uuid' })
  sheet_schema_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  data: Prisma.JsonValue;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  current_version_number: number;
}

export class CharacterDetailsDto extends CharacterResponseDto {
  @ApiProperty({ enum: ['OWNER', 'VIEW'] })
  access: 'OWNER' | 'VIEW';

  @ApiProperty()
  can_edit: boolean;

  @ApiProperty()
  can_view_history: boolean;

  @ApiProperty()
  owner_username: string;
}

export class CharacterSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ format: 'uuid' })
  game_system_id: string;

  @ApiProperty()
  game_system_name: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;

  @ApiProperty({ enum: ['OWNER', 'VIEW'] })
  access: 'OWNER' | 'VIEW';

  @ApiProperty()
  owner_username: string;

  @ApiProperty({ type: String, nullable: true })
  copy_source_owner_name: string | null;
}

export class CharacterListDto {
  @ApiProperty({ type: [CharacterSummaryDto] })
  owned: CharacterSummaryDto[];

  @ApiProperty({
    type: [CharacterSummaryDto],
    description: 'Reserved for Sharing integration; currently empty',
  })
  shared_view: CharacterSummaryDto[];
}

export class CharacterValidationIssueDto {
  @ApiProperty({ example: 'data.strength' })
  field: string;

  @ApiProperty()
  message: string;
}

export class CharacterValidationErrorDto {
  @ApiProperty({ example: 422 })
  statusCode: number;

  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code: string;

  @ApiProperty({ example: 'Invalid character data' })
  message: string;

  @ApiProperty({ format: 'date-time' })
  timestamp: string;

  @ApiProperty()
  path: string;

  @ApiProperty({ type: [CharacterValidationIssueDto] })
  details: CharacterValidationIssueDto[];
}

export function toCharacterResponse(
  character: CharacterRow,
): CharacterResponseDto {
  return {
    id: character.id,
    owner_id: character.ownerId,
    game_system_id: character.gameSystemId,
    sheet_schema_id: character.sheetSchemaId,
    name: character.name,
    data: character.data,
    created_at: character.createdAt.toISOString(),
    updated_at: character.updatedAt.toISOString(),
    current_version_number: character.versions[0].versionNumber,
  };
}

export function toCharacterDetails(
  character: CharacterRow,
): CharacterDetailsDto {
  return Object.assign(toCharacterResponse(character), {
    access: 'OWNER' as const,
    can_edit: true,
    can_view_history: true,
    owner_username: character.owner.username,
  });
}

export function toCharacterSummary(
  character: CharacterSummaryRow,
): CharacterSummaryDto {
  return {
    id: character.id,
    name: character.name,
    game_system_id: character.gameSystemId,
    game_system_name: character.gameSystem.name,
    updated_at: character.updatedAt.toISOString(),
    access: 'OWNER',
    owner_username: character.owner.username,
    copy_source_owner_name: character.sourceOwnerUsername,
  };
}
