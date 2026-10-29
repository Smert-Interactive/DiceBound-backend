import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../database/prisma.service.js';
import { CharacterHistoryService } from './character-history.service.js';

const userId = randomUUID();
const characterId = randomUUID();
const createdAt = new Date('2026-10-28T10:00:00Z');
const snapshots = [7, 4, 1].map((versionNumber) => ({
  id: randomUUID(),
  characterId,
  versionNumber,
  createdAt,
  data: { strength: 16, strength_modifier: 99, legacy: versionNumber },
}));
const character = {
  id: characterId,
  ownerId: userId,
  gameSystemId: randomUUID(),
  sheetSchemaId: randomUUID(),
  name: 'Arin',
  data: snapshots[1].data,
  createdAt,
  updatedAt: createdAt,
  versions: [{ versionNumber: 4 }],
};

describe('CharacterHistoryService', () => {
  const prisma = {
    character: {
      findFirst: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    characterVersion: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  const service = new CharacterHistoryService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.character.findFirst.mockResolvedValue({ versions: snapshots });
    prisma.$queryRaw.mockResolvedValue([{ id: characterId }]);
    prisma.characterVersion.findUnique.mockResolvedValue(snapshots[1]);
    prisma.characterVersion.findFirst.mockResolvedValue({ versionNumber: 7 });
    prisma.characterVersion.deleteMany.mockResolvedValue({ count: 3 });
    prisma.character.findUniqueOrThrow.mockResolvedValue(character);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
  });

  it('returns only summary fields and marks only the highest version current', async () => {
    expect(await service.list(userId, characterId)).toEqual(
      snapshots.map((version, index) => ({
        id: version.id,
        version_number: version.versionNumber,
        created_at: createdAt.toISOString(),
        is_current: index === 0,
      })),
    );
  });

  it('preserves the original calculated values when reading a snapshot', async () => {
    prisma.character.findFirst.mockResolvedValue({ versions: [snapshots[1]] });
    expect(await service.get(userId, characterId, 4)).toEqual({
      id: snapshots[1].id,
      character_id: characterId,
      version_number: 4,
      data: snapshots[1].data,
      created_at: createdAt.toISOString(),
    });
  });

  it('hides inaccessible history and absent snapshots', async () => {
    prisma.character.findFirst.mockResolvedValue(null);
    await expect(service.list(userId, characterId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.get(userId, characterId, 4)).rejects.toMatchObject({
      status: 404,
    });
    prisma.character.findFirst.mockResolvedValue({ versions: [] });
    await expect(service.get(userId, characterId, 4)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('restores historical data verbatim and returns the remaining current version', async () => {
    const result = await service.restore(userId, characterId, 4);
    expect(result).toMatchObject({
      character: {
        id: characterId,
        data: snapshots[1].data,
        current_version_number: 4,
      },
      deleted_versions_count: 3,
    });
    expect(prisma.character.update).toHaveBeenCalledWith({
      where: { id: characterId },
      data: { data: snapshots[1].data },
    });
    expect(prisma.characterVersion.create).not.toHaveBeenCalled();
  });

  it('denies restore to non-owners before accessing versions', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.restore(userId, characterId, 4)).rejects.toMatchObject(
      { status: 404 },
    );
    expect(prisma.characterVersion.findUnique).not.toHaveBeenCalled();
    expect(prisma.character.update).not.toHaveBeenCalled();
  });

  it('rejects absent and current versions before any mutation', async () => {
    prisma.characterVersion.findUnique.mockResolvedValue(null);
    await expect(service.restore(userId, characterId, 4)).rejects.toMatchObject(
      { status: 404 },
    );
    prisma.characterVersion.findUnique.mockResolvedValue(snapshots[1]);
    prisma.characterVersion.findFirst.mockResolvedValue({ versionNumber: 4 });
    await expect(service.restore(userId, characterId, 4)).rejects.toMatchObject(
      { status: 409, response: { code: 'RESTORE_NOT_ALLOWED' } },
    );
    expect(prisma.character.update).not.toHaveBeenCalled();
    expect(prisma.characterVersion.deleteMany).not.toHaveBeenCalled();
  });

  it('propagates deletion failure out of the transaction without returning success', async () => {
    const failure = new Error('Deletion rejected');
    prisma.characterVersion.deleteMany.mockRejectedValue(failure);
    await expect(service.restore(userId, characterId, 4)).rejects.toBe(failure);
    expect(prisma.character.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
