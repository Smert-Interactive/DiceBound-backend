import { ApiProperty } from '@nestjs/swagger';
import type { Prisma } from '../../../generated/prisma/client.js';

export const gameSystemSummarySelect = {
  id: true,
  ownerId: true,
  name: true,
  description: true,
  source: true,
  createdAt: true,
  _count: { select: { characters: true } },
} satisfies Prisma.GameSystemSelect;

type GameSystemSummary = Prisma.GameSystemGetPayload<{
  select: typeof gameSystemSummarySelect;
}>;

export class GameSystemResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  owner_id: string | null;

  @ApiProperty()
  name: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ enum: ['BUILT_IN', 'IMPORTED'] })
  source: 'BUILT_IN' | 'IMPORTED';

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'All characters using this system, regardless of owner',
  })
  character_count: number;

  @ApiProperty({ format: 'date-time' })
  created_at: string;
}

export function toGameSystemResponse(
  system: GameSystemSummary,
): GameSystemResponseDto {
  return {
    id: system.id,
    owner_id: system.ownerId,
    name: system.name,
    description: system.description,
    source: system.source === 'BUILTIN' ? 'BUILT_IN' : 'IMPORTED',
    character_count: system._count.characters,
    created_at: system.createdAt.toISOString(),
  };
}
