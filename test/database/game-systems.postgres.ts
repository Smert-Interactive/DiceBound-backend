import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresApp } from '../helpers/postgres-app.js';

const origin = 'http://localhost:5173';
const builtinId = '10000000-0000-4000-8000-000000000001';
const builtinSheetId = '20000000-0000-4000-8000-000000000001';

describe('Game Systems read/import/archive with PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createPostgresApp>>;
  let thirdSchema: string;
  const users: { id: string; username: string; cookie: string }[] = [];
  const http = () => request(db.app.getHttpServer());
  const get = (path: string, index = 0) =>
    http().get(path).set('Cookie', users[index].cookie);
  const post = (path: string, body: object, index = 0) =>
    http()
      .post(path)
      .set('Origin', origin)
      .set('Cookie', users[index].cookie)
      .send(body);
  const remove = (id: string, index = 0) =>
    http()
      .delete(`/api/v1/systems/${id}`)
      .set('Origin', origin)
      .set('Cookie', users[index].cookie);
  const importSystem = (index = 0, extra = {}) =>
    post(
      '/api/v1/systems/import',
      {
        system_name: 'Orbital Expedition',
        sheet_schema_name: 'Expedition Sheet',
        schema_text: thirdSchema,
        ...extra,
      },
      index,
    );

  beforeAll(async () => {
    db = await createPostgresApp();
    thirdSchema = await readFile(
      new URL('../fixtures/third-game-system.json', import.meta.url),
      'utf8',
    );
    for (let index = 0; index < 4; index++) {
      const credentials = {
        email: `systems-${index}@example.com`,
        password: 'example-password-123',
      };
      const registered = await http()
        .post('/api/v1/auth/register')
        .set('Origin', origin)
        .send({ ...credentials, password_confirmation: credentials.password })
        .expect(201);
      const login = await http()
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send(credentials)
        .expect(200);
      users.push({
        id: registered.body.id,
        username: registered.body.username,
        cookie: (login.headers['set-cookie'] as unknown as string[])[0].split(
          ';',
        )[0],
      });
    }
  });
  beforeEach(async () => {
    // Only the verified random schema is in this client's search_path.
    await db.prisma.$executeRawUnsafe('TRUNCATE game_systems CASCADE');
    await db.seed();
  });
  afterAll(async () => {
    await db?.close();
  });

  it('seeds twice without duplicates and serves both built-ins and their full schemas', async () => {
    await db.seed();
    const systems = await get('/api/v1/systems').expect(200);
    expect(systems.body).toHaveLength(2);
    expect(systems.body.map((item: { name: string }) => item.name)).toEqual(
      expect.arrayContaining([
        'D&D 5e (simplified)',
        'Call of Cthulhu (simplified)',
      ]),
    );
    for (const system of systems.body) {
      expect(system).toMatchObject({
        source: 'BUILT_IN',
        owner_id: null,
        character_count: 0,
      });
      const single = await get(`/api/v1/systems/${system.id}`).expect(200);
      expect(single.body).toEqual(system);
      const summaries = await get(
        `/api/v1/systems/${system.id}/schemas`,
      ).expect(200);
      expect(summaries.body.length).toBeGreaterThan(0);
      for (const summary of summaries.body) {
        expect(summary).not.toHaveProperty('schema');
        const full = await get(`/api/v1/schemas/${summary.id}`).expect(200);
        expect(full.body.schema.sections.length).toBeGreaterThan(0);
        expect(full.body.schema.sections[0].fields.length).toBeGreaterThan(0);
      }
    }
  });

  it('imports a private system, maps the response, and prevents direct UUID access by another user', async () => {
    const result = await importSystem().expect(201);
    expect(result.body.system).toMatchObject({
      source: 'IMPORTED',
      owner_id: users[0].id,
      character_count: 0,
    });
    expect(result.body.sheet_schema.schema).toEqual(JSON.parse(thirdSchema));
    const own = await get('/api/v1/systems').expect(200);
    expect(own.body).toHaveLength(3);
    await get(`/api/v1/systems/${result.body.system.id}`).expect(200);
    await get(`/api/v1/systems/${result.body.system.id}/schemas`).expect(200);
    expect((await get('/api/v1/systems', 1).expect(200)).body).toHaveLength(2);
    await get(`/api/v1/systems/${result.body.system.id}`, 1).expect(404);
    await get(`/api/v1/systems/${result.body.system.id}/schemas`, 1).expect(
      404,
    );
    await get(`/api/v1/schemas/${result.body.sheet_schema.id}`, 1).expect(404);
  });

  it('accepts trimmed names and an empty definition according to the contract', async () => {
    const result = await importSystem(0, {
      system_name: '  Custom  ',
      sheet_schema_name: ' Sheet ',
      schema_text: '{"sections":[]}',
    }).expect(201);
    expect(result.body.system.name).toBe('Custom');
    expect(result.body.sheet_schema).toMatchObject({
      name: 'Sheet',
      schema: { sections: [] },
    });
  });

  it.each([
    '{',
    JSON.stringify({
      sections: [
        {
          id: 'core',
          label: 'Core',
          fields: [{ id: 'x', label: 'X', type: 'script' }],
        },
      ],
    }),
    JSON.stringify({
      sections: [
        {
          id: 'core',
          label: 'Core',
          fields: [
            { id: 'x', label: 'X', type: 'number' },
            { id: 'x', label: 'X', type: 'number' },
          ],
        },
      ],
    }),
    JSON.stringify({
      sections: [
        {
          id: 'core',
          label: 'Core',
          fields: [
            { id: 'a', label: 'A', type: 'calculated', formula: 'b + 1' },
            { id: 'b', label: 'B', type: 'calculated', formula: 'a + 1' },
          ],
        },
      ],
    }),
  ])(
    'validation never writes and invalid import returns detailed 422 (%#)',
    async (text) => {
      const checked = await post('/api/v1/systems/import/validate', {
        schema_text: text,
      }).expect(200);
      expect(checked.body).toMatchObject({
        valid: false,
        summary: null,
        schema: null,
      });
      const imported = await importSystem(0, { schema_text: text }).expect(422);
      expect(imported.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(imported.body.details).toEqual(checked.body.errors);
      expect(await db.prisma.gameSystem.count()).toBe(2);
      expect(await db.prisma.sheetSchema.count()).toBe(2);
    },
  );

  it('rolls back GameSystem when PostgreSQL rejects the SheetSchema insert', async () => {
    await db.prisma.$executeRawUnsafe(
      "ALTER TABLE sheet_schemas ADD CONSTRAINT test_sheet_reject CHECK (name <> 'Reject fixture')",
    );
    try {
      const result = await importSystem(0, {
        sheet_schema_name: 'Reject fixture',
      }).expect(500);
      expect(result.body).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
      expect(result.body).not.toHaveProperty('details');
      expect(await db.prisma.gameSystem.count()).toBe(2);
      expect(await db.prisma.sheetSchema.count()).toBe(2);
    } finally {
      await db.prisma.$executeRawUnsafe(
        'ALTER TABLE sheet_schemas DROP CONSTRAINT test_sheet_reject',
      );
    }
  });

  it('forbids deleting built-ins and hides foreign and unknown systems without changing data', async () => {
    await remove(builtinId).expect(403);
    const imported = await importSystem().expect(201);
    await remove(imported.body.system.id, 1).expect(404);
    await remove(randomUUID()).expect(404);
    expect(
      (
        await db.prisma.gameSystem.findUniqueOrThrow({
          where: { id: imported.body.system.id },
        })
      ).deletedAt,
    ).toBeNull();
    expect(await db.prisma.gameSystem.count()).toBe(3);
  });

  it('soft-deletes without dropping data and a repeat import receives a new identity', async () => {
    const imported = await importSystem().expect(201);
    const id = imported.body.system.id;
    const sheetId = imported.body.sheet_schema.id;
    await remove(id).expect(204);
    await remove(id).expect(404);
    expect((await get('/api/v1/systems').expect(200)).body).toHaveLength(2);
    await get(`/api/v1/systems/${id}`).expect(404);
    await get(`/api/v1/systems/${id}/schemas`).expect(404);
    await get(`/api/v1/schemas/${sheetId}`).expect(404); // no existing character grants access
    expect(
      (await db.prisma.gameSystem.findUniqueOrThrow({ where: { id } }))
        .deletedAt,
    ).toBeInstanceOf(Date);
    expect(
      (
        await db.prisma.sheetSchema.findUniqueOrThrow({
          where: { id: sheetId },
        })
      ).schema,
    ).toEqual(JSON.parse(thirdSchema));
    const repeated = await importSystem().expect(201);
    expect(repeated.body.system.id).not.toBe(id);
    expect(repeated.body.sheet_schema.id).not.toBe(sheetId);
  });

  it('only one concurrent archive request succeeds', async () => {
    const imported = await importSystem().expect(201);
    const results = await Promise.all([
      remove(imported.body.system.id),
      remove(imported.body.system.id),
    ]);
    expect(results.map((item) => item.status).sort((a, b) => a - b)).toEqual([
      204, 404,
    ]);
  });

  it('counts all users’ characters on a built-in system', async () => {
    for (const owner of users.slice(0, 2)) {
      await db.prisma.character.create({
        data: {
          ownerId: owner.id,
          name: 'Shared system user',
          gameSystemId: builtinId,
          sheetSchemaId: builtinSheetId,
        },
      });
    }
    const result = await get(`/api/v1/systems/${builtinId}`).expect(200);
    expect(result.body.character_count).toBe(2);
  });

  it('returns [] for an accessible system with no sheets, but 404 for a missing parent', async () => {
    const empty = await db.prisma.gameSystem.create({
      data: { source: 'IMPORTED', ownerId: users[0].id, name: 'No sheets' },
    });
    await get(`/api/v1/systems/${empty.id}/schemas`).expect(200).expect([]);
    await get(`/api/v1/systems/${randomUUID()}/schemas`).expect(404);
    await get(`/api/v1/schemas/${randomUUID()}`).expect(404);
  });

  it('third-system flow preserves characters, snapshots, VIEW and EDIT copies after archive', async () => {
    const checked = await post('/api/v1/systems/import/validate', {
      schema_text: thirdSchema,
    }).expect(200);
    expect(checked.body).toMatchObject({
      valid: true,
      summary: { sections_count: 1, fields_count: 6 },
    });
    const imported = await importSystem().expect(201);
    const systemId = imported.body.system.id;
    const sheetId = imported.body.sheet_schema.id;
    const input = {
      callsign: 'Orion',
      energy: 35,
      is_alive: true,
      role: 'pilot',
      shield: { current: 8, max: 10 },
    };
    const original = (
      await post('/api/v1/characters', {
        name: 'Orion',
        game_system_id: systemId,
        sheet_schema_id: sheetId,
      }).expect(201)
    ).body;
    const saveCharacter = (data: object) =>
      http()
        .put(`/api/v1/characters/${original.id}`)
        .set('Cookie', users[0].cookie)
        .set('Origin', origin)
        .send({ data });
    const firstSave = await saveCharacter(input).expect(200);
    expect(firstSave.body.data.energy_bonus).toBe(3);
    const updated = (await saveCharacter({ ...input, energy: 72 }).expect(200))
      .body.data;
    await db.prisma.characterShare.createMany({
      data: [
        { characterId: original.id, userId: users[1].id, permission: 'EDIT' },
        { characterId: original.id, userId: users[2].id, permission: 'VIEW' },
      ],
    });
    const copy = await db.prisma.character.create({
      data: {
        ownerId: users[1].id,
        name: 'Orion copy',
        gameSystemId: systemId,
        sheetSchemaId: sheetId,
        data: updated,
        sourceCharacterId: original.id,
        sourceOwnerId: users[0].id,
        sourceOwnerUsername: users[0].username,
        copiedAt: new Date(),
      },
    });
    await db.prisma.characterVersion.create({
      data: { characterId: copy.id, versionNumber: 1, data: updated },
    });
    expect(
      (await get(`/api/v1/systems/${systemId}`).expect(200)).body
        .character_count,
    ).toBe(2);
    const unrelated = await db.prisma.sheetSchema.create({
      data: {
        gameSystemId: systemId,
        name: 'Unrelated schema',
        schema: { sections: [] },
      },
    });
    await get(`/api/v1/schemas/${unrelated.id}`, 2).expect(404);
    const before = await db.prisma.characterVersion.findMany({
      orderBy: [{ characterId: 'asc' }, { versionNumber: 'asc' }],
    });
    await remove(systemId).expect(204);
    for (const index of [0, 1, 2]) {
      const full = await get(`/api/v1/schemas/${sheetId}`, index).expect(200);
      expect(full.body.schema).toEqual(JSON.parse(thirdSchema));
      await get(`/api/v1/systems/${systemId}`, index).expect(404);
    }
    await get(`/api/v1/schemas/${sheetId}`, 3).expect(404);
    await get(`/api/v1/schemas/${unrelated.id}`).expect(404);
    expect(
      await db.prisma.characterVersion.findMany({
        orderBy: [{ characterId: 'asc' }, { versionNumber: 'asc' }],
      }),
    ).toEqual(before);
    expect(
      (
        await db.prisma.character.findUniqueOrThrow({
          where: { id: original.id },
        })
      ).data,
    ).toEqual(updated);
    expect(
      (await db.prisma.character.findUniqueOrThrow({ where: { id: copy.id } }))
        .data,
    ).toEqual(updated);
    const savedAfterArchive = (
      await saveCharacter({ ...input, energy: 91 }).expect(200)
    ).body.data;
    expect(savedAfterArchive.energy_bonus).toBe(9);
    expect(
      (
        await db.prisma.characterVersion.findFirstOrThrow({
          where: { characterId: original.id, versionNumber: 4 },
        })
      ).data,
    ).toEqual(savedAfterArchive);
    await expect(
      db.prisma.character.create({
        data: {
          ownerId: users[0].id,
          name: 'New character on archived system',
          gameSystemId: systemId,
          sheetSchemaId: sheetId,
        },
      }),
    ).rejects.toThrow();
    await db.prisma.characterShare.deleteMany({
      where: { characterId: original.id, userId: users[2].id },
    });
    await get(`/api/v1/schemas/${sheetId}`, 2).expect(404);
    await db.prisma.character.delete({ where: { id: copy.id } });
    await get(`/api/v1/schemas/${sheetId}`, 1).expect(404); // EDIT receipt alone cannot expose the source sheet
  });
});
