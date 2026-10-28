import { randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { SESSION_COOKIE } from '../src/modules/auth/session.service.js';

const userId = randomUUID();
const id = randomUUID();
const origin = 'http://localhost:5173';
const path = `/api/v1/characters/${id}/versions`;
const createdAt = new Date('2026-10-28T10:00:00Z');
const snapshot = {
  id: randomUUID(),
  characterId: id,
  versionNumber: 4,
  data: { name: 'Arin', strength: 16, strength_modifier: 3 },
  createdAt,
};
const character = {
  id,
  ownerId: userId,
  gameSystemId: randomUUID(),
  sheetSchemaId: randomUUID(),
  name: 'Arin',
  data: snapshot.data,
  createdAt,
  updatedAt: createdAt,
  versions: [{ versionNumber: 4 }],
};

describe('Character history HTTP contract', () => {
  let app: INestApplication;
  const cookie = `${SESSION_COOKIE}=${randomBytes(32).toString('base64url')}`;
  const prisma = {
    authSession: { findUnique: vi.fn() },
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
  const http = () => request(app.getHttpServer());
  const call = (method: 'get' | 'post', url = path) =>
    http()[method](url).set('Cookie', cookie).set('Origin', origin);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.authSession.findUnique.mockResolvedValue({
      id: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: userId,
        username: 'player',
        email: 'player@example.com',
        createdAt,
      },
    });
    prisma.character.findFirst.mockResolvedValue({ versions: [snapshot] });
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    prisma.$queryRaw.mockResolvedValue([{ id }]);
    prisma.characterVersion.findUnique.mockResolvedValue(snapshot);
    prisma.characterVersion.findFirst.mockResolvedValue({ versionNumber: 7 });
    prisma.characterVersion.deleteMany.mockResolvedValue({ count: 3 });
    prisma.character.findUniqueOrThrow.mockResolvedValue(character);
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['get', path],
    ['get', `${path}/4`],
    ['post', `${path}/4/restore`],
  ] as const)('requires a session for %s %s', async (method, url) => {
    const response = await http()
      [method](url)
      .set('Origin', origin)
      .expect(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expect(prisma.character.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each([undefined, 'https://evil.example'])(
    'requires an allowed Origin for restore (%s)',
    async (originValue) => {
      const pending = http().post(`${path}/4/restore`).set('Cookie', cookie);
      if (originValue) pending.set('Origin', originValue);
      const response = await pending.expect(403);
      expect(response.body.code).toBe('FORBIDDEN');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each(['', '/4', '/4/restore'])(
    'rejects malformed character UUID (%s)',
    async (suffix) => {
      const response = await call(
        suffix.endsWith('restore') ? 'post' : 'get',
        `/api/v1/characters/bad-id/versions${suffix}`,
      ).expect(400);
      expect(response.body.code).toBe('BAD_REQUEST');
      expect(prisma.character.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each([
    '0',
    '-1',
    '1.5',
    '1e2',
    'abc',
    '2147483648',
    '9007199254740993',
    '4x',
  ])('rejects invalid version %s on read and restore', async (version) => {
    for (const [method, suffix] of [
      ['get', ''],
      ['post', '/restore'],
    ] as const) {
      const response = await call(method, `${path}/${version}${suffix}`).expect(
        400,
      );
      expect(response.body.code).toBe('BAD_REQUEST');
    }
    expect(prisma.character.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('returns only ordered metadata and marks the latest version current', async () => {
    prisma.character.findFirst.mockResolvedValue({
      versions: [snapshot, { ...snapshot, id: randomUUID(), versionNumber: 1 }],
    });
    const response = await call('get').expect(200);
    expect(response.body).toEqual([
      {
        id: snapshot.id,
        version_number: 4,
        created_at: createdAt.toISOString(),
        is_current: true,
      },
      {
        id: expect.any(String),
        version_number: 1,
        created_at: createdAt.toISOString(),
        is_current: false,
      },
    ]);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const query = prisma.character.findFirst.mock.calls[0][0];
    expect(query.select.versions).toEqual({
      select: { id: true, versionNumber: true, createdAt: true },
      orderBy: { versionNumber: 'desc' },
    });
  });
  it.each(['', '/4'])(
    'scopes history reads to owner or VIEW with history enabled (%s)',
    async (suffix) => {
      await call('get', `${path}${suffix}`).expect(200);
      expect(prisma.character.findFirst.mock.calls[0][0].where).toEqual({
        id,
        OR: [
          { ownerId: userId },
          {
            shares: {
              some: { userId, permission: 'VIEW', historyVisible: true },
            },
          },
        ],
      });
    },
  );
  it('returns snapshots verbatim with no schema or recalculation', async () => {
    const response = await call('get', `${path}/4`).expect(200);
    expect(response.body).toEqual({
      id: snapshot.id,
      character_id: id,
      version_number: 4,
      data: snapshot.data,
      created_at: createdAt.toISOString(),
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(
      prisma.character.findFirst.mock.calls[0][0].select.versions.where,
    ).toEqual({ versionNumber: 4 });
  });
  it.each(['', '/4'])(
    'hides missing and inaccessible history (%s)',
    async (suffix) => {
      prisma.character.findFirst.mockResolvedValue(null);
      const response = await call('get', `${path}${suffix}`).expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    },
  );
  it('returns empty history for a character without snapshots and 404 for a missing version', async () => {
    prisma.character.findFirst.mockResolvedValue({ versions: [] });
    await call('get').expect(200).expect([]);
    const response = await call('get', `${path}/4`).expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });
  it('restores without creating a snapshot and returns the updated character and deletion count', async () => {
    const response = await call('post', `${path}/4/restore`).expect(200);
    expect(response.body).toMatchObject({
      character: {
        id,
        owner_id: userId,
        data: snapshot.data,
        current_version_number: 4,
      },
      deleted_versions_count: 3,
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(prisma.character.update).toHaveBeenCalledExactlyOnceWith({
      where: { id },
      data: { data: snapshot.data },
    });
    expect(prisma.characterVersion.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { characterId: id, versionNumber: { gt: 4 } },
    });
    expect(prisma.characterVersion.create).not.toHaveBeenCalled();
    const [strings, ...parameters] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toMatch(
      /WHERE id = \?::uuid AND owner_id = \?::uuid\s+FOR UPDATE/,
    );
    expect(parameters).toEqual([id, userId]);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.characterVersion.findUnique.mock.invocationCallOrder[0],
    );
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'ReadCommitted',
    });
  });
  it('denies restore before looking up versions when the character is missing or foreign', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const response = await call('post', `${path}/4/restore`).expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(prisma.characterVersion.findUnique).not.toHaveBeenCalled();
    expect(prisma.character.update).not.toHaveBeenCalled();
  });
  it('rejects a missing version before writing', async () => {
    prisma.characterVersion.findUnique.mockResolvedValue(null);
    const response = await call('post', `${path}/4/restore`).expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(prisma.character.update).not.toHaveBeenCalled();
    expect(prisma.characterVersion.deleteMany).not.toHaveBeenCalled();
  });
  it('preserves RESTORE_NOT_ALLOWED for a current-version conflict without writing', async () => {
    prisma.characterVersion.findFirst.mockResolvedValue({ versionNumber: 4 });
    const response = await call('post', `${path}/4/restore`).expect(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      code: 'RESTORE_NOT_ALLOWED',
      message: 'Cannot restore the current version',
    });
    expect(prisma.character.update).not.toHaveBeenCalled();
    expect(prisma.characterVersion.deleteMany).not.toHaveBeenCalled();
  });
  it('conceals database failures', async () => {
    prisma.characterVersion.deleteMany.mockRejectedValue(
      new Error('private SQL details'),
    );
    const response = await call('post', `${path}/4/restore`).expect(500);
    expect(response.body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(response.body).not.toHaveProperty('details');
  });
  it('documents history routes, session auth, responses and bounded version numbers', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addCookieAuth(
          SESSION_COOKIE,
          { type: 'apiKey', in: 'cookie' },
          SESSION_COOKIE,
        )
        .build(),
    );
    const base = '/api/v1/characters/{id}/versions';
    for (const [url, method] of [
      [base, 'get'],
      [`${base}/{versionNumber}`, 'get'],
      [`${base}/{versionNumber}/restore`, 'post'],
    ] as const) {
      const operation = document.paths[url][method]!;
      expect(operation.responses).toHaveProperty('200');
      for (const status of ['400', '401', '404'])
        expect(operation.responses).toHaveProperty(status);
      expect(operation.security).toEqual([{ [SESSION_COOKIE]: [] }]);
    }
    expect(
      document.paths[`${base}/{versionNumber}/restore`].post?.responses,
    ).toHaveProperty('409');
    expect(document.components?.schemas?.RestoreResultDto).toHaveProperty(
      'properties.character.$ref',
    );
    expect(
      document.components?.schemas?.CharacterVersionSummaryDto,
    ).toHaveProperty('properties.is_current.type', 'boolean');
    expect(document.components?.schemas?.CharacterVersionDto).toHaveProperty(
      'properties.data.type',
      'object',
    );
    expect(
      document.paths[`${base}/{versionNumber}`].get?.parameters,
    ).toContainEqual(
      expect.objectContaining({
        name: 'versionNumber',
        schema: expect.objectContaining({
          type: 'integer',
          minimum: 1,
          maximum: 2_147_483_647,
        }),
      }),
    );
  });
});
