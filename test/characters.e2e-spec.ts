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
import {
  characterDefinition,
  validCharacterData,
} from './helpers/character.fixture.js';

const userId = randomUUID();
const id = randomUUID();
const systemId = randomUUID();
const sheetId = randomUUID();
const origin = 'http://localhost:5173';
const createdAt = new Date('2026-10-27T10:00:00Z');
const row = {
  id,
  ownerId: userId,
  gameSystemId: systemId,
  sheetSchemaId: sheetId,
  name: 'Arin',
  data: {
    ...validCharacterData,
    constant: 2,
    strength_modifier: 3,
    final_score: 5,
  },
  createdAt,
  updatedAt: createdAt,
  versions: [{ versionNumber: 2 }],
  owner: { username: 'player' },
  gameSystem: { name: 'Custom RPG' },
  sourceOwnerUsername: null,
};

describe('Characters HTTP contract', () => {
  let app: INestApplication;
  const cookie = `${SESSION_COOKIE}=${randomBytes(32).toString('base64url')}`;
  const prisma = {
    character: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    characterVersion: { create: vi.fn() },
    sheetSchema: { findFirst: vi.fn() },
    authSession: { findUnique: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };
  const http = () => request(app.getHttpServer());
  const call = (
    method: 'get' | 'post' | 'put' | 'delete',
    path = `/api/v1/characters/${id}`,
  ) => http()[method](path).set('Cookie', cookie).set('Origin', origin);

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
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    prisma.$queryRaw.mockResolvedValue([{ id }]);
    prisma.sheetSchema.findFirst.mockResolvedValue({
      schema: characterDefinition,
    });
    prisma.character.create.mockImplementation(
      async ({ data }: { data: { data: object } }) => ({
        ...row,
        data: data.data,
        versions: [{ versionNumber: 1 }],
      }),
    );
    prisma.character.findFirst.mockResolvedValue(row);
    prisma.character.findMany.mockResolvedValue([row]);
    prisma.character.findUniqueOrThrow.mockImplementation(
      async ({ select }: { select: { sheetSchema?: unknown } }) =>
        select.sheetSchema
          ? {
              sheetSchema: { schema: characterDefinition },
              versions: [{ versionNumber: 1 }],
            }
          : row,
    );
    prisma.character.deleteMany.mockResolvedValue({ count: 1 });
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['get', '/api/v1/characters'],
    ['post', '/api/v1/characters'],
    ['get', `/api/v1/characters/${id}`],
    ['put', `/api/v1/characters/${id}`],
    ['delete', `/api/v1/characters/${id}`],
  ] as const)('requires a session for %s %s', async (method, path) => {
    const response = await http()
      [method](path)
      .set('Origin', origin)
      .send({})
      .expect(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['post', 'put', 'delete'] as const)(
    'enforces Origin on %s',
    async (method) => {
      const path =
        method === 'post' ? '/api/v1/characters' : `/api/v1/characters/${id}`;
      await http()[method](path).set('Cookie', cookie).send({}).expect(403);
      await http()
        [method](path)
        .set('Cookie', cookie)
        .set('Origin', 'https://evil.example')
        .send({})
        .expect(403);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.character.deleteMany).not.toHaveBeenCalled();
    },
  );
  it.each(['get', 'put', 'delete'] as const)(
    'rejects malformed UUID for %s',
    async (method) => {
      await call(method, '/api/v1/characters/bad-id')
        .send({ data: {} })
        .expect(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.character.findFirst).not.toHaveBeenCalled();
      expect(prisma.character.deleteMany).not.toHaveBeenCalled();
    },
  );
  it('creates a draft with v1, a trimmed name and server-owned identity', async () => {
    const response = await call('post', '/api/v1/characters')
      .send({
        game_system_id: systemId,
        sheet_schema_id: sheetId,
        name: '  Arin  ',
      })
      .expect(201);
    expect(response.body).toEqual({
      id,
      owner_id: userId,
      game_system_id: systemId,
      sheet_schema_id: sheetId,
      name: 'Arin',
      data: { name: '', note: '', inspiration: false, constant: 2 },
      created_at: createdAt.toISOString(),
      updated_at: createdAt.toISOString(),
      current_version_number: 1,
    });
    const insert = prisma.character.create.mock.calls[0][0].data;
    expect(insert).toMatchObject({
      ownerId: userId,
      name: 'Arin',
      versions: { create: { versionNumber: 1, data: response.body.data } },
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(prisma.sheetSchema.findFirst.mock.calls[0][0].where).toMatchObject({
      id: sheetId,
      gameSystemId: systemId,
      gameSystem: {
        deletedAt: null,
        OR: [
          { source: 'BUILTIN', ownerId: null },
          { source: 'IMPORTED', ownerId: userId },
        ],
      },
    });
  });
  it.each([
    {},
    { game_system_id: 'invalid', sheet_schema_id: sheetId, name: 'Arin' },
    { game_system_id: systemId, sheet_schema_id: sheetId, name: ' ' },
    {
      game_system_id: systemId,
      sheet_schema_id: sheetId,
      name: 'x'.repeat(256),
    },
    {
      game_system_id: systemId,
      sheet_schema_id: sheetId,
      name: 'Arin',
      owner_id: userId,
    },
  ])('rejects malformed create body (%#)', async (body) => {
    await call('post', '/api/v1/characters').send(body).expect(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('hides inaccessible or mismatched schemas', async () => {
    prisma.sheetSchema.findFirst.mockResolvedValue(null);
    const response = await call('post', '/api/v1/characters')
      .send({
        game_system_id: systemId,
        sheet_schema_id: sheetId,
        name: 'Arin',
      })
      .expect(404);
    expect(response.body.code).toBe('NOT_FOUND');
    expect(prisma.character.create).not.toHaveBeenCalled();
  });
  it('returns owner permissions without embedding the schema or internal metadata', async () => {
    const response = await call('get').expect(200);
    expect(response.body).toMatchObject({
      current_version_number: 2,
      access: 'OWNER',
      can_edit: true,
      can_view_history: true,
      owner_username: 'player',
    });
    for (const internal of [
      'sheetSchema',
      'schema',
      'versions',
      'owner',
      'ownerId',
    ])
      expect(response.body).not.toHaveProperty(internal);
    expect(prisma.character.findFirst.mock.calls[0][0].where).toEqual({
      id,
      ownerId: userId,
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it('lists owned characters and copy provenance; shared_view is reserved', async () => {
    prisma.character.findMany.mockResolvedValue([
      row,
      { ...row, id: randomUUID(), sourceOwnerUsername: 'source-player' },
    ]);
    const response = await call('get', '/api/v1/characters').expect(200);
    expect(response.body.shared_view).toEqual([]);
    expect(response.body.owned[0]).toEqual({
      id,
      name: 'Arin',
      game_system_id: systemId,
      game_system_name: 'Custom RPG',
      updated_at: createdAt.toISOString(),
      access: 'OWNER',
      owner_username: 'player',
      copy_source_owner_name: null,
    });
    expect(response.body.owned[1].copy_source_owner_name).toBe('source-player');
    expect(prisma.character.findMany.mock.calls[0][0].where).toEqual({
      ownerId: userId,
    });
  });
  it('returns an empty CharacterList', async () => {
    prisma.character.findMany.mockResolvedValue([]);
    await call('get', '/api/v1/characters')
      .expect(200)
      .expect({ owned: [], shared_view: [] });
  });
  it('locks with an owner predicate before reading and writes exactly one computed snapshot', async () => {
    const response = await call('put')
      .send({ data: validCharacterData })
      .expect(200);
    expect(response.body).toMatchObject({
      current_version_number: 2,
      data: row.data,
    });
    const [strings, ...parameters] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toMatch(
      /WHERE id = \?::uuid AND owner_id = \?::uuid\s+FOR UPDATE/,
    );
    expect(parameters).toEqual([id, userId]);
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.character.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
    expect(prisma.character.update).toHaveBeenCalledExactlyOnceWith({
      where: { id },
      data: { data: row.data },
    });
    expect(prisma.characterVersion.create).toHaveBeenCalledExactlyOnceWith({
      data: { characterId: id, versionNumber: 2, data: row.data },
    });
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'ReadCommitted',
    });
  });
  it.each([
    {},
    { data: null },
    { data: [] },
    { data: 1 },
    { data: {}, name: 'rename' },
  ])('rejects malformed save body (%#)', async (body) => {
    await call('put').send(body).expect(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('returns structured 422 and performs no writes on invalid data', async () => {
    const response = await call('put')
      .send({ data: { ...validCharacterData, strength: 31 } })
      .expect(422);
    expect(response.body).toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Invalid character data',
      path: `/api/v1/characters/${id}`,
      timestamp: expect.any(String),
      details: [{ field: 'data.strength', message: expect.any(String) }],
    });
    expect(prisma.character.update).not.toHaveBeenCalled();
    expect(prisma.characterVersion.create).not.toHaveBeenCalled();
  });

  it('does not silently discard reserved JSON keys before unknown-field validation', async () => {
    const data = Object.fromEntries([
      ...Object.entries(validCharacterData),
      ['__proto__', 42],
    ]);
    const response = await call('put').send({ data }).expect(422);
    expect(response.body.details).toContainEqual({
      field: 'data.__proto__',
      message: 'Unknown field',
    });
    expect(prisma.character.update).not.toHaveBeenCalled();
    expect(prisma.characterVersion.create).not.toHaveBeenCalled();
  });
  it('returns 422 for formula failures before writing', async () => {
    const schema = structuredClone(characterDefinition);
    schema.sections[0].fields.push({
      id: 'divided',
      type: 'calculated',
      label: 'Divided',
      formula: '1 / strength',
    });
    prisma.character.findUniqueOrThrow.mockResolvedValue({
      sheetSchema: { schema },
      versions: [{ versionNumber: 1 }],
    });
    const response = await call('put')
      .send({ data: { ...validCharacterData, strength: 0 } })
      .expect(422);
    expect(response.body.details).toEqual([
      { field: 'data.divided', message: 'Division by zero' },
    ]);
    expect(prisma.character.update).not.toHaveBeenCalled();
  });
  it('hides foreign and absent characters on read, save and delete', async () => {
    prisma.character.findFirst.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.character.deleteMany.mockResolvedValue({ count: 0 });
    for (const method of ['get', 'put', 'delete'] as const) {
      const response = await call(method)
        .send({ data: validCharacterData })
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    }
    expect(prisma.character.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.character.update).not.toHaveBeenCalled();
  });
  it('deletes with the owner predicate and returns an empty 204', async () => {
    const response = await call('delete').expect(204);
    expect(response.text).toBe('');
    expect(prisma.character.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { id, ownerId: userId },
    });
  });
  it('conceals database failure details', async () => {
    prisma.characterVersion.create.mockRejectedValue({
      details: 'private SQL detail',
    });
    const response = await call('put')
      .send({ data: validCharacterData })
      .expect(500);
    expect(response.body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(response.body).not.toHaveProperty('details');
  });
  it('documents all five endpoints, authentication and the data contract', () => {
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
    for (const [path, method, status] of [
      ['/api/v1/characters', 'get', '200'],
      ['/api/v1/characters', 'post', '201'],
      ['/api/v1/characters/{id}', 'get', '200'],
      ['/api/v1/characters/{id}', 'put', '200'],
      ['/api/v1/characters/{id}', 'delete', '204'],
    ] as const) {
      const operation = document.paths[path][method]!;
      expect(operation.responses).toHaveProperty(status);
      expect(operation.responses).toHaveProperty('401');
      expect(operation.security).toEqual([{ [SESSION_COOKIE]: [] }]);
    }
    expect(document.components?.schemas?.SaveCharacterDto).toHaveProperty(
      'properties.data.type',
      'object',
    );
    expect(document.components?.schemas?.CharacterDetailsDto).toHaveProperty(
      'properties.current_version_number.minimum',
      1,
    );
  });
});
