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

const systemId = '10000000-0000-4000-8000-000000000001';
const sheetId = '20000000-0000-4000-8000-000000000001';
const userId = randomUUID();
const origin = 'http://localhost:5173';
const createdAt = new Date('2026-10-10T12:00:00Z');
const definition = {
  sections: [
    {
      id: 'core',
      label: 'Core',
      fields: [{ id: 'name', type: 'text', label: 'Name' }],
    },
  ],
};
const system = {
  id: systemId,
  ownerId: null,
  name: 'D&D 5e',
  description: null,
  source: 'BUILTIN',
  createdAt,
  _count: { characters: 4 },
};
const sheet = {
  id: sheetId,
  gameSystemId: systemId,
  name: 'Basic sheet',
  createdAt,
  schema: definition,
};
const paths = [
  '/api/v1/systems',
  `/api/v1/systems/${systemId}`,
  `/api/v1/systems/${systemId}/schemas`,
  `/api/v1/schemas/${sheetId}`,
];

describe('Game Systems read API (HTTP contract)', () => {
  let app: INestApplication;
  const cookie = `${SESSION_COOKIE}=${randomBytes(32).toString('base64url')}`;
  const prisma = {
    gameSystem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    sheetSchema: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    authSession: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  const http = () => request(app.getHttpServer());
  const get = (path: string) => http().get(path).set('Cookie', cookie);

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
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    prisma.gameSystem.updateMany.mockResolvedValue({ count: 0 });
    prisma.gameSystem.create.mockResolvedValue({
      ...system,
      source: 'IMPORTED',
      ownerId: userId,
      _count: { characters: 0 },
    });
    prisma.sheetSchema.create.mockResolvedValue(sheet);
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
    prisma.gameSystem.findMany.mockResolvedValue([system]);
    prisma.gameSystem.findFirst.mockResolvedValue(system);
    prisma.sheetSchema.findMany.mockResolvedValue([sheet]);
    prisma.sheetSchema.findFirst.mockResolvedValue(sheet);
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each(paths)('requires a session: %s', async (path) => {
    const result = await http().get(path).expect(401);
    expect(result.body.code).toBe('UNAUTHORIZED');
    expect(prisma.gameSystem.findMany).not.toHaveBeenCalled();
    expect(prisma.gameSystem.findFirst).not.toHaveBeenCalled();
    expect(prisma.sheetSchema.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    '/api/v1/systems/not-a-uuid',
    '/api/v1/systems/not-a-uuid/schemas',
    '/api/v1/schemas/not-a-uuid',
  ])('rejects malformed IDs before querying the resource: %s', async (path) => {
    const result = await get(path).expect(400);
    expect(result.body.code).toBe('BAD_REQUEST');
    expect(prisma.gameSystem.findFirst).not.toHaveBeenCalled();
    expect(prisma.sheetSchema.findFirst).not.toHaveBeenCalled();
  });

  it('returns only contract fields with BUILT_IN and the unfiltered character count', async () => {
    const result = await get('/api/v1/systems').expect(200);
    expect(result.body).toEqual([
      {
        id: systemId,
        owner_id: null,
        name: system.name,
        description: null,
        source: 'BUILT_IN',
        character_count: 4,
        created_at: createdAt.toISOString(),
      },
    ]);
    expect(result.headers['cache-control']).toBe('private, no-store');
  });

  it('maps imported systems without exposing storage metadata', async () => {
    prisma.gameSystem.findFirst.mockResolvedValue({
      ...system,
      source: 'IMPORTED',
      ownerId: userId,
      builtinCode: null,
      deletedAt: null,
    });
    const result = await get(`/api/v1/systems/${systemId}`).expect(200);
    expect(result.body).toEqual({
      id: systemId,
      owner_id: userId,
      name: system.name,
      description: null,
      source: 'IMPORTED',
      character_count: 4,
      created_at: createdAt.toISOString(),
    });
  });

  it('returns schema summaries without the full JSON definition', async () => {
    const result = await get(`/api/v1/systems/${systemId}/schemas`).expect(200);
    expect(result.body).toEqual([
      {
        id: sheetId,
        game_system_id: systemId,
        name: sheet.name,
        created_at: createdAt.toISOString(),
      },
    ]);
    expect(prisma.sheetSchema.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ schema: true }),
      }),
    );
  });

  it('returns [] only when the parent is accessible but has no schemas', async () => {
    prisma.sheetSchema.findMany.mockResolvedValue([]);
    await get(`/api/v1/systems/${systemId}/schemas`).expect(200).expect([]);
    prisma.gameSystem.findFirst.mockResolvedValue(null);
    await get(`/api/v1/systems/${systemId}/schemas`).expect(404);
  });

  it('returns the complete schema as JSON, without double serialization', async () => {
    const result = await get(`/api/v1/schemas/${sheetId}`).expect(200);
    expect(result.body).toEqual({
      id: sheetId,
      game_system_id: systemId,
      name: sheet.name,
      created_at: createdAt.toISOString(),
      schema: definition,
    });
    expect(typeof result.body.schema).toBe('object');
    expect(result.headers['cache-control']).toBe('private, no-store');
  });

  it.each([
    `/api/v1/systems/${systemId}`,
    `/api/v1/systems/${systemId}/schemas`,
    `/api/v1/schemas/${sheetId}`,
  ])(
    'returns a generic 404 for an inaccessible/missing resource: %s',
    async (path) => {
      prisma.gameSystem.findFirst.mockResolvedValue(null);
      prisma.sheetSchema.findFirst.mockResolvedValue(null);
      const result = await get(path).expect(404);
      expect(result.body).toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
        path,
      });
      expect(result.body).not.toHaveProperty('details');
    },
  );

  it('documents all four authenticated read endpoints in OpenAPI', () => {
    const config = new DocumentBuilder()
      .addCookieAuth(
        SESSION_COOKIE,
        { type: 'apiKey', in: 'cookie' },
        SESSION_COOKIE,
      )
      .build();
    const document = SwaggerModule.createDocument(app, config);
    for (const path of [
      '/api/v1/systems',
      '/api/v1/systems/{id}',
      '/api/v1/systems/{id}/schemas',
      '/api/v1/schemas/{id}',
    ]) {
      expect(document.paths[path]?.get?.responses).toHaveProperty('200');
      expect(document.paths[path]?.get?.responses).toHaveProperty('401');
      expect(document.paths[path]?.get?.security).toEqual([
        { [SESSION_COOKIE]: [] },
      ]);
    }
    expect(document.components?.schemas?.SheetSchemaResponseDto).toHaveProperty(
      'properties.schema.type',
      'object',
    );
  });
  it('validate returns 200/valid=false for malformed JSON and never writes', async () => {
    const result = await http()
      .post('/api/v1/systems/import/validate')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ schema_text: '{' })
      .expect(200);
    expect(result.body).toMatchObject({
      valid: false,
      summary: null,
      schema: null,
      errors: [{ path: 'schema_text', message: 'Invalid JSON syntax' }],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('validate returns the checked schema and section/field counts', async () => {
    const result = await http()
      .post('/api/v1/systems/import/validate')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ schema_text: JSON.stringify(definition) })
      .expect(200);
    expect(result.body).toEqual({
      valid: true,
      errors: [],
      summary: { sections_count: 1, fields_count: 1 },
      schema: definition,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects ambiguous field IDs in validation and import before writing to the database', async () => {
    const schemaText = JSON.stringify({
      sections: [
        {
          id: 'core',
          label: 'Core',
          fields: [
            { id: 'a', type: 'number', label: 'A' },
            { id: 'b', type: 'number', label: 'B' },
            { id: 'a-b', type: 'number', label: 'Ambiguous ID' },
            {
              id: 'result',
              type: 'calculated',
              label: 'Result',
              formula: 'a-b',
            },
          ],
        },
      ],
    });
    const checked = await http()
      .post('/api/v1/systems/import/validate')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({ schema_text: schemaText })
      .expect(200);
    expect(checked.body).toMatchObject({
      valid: false,
      schema: null,
      summary: null,
    });
    expect(checked.body.errors).toContainEqual({
      path: 'sections[0].fields[2].id',
      message: 'Field IDs must match [A-Za-z_][A-Za-z0-9_]*',
      line: null,
    });
    const imported = await http()
      .post('/api/v1/systems/import')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({
        system_name: 'My RPG',
        sheet_schema_name: 'Sheet',
        schema_text: schemaText,
      })
      .expect(422);
    expect(imported.body.code).toBe('VALIDATION_ERROR');
    expect(imported.body.details).toEqual(checked.body.errors);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('import returns 201 with snake_case DTOs and sets owner/source on the server', async () => {
    const result = await http()
      .post('/api/v1/systems/import')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({
        system_name: '  My RPG  ',
        sheet_schema_name: ' Sheet ',
        schema_text: JSON.stringify(definition),
      })
      .expect(201);
    expect(result.body.system).toMatchObject({
      source: 'IMPORTED',
      owner_id: userId,
      character_count: 0,
    });
    expect(result.body.sheet_schema).toMatchObject({
      game_system_id: systemId,
      schema: definition,
    });
    expect(result.body).not.toHaveProperty('sheet');
    expect(prisma.gameSystem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'My RPG', source: 'IMPORTED', ownerId: userId },
      }),
    );
    expect(prisma.sheetSchema.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'Sheet', gameSystemId: systemId, schema: definition },
      }),
    );
  });

  it('invalid import returns 422 with safe path/message/line details before the transaction', async () => {
    const result = await http()
      .post('/api/v1/systems/import')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({
        system_name: 'My RPG',
        sheet_schema_name: 'Sheet',
        schema_text: '{',
      })
      .expect(422);
    expect(result.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Invalid sheet schema',
      details: [{ path: 'schema_text', message: 'Invalid JSON syntax' }],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { schema_text: 42 },
    { schema_text: 'x'.repeat(65537) },
    { system_name: ' ', sheet_schema_name: 'Sheet', schema_text: '{}' },
    {
      system_name: 'My RPG',
      sheet_schema_name: 'Sheet',
      schema_text: '{}',
      owner_id: userId,
    },
  ])('rejects malformed import HTTP input %#', async (body) => {
    const result = await http()
      .post('/api/v1/systems/import')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send(body)
      .expect(400);
    expect(result.body.code).toBe('BAD_REQUEST');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['/api/v1/systems/import', '/api/v1/systems/import/validate'])(
    'requires a session for %s',
    async (path) => {
      await http().post(path).set('Origin', origin).send({}).expect(401);
    },
  );

  it('requires a session for DELETE', async () => {
    await http()
      .delete(`/api/v1/systems/${systemId}`)
      .set('Origin', origin)
      .expect(401);
  });

  it.each([undefined, 'https://evil.example'])(
    'enforces CSRF for all mutations with Origin=%s',
    async (untrusted) => {
      for (const path of [
        '/api/v1/systems/import',
        '/api/v1/systems/import/validate',
      ]) {
        const call = http().post(path).set('Cookie', cookie).send({});
        if (untrusted) call.set('Origin', untrusted);
        expect((await call).status).toBe(403);
      }
      const call = http()
        .delete(`/api/v1/systems/${systemId}`)
        .set('Cookie', cookie);
      if (untrusted) call.set('Origin', untrusted);
      expect((await call).status).toBe(403);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.gameSystem.updateMany).not.toHaveBeenCalled();
    },
  );

  it('archives an owned system with a conditional update and returns an empty 204', async () => {
    prisma.gameSystem.updateMany.mockResolvedValue({ count: 1 });
    const result = await http()
      .delete(`/api/v1/systems/${systemId}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .expect(204);
    expect(result.text).toBe('');
    expect(prisma.gameSystem.updateMany).toHaveBeenCalledWith({
      where: {
        id: systemId,
        source: 'IMPORTED',
        ownerId: userId,
        deletedAt: null,
      },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('forbids deleting built-in systems and hides missing/foreign/archived systems', async () => {
    await http()
      .delete(`/api/v1/systems/${systemId}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .expect(403);
    prisma.gameSystem.findFirst.mockResolvedValue(null);
    const result = await http()
      .delete(`/api/v1/systems/${systemId}`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .expect(404);
    expect(result.body.code).toBe('NOT_FOUND');
  });

  it('validates UUIDs on DELETE', async () => {
    await http()
      .delete('/api/v1/systems/not-a-uuid')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .expect(400);
    expect(prisma.gameSystem.updateMany).not.toHaveBeenCalled();
  });

  it('does not expose arbitrary backend details on import failure', async () => {
    prisma.sheetSchema.create.mockRejectedValueOnce({
      details: 'private PostgreSQL detail',
    });
    const result = await http()
      .post('/api/v1/systems/import')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({
        system_name: 'My RPG',
        sheet_schema_name: 'Sheet',
        schema_text: JSON.stringify(definition),
      })
      .expect(500);
    expect(result.body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(result.body).not.toHaveProperty('details');
  });
});
