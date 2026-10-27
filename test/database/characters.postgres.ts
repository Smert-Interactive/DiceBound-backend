import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresApp } from '../helpers/postgres-app.js';
import {
  characterDefinition,
  validCharacterData,
} from '../helpers/character.fixture.js';
import type { SheetDefinition } from '../../src/modules/game-systems/validation/sheet-schema.schema.js';

const origin = 'http://localhost:5173';
const builtinId = '10000000-0000-4000-8000-000000000001';
const builtinSheetId = '20000000-0000-4000-8000-000000000001';

describe('Characters with PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createPostgresApp>>;
  const users: { id: string; username: string; cookie: string }[] = [];
  let systemId: string;
  let sheetId: string;
  const http = () => request(db.app.getHttpServer());
  const get = (path: string, user = 0) =>
    http().get(path).set('Cookie', users[user].cookie);
  const post = (path: string, data: object, user = 0) =>
    http()
      .post(path)
      .set('Cookie', users[user].cookie)
      .set('Origin', origin)
      .send(data);
  const save = (id: string, data: object, user = 0) =>
    http()
      .put(`/api/v1/characters/${id}`)
      .set('Cookie', users[user].cookie)
      .set('Origin', origin)
      .send({ data });
  const remove = (id: string, user = 0) =>
    http()
      .delete(`/api/v1/characters/${id}`)
      .set('Cookie', users[user].cookie)
      .set('Origin', origin);
  const create = (extra = {}, user = 0) =>
    post(
      '/api/v1/characters',
      {
        game_system_id: systemId,
        sheet_schema_id: sheetId,
        name: 'Arin',
        ...extra,
      },
      user,
    );
  const importSchema = (schema: SheetDefinition) =>
    post('/api/v1/systems/import', {
      system_name: 'Custom RPG',
      sheet_schema_name: 'Custom sheet',
      schema_text: JSON.stringify(schema),
    });
  const state = async (id: string) => ({
    character: await db.prisma.character.findUnique({ where: { id } }),
    versions: await db.prisma.characterVersion.findMany({
      where: { characterId: id },
      orderBy: { versionNumber: 'asc' },
    }),
  });

  beforeAll(async () => {
    db = await createPostgresApp();
    await db.seed();
    for (let i = 0; i < 3; i++) {
      const credentials = {
        email: `characters-${i}@example.com`,
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
    const imported = await importSchema(characterDefinition).expect(201);
    systemId = imported.body.system.id;
    sheetId = imported.body.sheet_schema.id;
  });
  beforeEach(async () => {
    await db.prisma.character.deleteMany();
  });
  afterAll(async () => {
    await db?.close();
  });

  it('creates Character and exactly v1 with matching draft data', async () => {
    const created = await create().expect(201);
    expect(created.body).toMatchObject({
      owner_id: users[0].id,
      current_version_number: 1,
      data: { name: '', note: '', inspiration: false, constant: 2 },
    });
    const persisted = await state(created.body.id);
    expect(persisted.character?.data).toEqual(created.body.data);
    expect(persisted.versions).toHaveLength(1);
    expect(persisted.versions[0]).toMatchObject({
      versionNumber: 1,
      data: created.body.data,
    });
    const opened = await get(`/api/v1/characters/${created.body.id}`).expect(
      200,
    );
    expect(opened.body).toEqual({
      ...created.body,
      access: 'OWNER',
      can_edit: true,
      can_view_history: true,
      owner_username: users[0].username,
    });
    await get(`/api/v1/schemas/${sheetId}`).expect(200);
  });
  it('completes create → open → save for a seeded built-in D&D character', async () => {
    const created = await create({
      game_system_id: builtinId,
      sheet_schema_id: builtinSheetId,
    }).expect(201);
    expect(created.body.data).toEqual({ name: '', inspiration: false });
    const data = {
      name: 'Arin',
      level: 1,
      class: 'fighter',
      strength: 16,
      dexterity: 12,
      constitution: 14,
      intelligence: 10,
      wisdom: 8,
      charisma: 10,
      armor_class: 16,
      inspiration: false,
      hit_points: { current: 8, max: 12 },
    };
    const saved = await save(created.body.id, data).expect(200);
    expect(saved.body).toMatchObject({
      current_version_number: 2,
      data: {
        ...data,
        strength_modifier: 3,
        dexterity_modifier: 1,
        constitution_modifier: 2,
        intelligence_modifier: 0,
        wisdom_modifier: -1,
        charisma_modifier: 0,
      },
    });
    expect((await state(created.body.id)).versions[1].data).toEqual(
      saved.body.data,
    );
  });
  it('rejects foreign, mismatched, missing and archived schemas without creating anything', async () => {
    await create({}, 1).expect(404);
    await create({ sheet_schema_id: builtinSheetId }).expect(404);
    await create({ game_system_id: builtinId }).expect(404);
    await create({ sheet_schema_id: randomUUID() }).expect(404);
    const archived = await importSchema({ sections: [] }).expect(201);
    await http()
      .delete(`/api/v1/systems/${archived.body.system.id}`)
      .set('Cookie', users[0].cookie)
      .set('Origin', origin)
      .expect(204);
    await create({
      game_system_id: archived.body.system.id,
      sheet_schema_id: archived.body.sheet_schema.id,
    }).expect(404);
    expect(await db.prisma.character.count()).toBe(0);
    expect(await db.prisma.characterVersion.count()).toBe(0);
  });
  it('replaces user values and creates one full snapshot for every explicit save, including identical data', async () => {
    const created = await create().expect(201);
    const first = await save(created.body.id, {
      ...validCharacterData,
      note: 'hello',
    }).expect(200);
    expect(first.body).toMatchObject({
      current_version_number: 2,
      data: { strength_modifier: 3, final_score: 5, note: 'hello' },
    });
    const second = await save(created.body.id, validCharacterData).expect(200);
    expect(second.body.current_version_number).toBe(3);
    expect(second.body.data).not.toHaveProperty('note');
    await save(created.body.id, validCharacterData).expect(200);
    const persisted = await state(created.body.id);
    expect(persisted.versions.map((v) => v.versionNumber)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(persisted.versions[3].data).toEqual(persisted.character?.data);
  });
  it.each([
    { strength: 31 },
    { strength: '16' },
    { name: '' },
    { inspiration: 'false' },
    { role: 'unknown' },
    { hit_points: { current: 13, max: 12 } },
    { secret_power: 42 },
    { strength_modifier: 999 },
  ])(
    'invalid save leaves data, updated_at and every snapshot unchanged (%#)',
    async (invalid) => {
      const created = await create().expect(201);
      await save(created.body.id, validCharacterData).expect(200);
      const before = await state(created.body.id);
      await save(created.body.id, { ...validCharacterData, ...invalid }).expect(
        422,
      );
      expect(await state(created.body.id)).toEqual(before);
    },
  );
  it('rejects missing required values without a partial update', async () => {
    const created = await create().expect(201);
    const before = await state(created.body.id);
    await save(created.body.id, {}).expect(422);
    expect(await state(created.body.id)).toEqual(before);
  });
  it('rejects runtime division by zero and missing numeric dependencies atomically', async () => {
    const schema = structuredClone(characterDefinition);
    schema.sections[0].fields.push(
      { id: 'divisor', type: 'number', label: 'Divisor' },
      {
        id: 'quotient',
        type: 'calculated',
        label: 'Quotient',
        formula: 'strength / divisor',
      },
    );
    const imported = await importSchema(schema).expect(201);
    const created = await create({
      game_system_id: imported.body.system.id,
      sheet_schema_id: imported.body.sheet_schema.id,
    }).expect(201);
    await save(created.body.id, { ...validCharacterData, divisor: 2 }).expect(
      200,
    );
    const before = await state(created.body.id);
    for (const input of [
      validCharacterData,
      { ...validCharacterData, divisor: 0 },
    ]) {
      const response = await save(created.body.id, input).expect(422);
      expect(response.body.details[0].field).toBe('data.quotient');
      expect(await state(created.body.id)).toEqual(before);
    }
  });
  it('rolls back Character.data and updated_at when snapshot insertion fails in PostgreSQL', async () => {
    const created = await create().expect(201);
    const before = await state(created.body.id);
    await db.prisma.$executeRawUnsafe(
      'ALTER TABLE character_versions ADD CONSTRAINT test_reject_save CHECK (version_number <> 2)',
    );
    try {
      const response = await save(created.body.id, validCharacterData).expect(
        500,
      );
      expect(response.body).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
      expect(response.body).not.toHaveProperty('details');
      expect(await state(created.body.id)).toEqual(before);
    } finally {
      await db.prisma.$executeRawUnsafe(
        'ALTER TABLE character_versions DROP CONSTRAINT test_reject_save',
      );
    }
  });
  it('rolls back the newly inserted Character if its initial snapshot is rejected', async () => {
    await db.prisma.$executeRawUnsafe(
      'ALTER TABLE character_versions ADD CONSTRAINT test_reject_initial CHECK (version_number <> 1)',
    );
    try {
      await create().expect(500);
      expect(await db.prisma.character.count()).toBe(0);
      expect(await db.prisma.characterVersion.count()).toBe(0);
    } finally {
      await db.prisma.$executeRawUnsafe(
        'ALTER TABLE character_versions DROP CONSTRAINT test_reject_initial',
      );
    }
  });
  it('serializes concurrent saves into unique consecutive versions with matching final data', async () => {
    const created = await create().expect(201);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        save(created.body.id, { ...validCharacterData, strength: i + 10 }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(
      results.map((r) => r.body.current_version_number).sort((a, b) => a - b),
    ).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    const persisted = await state(created.body.id);
    expect(persisted.versions.map((v) => v.versionNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    for (const result of results) {
      expect(
        persisted.versions[result.body.current_version_number - 1].data,
      ).toEqual(result.body.data);
    }
    expect(persisted.character?.data).toEqual(persisted.versions[8].data);
  });
  it('hides foreign originals even with VIEW or EDIT receipts and denies save/delete', async () => {
    const created = await create().expect(201);
    await db.prisma.characterShare.createMany({
      data: [
        {
          characterId: created.body.id,
          userId: users[1].id,
          permission: 'VIEW',
        },
        {
          characterId: created.body.id,
          userId: users[2].id,
          permission: 'EDIT',
        },
      ],
    });
    const before = await state(created.body.id);
    for (const user of [1, 2]) {
      await get(`/api/v1/characters/${created.body.id}`, user).expect(404);
      await save(created.body.id, validCharacterData, user).expect(404);
      await remove(created.body.id, user).expect(404);
      await get('/api/v1/characters', user)
        .expect(200)
        .expect({ owned: [], shared_view: [] });
    }
    expect(await state(created.body.id)).toEqual(before);
  });
  it('deletes history and shares, while an independent EDIT copy and its provenance survive', async () => {
    const created = await create().expect(201);
    const saved = await save(created.body.id, validCharacterData).expect(200);
    await db.prisma.characterShare.createMany({
      data: [
        {
          characterId: created.body.id,
          userId: users[1].id,
          permission: 'EDIT',
        },
        {
          characterId: created.body.id,
          userId: users[2].id,
          permission: 'VIEW',
          historyVisible: true,
        },
      ],
    });
    // Sharing creation is stage 3; seed its existing storage contract directly.
    const copy = await db.prisma.character.create({
      data: {
        ownerId: users[1].id,
        name: 'Arin (copy)',
        gameSystemId: systemId,
        sheetSchemaId: sheetId,
        data: saved.body.data,
        sourceCharacterId: created.body.id,
        sourceOwnerId: users[0].id,
        sourceOwnerUsername: users[0].username,
        copiedAt: new Date(),
        versions: { create: { versionNumber: 1, data: saved.body.data } },
      },
    });
    const response = await remove(created.body.id).expect(204);
    expect(response.text).toBe('');
    expect(await state(created.body.id)).toEqual({
      character: null,
      versions: [],
    });
    expect(
      await db.prisma.characterShare.count({
        where: { characterId: created.body.id },
      }),
    ).toBe(0);
    const copyState = await state(copy.id);
    expect(copyState.character).toMatchObject({
      sourceCharacterId: null,
      sourceOwnerUsername: users[0].username,
      data: saved.body.data,
    });
    expect(copyState.versions).toHaveLength(1);
    const list = await get('/api/v1/characters', 1).expect(200);
    expect(list.body.owned).toHaveLength(1);
    expect(list.body.owned[0]).toMatchObject({
      id: copy.id,
      access: 'OWNER',
      copy_source_owner_name: users[0].username,
    });
    await save(copy.id, { ...validCharacterData, strength: 20 }, 1).expect(200);
    await remove(created.body.id).expect(404);
  });
  it('continues reading and saving an existing character after system archival', async () => {
    const imported = await importSchema(characterDefinition).expect(201);
    const created = await create({
      game_system_id: imported.body.system.id,
      sheet_schema_id: imported.body.sheet_schema.id,
    }).expect(201);
    await http()
      .delete(`/api/v1/systems/${imported.body.system.id}`)
      .set('Cookie', users[0].cookie)
      .set('Origin', origin)
      .expect(204);
    await get(`/api/v1/characters/${created.body.id}`).expect(200);
    await get(`/api/v1/schemas/${imported.body.sheet_schema.id}`).expect(200);
    await save(created.body.id, validCharacterData).expect(200);
    const list = await get('/api/v1/characters').expect(200);
    expect(list.body.owned[0].game_system_name).toBe('Custom RPG');
  });
});
