import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { sheetSchema } from '../game-systems/validation/sheet-schema.schema.js';
import { CharacterDataValidator } from './character-data.validator.js';
import type { CreateCharacterDto } from './dto/create-character.dto.js';
import type { SaveCharacterDto } from './dto/save-character.dto.js';
import {
  characterSelect,
  characterSummarySelect,
  toCharacterDetails,
  toCharacterResponse,
  toCharacterSummary,
} from './dto/character-response.dto.js';

@Injectable()
export class CharactersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: CharacterDataValidator,
  ) {}

  async create(userId: string, input: CreateCharacterDto) {
    return this.prisma.$transaction(async (tx) => {
      const sheet = await tx.sheetSchema.findFirst({
        where: {
          id: input.sheet_schema_id,
          gameSystemId: input.game_system_id,
          gameSystem: {
            deletedAt: null,
            OR: [
              { source: 'BUILTIN', ownerId: null },
              { source: 'IMPORTED', ownerId: userId },
            ],
          },
        },
        select: { schema: true },
      });
      if (!sheet) throw new NotFoundException('Sheet schema not found');
      const data = this.validator.initialData(sheetSchema.parse(sheet.schema));
      const character = await tx.character.create({
        data: {
          ownerId: userId,
          gameSystemId: input.game_system_id,
          sheetSchemaId: input.sheet_schema_id,
          name: input.name,
          data,
          versions: { create: { versionNumber: 1, data } },
        },
        select: characterSelect,
      });
      return toCharacterResponse(character);
    });
  }

  async list(userId: string) {
    const owned = await this.prisma.character.findMany({
      where: { ownerId: userId },
      select: characterSummarySelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    return { owned: owned.map(toCharacterSummary), shared_view: [] };
  }

  async get(userId: string, id: string) {
    const character = await this.prisma.character.findFirst({
      where: { id, ownerId: userId },
      select: characterSelect,
    });
    if (!character) throw new NotFoundException('Character not found');
    return toCharacterDetails(character);
  }

  async save(userId: string, id: string, input: SaveCharacterDto) {
    return this.prisma.$transaction(
      async (tx) => {
        // READ COMMITTED + a row lock serializes all saves before reading MAX(version).
        // Keep ownership in the lock predicate so foreign records remain hidden.
        const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM characters
        WHERE id = ${id}::uuid AND owner_id = ${userId}::uuid
        FOR UPDATE
      `;
        if (locked.length === 0)
          throw new NotFoundException('Character not found');
        const character = await tx.character.findUniqueOrThrow({
          where: { id },
          select: {
            sheetSchema: { select: { schema: true } },
            versions: {
              select: { versionNumber: true },
              orderBy: { versionNumber: 'desc' },
              take: 1,
            },
          },
        });
        const data = this.validator.validate(
          sheetSchema.parse(character.sheetSchema.schema),
          input.data,
        );
        const versionNumber = character.versions[0].versionNumber + 1;
        await tx.character.update({ where: { id }, data: { data } });
        await tx.characterVersion.create({
          data: { characterId: id, versionNumber, data },
        });
        const saved = await tx.character.findUniqueOrThrow({
          where: { id },
          select: characterSelect,
        });
        return toCharacterDetails(saved);
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.prisma.character.deleteMany({
      where: { id, ownerId: userId },
    });
    if (result.count === 0) throw new NotFoundException('Character not found');
  }
}
