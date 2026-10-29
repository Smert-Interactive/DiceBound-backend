import { randomUUID } from 'node:crypto';
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
import { createPostgresApp } from '../helpers/postgres-app.js';
import {
  characterDefinition,
  validCharacterData,
} from '../helpers/character.fixture.js';
import type { Prisma } from '../../src/generated/prisma/client.js';

const origin = 'http://localhost:5173';

describe('Character history with PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createPostgresApp>>;
  const users: { id: string; username: string; cookie: string }[] = [];
  let systemId: string;
  let sheetId: string;
  const http = () => request(db.app.getHttpServer());
  const versionsPath = (id: string) => `/api/v1/characters/${id}/versions`;
  const get = (path: string, user = 0) =>
    http().get(path).set('Cookie', users[user].cookie);
  const post = (path: string, data: object = {}, user = 0) =>
    http()
      .post(path)
      .set('Cookie', users[user].cookie)
      .set('Origin', origin)
      .send(data);
  const save = (id: string, strength = 20, user = 0) =>
    http()
      .put(`/api/v1/characters/${id}`)
      .set('Cookie', users[user].cookie)
      .set('Origin', origin)
      .send({ data: { ...validCharacterData, strength } });
  const restore = (id: string, version: number, user = 0) =>
    post(`${versionsPath(id)}/${version}/restore`, {}, user);
  const state = async (id: string) => ({
    character: await db.prisma.character.findUniqueOrThrow({ where: { id } }),
    versions: await db.prisma.characterVersion.findMany({
      where: { characterId: id },
      orderBy: { versionNumber: 'asc' },
    }),
  });
  const createHistory = async () => {
    const created = await post('/api/v1/characters', {
      game_system_id: systemId,
      sheet_schema_id: sheetId,
      name: 'Arin',
    }).expect(201);
    for (let version = 2; version <= 7; version++)
      await save(created.body.id, version + 10).expect(200);
    return created.body.id as string;
  };

  beforeAll(async () => {
    db = await createPostgresApp();
    for (let i = 0; i < 4; i++) {
      const credentials = {
        email: `history-${i}@example.com`,
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
    const imported = await post('/api/v1/systems/import', {
      system_name: 'History RPG',
      sheet_schema_name: 'History sheet',
      schema_text: JSON.stringify(characterDefinition),
    }).expect(201);
    systemId = imported.body.system.id;
    sheetId = imported.body.sheet_schema.id;
  });
  beforeEach(async () => {
    await db.prisma.character.deleteMany();
  });
  afterAll(async () => {
    await db?.close();
  });

  it('lists v7 → v1 with exactly one current flag and reads complete historical data', async () => {
    const id = await createHistory();
    const before = await state(id);
    const response = await get(versionsPath(id)).expect(200);
    expect(response.body).toEqual(
      [...before.versions].reverse().map((version, index) => ({
        id: version.id,
        version_number: version.versionNumber,
        created_at: version.createdAt.toISOString(),
        is_current: index === 0,
      })),
    );
    for (const version of before.versions) {
      const snapshot = await get(
        `${versionsPath(id)}/${version.versionNumber}`,
      ).expect(200);
      expect(snapshot.body).toEqual({
        id: version.id,
        character_id: id,
        version_number: version.versionNumber,
        data: version.data,
        created_at: version.createdAt.toISOString(),
      });
    }
    expect(await state(id)).toEqual(before);
  });

  it('restores v4 verbatim, deletes exactly v5–v7, then saves v5', async () => {
    const id = await createHistory();
    const before = await state(id);
    const target = before.versions[3];
    const restored = await restore(id, 4).expect(200);
    expect(restored.body).toMatchObject({
      character: {
        id,
        data: target.data,
        current_version_number: 4,
        sheet_schema_id: sheetId,
      },
      deleted_versions_count: 3,
    });
    const after = await state(id);
    expect(after.character.data).toEqual(target.data);
    expect(after.versions).toEqual(before.versions.slice(0, 4));
    expect(after.character.updatedAt.getTime()).toBeGreaterThan(
      before.character.updatedAt.getTime(),
    );
    await get(`${versionsPath(id)}/5`).expect(404);
    const list = await get(versionsPath(id)).expect(200);
    expect(
      list.body.map((v: { version_number: number; is_current: boolean }) => [
        v.version_number,
        v.is_current,
      ]),
    ).toEqual([
      [4, true],
      [3, false],
      [2, false],
      [1, false],
    ]);
    const saved = await save(id, 22).expect(200);
    expect(saved.body.current_version_number).toBe(5);
    const final = await state(id);
    expect(final.versions.slice(0, 4)).toEqual(before.versions.slice(0, 4));
    expect(final.versions[4].data).toEqual(saved.body.data);
    expect(final.character.data).toEqual(saved.body.data);
  });

  it('restores the initial draft without applying save-time required-field validation', async () => {
    const id = await createHistory();
    const before = await state(id);
    const restored = await restore(id, 1).expect(200);
    expect(restored.body).toMatchObject({
      character: { data: before.versions[0].data, current_version_number: 1 },
      deleted_versions_count: 6,
    });
    expect((await state(id)).versions).toEqual(before.versions.slice(0, 1));
  });

  it('preserves legacy calculated values without reinterpreting the snapshot', async () => {
    const id = await createHistory();
    // Simulate data from an earlier formula implementation. Snapshots are immutable.
    const legacy = {
      ...validCharacterData,
      constant: 2,
      strength_modifier: 99,
      final_score: 101,
    };
    await db.prisma.characterVersion.create({
      data: { characterId: id, versionNumber: 8, data: legacy },
    });
    await db.prisma.characterVersion.create({
      data: {
        characterId: id,
        versionNumber: 9,
        data: { ...legacy, name: 'Later' },
      },
    });
    await db.prisma.character.update({
      where: { id },
      data: { data: { ...legacy, name: 'Later' } },
    });
    const snapshot = await get(`${versionsPath(id)}/8`).expect(200);
    expect(snapshot.body.data).toEqual(legacy);
    const restored = await restore(id, 8).expect(200);
    expect(restored.body.character.data).toEqual(legacy);
    expect((await state(id)).character.data).toEqual(legacy);
  });

  it('returns 404 for missing versions and 409 RESTORE_NOT_ALLOWED for the current version without changes', async () => {
    const id = await createHistory();
    const before = await state(id);
    for (const version of [8, 2_147_483_647]) {
      const read = await get(`${versionsPath(id)}/${version}`).expect(404);
      expect(read.body.code).toBe('NOT_FOUND');
      const restored = await restore(id, version).expect(404);
      expect(restored.body.code).toBe('NOT_FOUND');
    }
    const current = await restore(id, 7).expect(409);
    expect(current.body.code).toBe('RESTORE_NOT_ALLOWED');
    expect(await state(id)).toEqual(before);
  });

  it('enforces OWNER / VIEW history visibility / EDIT-original permissions in real relation queries', async () => {
    const id = await createHistory();
    const before = await state(id);
    // Unshared characters and missing IDs have the same 404 contract.
    for (const hidden of [id, randomUUID()]) {
      await get(versionsPath(hidden), 1).expect(404);
      await get(`${versionsPath(hidden)}/4`, 1).expect(404);
      await restore(hidden, 4, 1).expect(404);
    }
    await db.prisma.characterShare.createMany({
      data: [
        {
          characterId: id,
          userId: users[1].id,
          permission: 'VIEW',
          historyVisible: true,
        },
        {
          characterId: id,
          userId: users[2].id,
          permission: 'VIEW',
          historyVisible: false,
        },
        { characterId: id, userId: users[3].id, permission: 'EDIT' },
      ],
    });
    await get(versionsPath(id), 1).expect(200);
    await get(`${versionsPath(id)}/4`, 1).expect(200);
    for (const user of [2, 3]) {
      await get(versionsPath(id), user).expect(404);
      await get(`${versionsPath(id)}/4`, user).expect(404);
    }
    for (const user of [1, 2, 3]) {
      const denied = await restore(id, 4, user).expect(404);
      expect(denied.body.code).toBe('NOT_FOUND');
    }
    expect(await state(id)).toEqual(before);
    // Revoking VIEW immediately removes history access.
    await db.prisma.characterShare.deleteMany({
      where: { characterId: id, userId: users[1].id },
    });
    await get(versionsPath(id), 1).expect(404);
    await get(`${versionsPath(id)}/4`, 1).expect(404);
  });

  it('allows the recipient to restore an independent EDIT copy without changing the original', async () => {
    const id = await createHistory();
    const original = await state(id);
    const copy = await db.prisma.character.create({
      data: {
        ownerId: users[1].id,
        gameSystemId: systemId,
        sheetSchemaId: sheetId,
        name: 'Arin copy',
        data: original.character.data as Prisma.InputJsonValue,
        sourceCharacterId: id,
        sourceOwnerId: users[0].id,
        sourceOwnerUsername: users[0].username,
        copiedAt: new Date(),
        versions: {
          create: {
            versionNumber: 1,
            data: original.character.data as Prisma.InputJsonValue,
          },
        },
      },
    });
    await save(copy.id, 25, 1).expect(200);
    await get(versionsPath(copy.id), 1).expect(200);
    const restored = await restore(copy.id, 1, 1).expect(200);
    expect(restored.body).toMatchObject({
      character: {
        owner_id: users[1].id,
        data: original.character.data,
        current_version_number: 1,
      },
      deleted_versions_count: 1,
    });
    await restore(copy.id, 1, 0).expect(404);
    expect(await state(id)).toEqual(original);
  });

  it('rolls back data, updated_at and every version when PostgreSQL rejects deletion after the update', async () => {
    const id = await createHistory();
    const before = await state(id);
    await db.prisma.$executeRawUnsafe(
      `CREATE FUNCTION test_reject_history_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test deletion failure' USING ERRCODE = '23514'; END; $$`,
    );
    await db.prisma.$executeRawUnsafe(
      'CREATE TRIGGER test_reject_history_delete BEFORE DELETE ON character_versions FOR EACH ROW EXECUTE FUNCTION test_reject_history_delete()',
    );
    try {
      const response = await restore(id, 4).expect(500);
      expect(response.body).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
      expect(await state(id)).toEqual(before);
    } finally {
      await db.prisma.$executeRawUnsafe(
        'DROP TRIGGER test_reject_history_delete ON character_versions',
      );
      await db.prisma.$executeRawUnsafe(
        'DROP FUNCTION test_reject_history_delete()',
      );
    }
    // A failed transaction must release the row lock too.
    await restore(id, 4).expect(200);
  });

  it.each(['restore', 'save'] as const)(
    'serializes queued %s first and the other operation under the same row lock',
    async (first) => {
      const id = await createHistory();
      const before = await state(id);
      let release!: () => void;
      let acquired!: (pid: number) => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<number>((resolve) => {
        acquired = resolve;
      });
      // Hold a third transaction open so the first HTTP request is deterministically queued.
      const blocker = db.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM characters WHERE id = ${id}::uuid FOR UPDATE`;
          const [backend] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          acquired(backend.pid);
          await held;
        },
        { timeout: 10_000 },
      );
      const pid = await Promise.race([
        ready,
        blocker.then(() => {
          throw new Error('Lock transaction ended before acquiring lock');
        }),
      ]);
      const firstRequest = (
        first === 'restore' ? restore(id, 4) : save(id, 23)
      ).then((response) => response);
      let secondRequest: Promise<request.Response> | undefined;
      try {
        await vi.waitFor(
          async () => {
            const [waiting] = await db.prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
        `;
            expect(waiting.count).toBe(1);
          },
          { timeout: 3000, interval: 20 },
        );
        secondRequest = (
          first === 'restore' ? save(id, 23) : restore(id, 4)
        ).then((response) => response);
        // Include indirect waiters: PostgreSQL can queue request two behind request one.
        await vi.waitFor(
          async () => {
            const [waiting] = await db.prisma.$queryRaw<{ count: number }[]>`
          WITH RECURSIVE waiters AS (
            SELECT pid FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
            UNION
            SELECT activity.pid FROM pg_stat_activity activity
            JOIN waiters ON waiters.pid = ANY(pg_blocking_pids(activity.pid))
          ) SELECT count(*)::int AS count FROM waiters
        `;
            expect(waiting.count).toBe(2);
          },
          { timeout: 3000, interval: 20 },
        );
      } finally {
        release();
        try {
          await blocker;
        } finally {
          // Drain requests even if the blocker times out, before schema teardown.
          await Promise.allSettled([
            firstRequest,
            ...(secondRequest ? [secondRequest] : []),
          ]);
        }
      }
      const [one, two] = await Promise.all([firstRequest, secondRequest!]);
      expect([one.status, two.status]).toEqual([200, 200]);
      const restored = first === 'restore' ? one : two;
      const saved = first === 'save' ? one : two;
      expect(restored.body.deleted_versions_count).toBe(
        first === 'restore' ? 3 : 4,
      );
      expect(saved.body.current_version_number).toBe(
        first === 'restore' ? 5 : 8,
      );
      const after = await state(id);
      expect(after.versions.slice(0, 4)).toEqual(before.versions.slice(0, 4));
      expect(after.versions.map((v) => v.versionNumber)).toEqual(
        first === 'restore' ? [1, 2, 3, 4, 5] : [1, 2, 3, 4],
      );
      expect(after.character.data).toEqual(
        first === 'restore' ? saved.body.data : before.versions[3].data,
      );
      expect(after.character.data).toEqual(after.versions.at(-1)?.data);
    },
  );
});
