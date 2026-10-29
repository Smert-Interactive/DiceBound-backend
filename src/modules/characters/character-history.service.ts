import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  characterSelect,
  toCharacterResponse,
} from './dto/character-response.dto.js';
import type {
  CharacterVersionDto,
  CharacterVersionSummaryDto,
  RestoreResultDto,
} from './dto/character-history-response.dto.js';

function historyAccess(userId: string): Prisma.CharacterWhereInput {
  return {
    OR: [
      { ownerId: userId },
      {
        shares: { some: { userId, permission: 'VIEW', historyVisible: true } },
      },
    ],
  };
}

@Injectable()
export class CharacterHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    characterId: string,
  ): Promise<CharacterVersionSummaryDto[]> {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, ...historyAccess(userId) },
      select: {
        versions: {
          select: { id: true, versionNumber: true, createdAt: true },
          orderBy: { versionNumber: 'desc' },
        },
      },
    });
    if (!character) throw new NotFoundException('Character not found');
    return character.versions.map((version, index) => ({
      id: version.id,
      version_number: version.versionNumber,
      created_at: version.createdAt.toISOString(),
      is_current: index === 0,
    }));
  }

  async get(
    userId: string,
    characterId: string,
    versionNumber: number,
  ): Promise<CharacterVersionDto> {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, ...historyAccess(userId) },
      select: {
        versions: {
          where: { versionNumber },
          select: {
            id: true,
            characterId: true,
            versionNumber: true,
            data: true,
            createdAt: true,
          },
          take: 1,
        },
      },
    });
    const version = character?.versions[0];
    if (!version) throw new NotFoundException('Version not found');
    return {
      id: version.id,
      character_id: version.characterId,
      version_number: version.versionNumber,
      data: version.data,
      created_at: version.createdAt.toISOString(),
    };
  }

  async restore(
    userId: string,
    characterId: string,
    versionNumber: number,
  ): Promise<RestoreResultDto> {
    return this.prisma.$transaction(
      async (tx) => {
        // Use the same owner-scoped lock as save(), before reading any versions.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM characters
          WHERE id = ${characterId}::uuid AND owner_id = ${userId}::uuid
          FOR UPDATE
        `;
        if (locked.length === 0)
          throw new NotFoundException('Character not found');

        const target = await tx.characterVersion.findUnique({
          where: { characterId_versionNumber: { characterId, versionNumber } },
          select: { data: true },
        });
        if (!target) throw new NotFoundException('Version not found');
        const latest = await tx.characterVersion.findFirst({
          where: { characterId },
          select: { versionNumber: true },
          orderBy: { versionNumber: 'desc' },
        });
        if (latest?.versionNumber === versionNumber) {
          throw new ConflictException({
            code: 'RESTORE_NOT_ALLOWED',
            message: 'Cannot restore the current version',
          });
        }

        // Snapshots already include calculated fields. Preserve them verbatim.
        await tx.character.update({
          where: { id: characterId },
          data: { data: target.data as Prisma.InputJsonValue },
        });
        const deleted = await tx.characterVersion.deleteMany({
          where: { characterId, versionNumber: { gt: versionNumber } },
        });
        const character = await tx.character.findUniqueOrThrow({
          where: { id: characterId },
          select: characterSelect,
        });
        return {
          character: toCharacterResponse(character),
          deleted_versions_count: deleted.count,
        };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
}
