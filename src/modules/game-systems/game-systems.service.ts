import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ValidationException } from '../../common/exceptions/validation.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  gameSystemSummarySelect,
  toGameSystemResponse,
} from './dto/game-system-response.dto.js';
import {
  sheetSchemaSelect,
  sheetSchemaSummarySelect,
  toSheetSchemaResponse,
  toSheetSchemaSummaryResponse,
} from './dto/sheet-schema-response.dto.js';
import type { ImportGameSystemDto } from './dto/import-game-system.dto.js';
import { SheetSchemaValidator } from './validation/sheet-schema.validator.js';

/** Systems offered for creating a new character, not the character's existing schema. */
function selectableSystems(userId: string): Prisma.GameSystemWhereInput {
  return {
    deletedAt: null,
    OR: [
      { source: 'BUILTIN', ownerId: null },
      { source: 'IMPORTED', ownerId: userId },
    ],
  };
}

@Injectable()
export class GameSystemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: SheetSchemaValidator,
  ) {}

  validate(schemaText: string) {
    return this.validator.validate(schemaText);
  }

  async import(userId: string, input: ImportGameSystemDto) {
    const validation = this.validator.validate(input.schema_text);
    if (!validation.valid) throw new ValidationException(validation.errors);

    return this.prisma.$transaction(async (tx) => {
      const system = await tx.gameSystem.create({
        data: { name: input.system_name, source: 'IMPORTED', ownerId: userId },
        select: gameSystemSummarySelect,
      });
      const sheet = await tx.sheetSchema.create({
        data: {
          name: input.sheet_schema_name,
          gameSystemId: system.id,
          schema: validation.schema,
        },
        select: sheetSchemaSelect,
      });
      return {
        system: toGameSystemResponse(system),
        sheet_schema: toSheetSchemaResponse(sheet),
      };
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    // Authorize and archive atomically; a prior read alone would leave a race.
    const result = await this.prisma.gameSystem.updateMany({
      where: { id, source: 'IMPORTED', ownerId: userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 1) return;
    const builtin = await this.prisma.gameSystem.findFirst({
      where: { id, source: 'BUILTIN', ownerId: null, deletedAt: null },
      select: { id: true },
    });
    if (builtin)
      throw new ForbiddenException('Built-in systems cannot be deleted');
    throw new NotFoundException('Game system not found');
  }

  async list(userId: string) {
    const systems = await this.prisma.gameSystem.findMany({
      where: selectableSystems(userId),
      select: gameSystemSummarySelect,
      orderBy: [{ source: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return systems.map(toGameSystemResponse);
  }

  async get(userId: string, id: string) {
    const system = await this.prisma.gameSystem.findFirst({
      where: { id, ...selectableSystems(userId) },
      select: gameSystemSummarySelect,
    });
    if (!system) throw new NotFoundException('Game system not found');
    return toGameSystemResponse(system);
  }

  async listSchemas(userId: string, systemId: string) {
    // Check the parent even if it has no schemas: hidden/missing systems must be 404, not [].
    const system = await this.prisma.gameSystem.findFirst({
      where: { id: systemId, ...selectableSystems(userId) },
      select: { id: true },
    });
    if (!system) throw new NotFoundException('Game system not found');

    const sheets = await this.prisma.sheetSchema.findMany({
      where: { gameSystemId: systemId, gameSystem: selectableSystems(userId) },
      select: sheetSchemaSummarySelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return sheets.map(toSheetSchemaSummaryResponse);
  }

  async getSchema(userId: string, id: string) {
    const sheet = await this.prisma.sheetSchema.findFirst({
      where: {
        id,
        OR: [
          { gameSystem: selectableSystems(userId) },
          // Existing characters keep their schema after a system is hidden.
          // An EDIT receipt alone gives no access to the original; its owned copy does.
          {
            characters: {
              some: {
                OR: [
                  { ownerId: userId },
                  { shares: { some: { userId, permission: 'VIEW' } } },
                ],
              },
            },
          },
        ],
      },
      select: sheetSchemaSelect,
    });
    if (!sheet) throw new NotFoundException('Sheet schema not found');
    return toSheetSchemaResponse(sheet);
  }
}
