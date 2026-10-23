import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readSeed, seed } from '../../prisma/seed.mjs';

const exec = promisify(execFile);
const project = fileURLToPath(new URL('../../', import.meta.url));
const migrationDirectory = new URL('../../prisma/migrations/', import.meta.url);
const migrations = (await readdir(migrationDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
async function migrationSql(name) {
  return readFile(new URL(`${name}/migration.sql`, migrationDirectory), 'utf8');
}

async function database() {
  assert.ok(
    process.env.DATABASE_URL?.trim(),
    'DATABASE_URL is required for test:db',
  );
  const target = new URL(process.env.DATABASE_URL);
  target.searchParams.delete('schema');
  const client = new pg.Client({
    connectionString: target.toString(),
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
    application_name: 'dicebound-database-tests',
  });
  const namespace = `dicebound_test_${randomUUID().replaceAll('-', '')}`;
  let created = false;
  const close = async () => {
    try {
      // An assertion can fail while a fixture transaction is still open.
      await client.query('ROLLBACK');
      if (created) await client.query(`DROP SCHEMA "${namespace}" CASCADE`);
    } finally {
      await client.end();
    }
  };
  try {
    await client.connect();
    await client.query(`CREATE SCHEMA "${namespace}"`);
    created = true;
    // Exclude public, so every table and function belongs to this test.
    await client.query(`SET search_path TO "${namespace}"`);
    assert.equal(
      (await client.query('SELECT current_schema() AS name')).rows[0].name,
      namespace,
    );
    target.searchParams.set('schema', namespace);
    const prisma = async (...args) => {
      try {
        return await exec(
          process.execPath,
          ['node_modules/prisma/build/index.js', ...args],
          {
            cwd: project,
            env: { ...process.env, DATABASE_URL: target.toString() },
            timeout: 60000,
            maxBuffer: 1024 * 1024,
          },
        );
      } catch (error) {
        // CLI output may contain connection details; do not print it in CI.
        throw new Error(`Prisma ${args.join(' ')} failed (exit ${error.code})`);
      }
    };
    return { client, close, prisma };
  } catch (error) {
    await close();
    throw error;
  }
}

await test('MVP storage acceptance in a clean PostgreSQL schema', async (t) => {
  const db = await database();
  t.after(db.close);
  const q = (sql, parameters) => db.client.query(sql, parameters);
  const systems = await readSeed();
  const owner = randomUUID();
  const recipient = randomUUID();
  const original = randomUUID();
  const copied = randomUUID();
  const createCharacter = (id, system = systems[0]) =>
    q(
      `INSERT INTO characters (id, owner_id, game_system_id, sheet_schema_id, name, data)
     VALUES ($1, $2, $3, $4, 'Arin', '{"name":"Arin","strength":16,"strength_modifier":3}')`,
      [id, owner, system.id, system.sheet.id],
    );

  await t.test('seed requires applied migrations', async () => {
    await assert.rejects(seed(db.client, systems), /pending migrations/);
  });

  await t.test(
    'migrations build all six tables and JSONB columns without manual DDL',
    async () => {
      await db.prisma('migrate', 'deploy');
      const { rows } =
        await q(`SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND data_type = 'jsonb'
      ORDER BY table_name, column_name`);
      assert.deepEqual(rows, [
        {
          table_name: 'character_versions',
          column_name: 'data',
          data_type: 'jsonb',
        },
        { table_name: 'characters', column_name: 'data', data_type: 'jsonb' },
        {
          table_name: 'sheet_schemas',
          column_name: 'schema',
          data_type: 'jsonb',
        },
      ]);
      assert.equal(
        (
          await q(`SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`)
        ).rows[0].n,
        7,
      );
    },
  );

  await t.test(
    'migrations and seed can be repeated without duplicates',
    async () => {
      await db.prisma('migrate', 'deploy');
      await seed(db.client, systems);
      const before = (await q('SELECT * FROM sheet_schemas ORDER BY id')).rows;
      const systemsBefore = (await q('SELECT * FROM game_systems ORDER BY id'))
        .rows;
      await seed(db.client, systems);
      assert.deepEqual(
        (await q('SELECT * FROM sheet_schemas ORDER BY id')).rows,
        before,
      );
      assert.deepEqual(
        (await q('SELECT * FROM game_systems ORDER BY id')).rows,
        systemsBefore,
      );
      assert.equal(
        (await q('SELECT count(*)::int AS n FROM game_systems')).rows[0].n,
        2,
      );
      assert.equal(
        (await q('SELECT count(*)::int AS n FROM sheet_schemas')).rows[0].n,
        2,
      );
      await db.prisma('migrate', 'status');
      const history = await q(`SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
      assert.deepEqual(
        history.rows.map((row) => row.migration_name),
        migrations,
      );
    },
  );

  await t.test(
    'Prisma history matches SQL checksums; published seed drift fails explicitly',
    async () => {
      const history =
        await q(`SELECT migration_name, checksum FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`);
      for (const row of history.rows) {
        assert.equal(
          row.checksum,
          createHash('sha256')
            .update(await migrationSql(row.migration_name))
            .digest('hex'),
        );
      }
      const changed = structuredClone(systems);
      changed[0].sheet.schema.sections[0].label = 'Changed';
      await assert.rejects(
        seed(db.client, changed),
        /Published seed schema differs/,
      );
      assert.deepEqual(
        (
          await q('SELECT schema FROM sheet_schemas WHERE id = $1', [
            systems[0].sheet.id,
          ])
        ).rows[0].schema,
        systems[0].sheet.schema,
      );
    },
  );

  await t.test(
    'hash is required and email uniqueness ignores casing and spaces',
    async () => {
      await q(
        `INSERT INTO users (id, username, email, password_hash) VALUES
      ($1, 'Owner', 'owner@example.test', 'test-fixture-hash'),
      ($2, 'Recipient', 'recipient@example.test', 'test-fixture-hash')`,
        [owner, recipient],
      );
      await assert.rejects(
        q(`INSERT INTO users (username, email, password_hash)
      VALUES ('Other', ' OWNER@example.test ', 'test-fixture-hash')`),
        { code: '23505' },
      );
      await assert.rejects(
        q(
          `INSERT INTO users (username, email) VALUES ('Other', 'other@example.test')`,
        ),
        { code: '23502' },
      );
      await assert.rejects(
        q(`INSERT INTO users (username, email, password_hash)
      VALUES ('Other', 'other@example.test', '')`),
        { code: '23514' },
      );
    },
  );

  await t.test(
    'built-in and imported ownership rules are enforced',
    async () => {
      await assert.rejects(
        q(
          `INSERT INTO game_systems (source, name) VALUES ('IMPORTED', 'Invalid')`,
        ),
        { code: '23514' },
      );
      await assert.rejects(
        q(
          `INSERT INTO game_systems (source, owner_id, builtin_code, name)
      VALUES ('BUILTIN', $1, 'invalid', 'Invalid')`,
          [owner],
        ),
        { code: '23514' },
      );
      await assert.rejects(
        q('DELETE FROM game_systems WHERE id = $1', [systems[0].id]),
        { code: '23514' },
      );
    },
  );

  await t.test(
    'character foreign keys bind its schema to its system',
    async () => {
      await assert.rejects(
        q(
          `INSERT INTO characters (owner_id, game_system_id, sheet_schema_id, name)
      VALUES ($1, $2, $3, 'Mismatch')`,
          [owner, systems[0].id, systems[1].sheet.id],
        ),
        { code: '23503' },
      );
      await assert.rejects(
        q(
          `INSERT INTO characters (owner_id, game_system_id, sheet_schema_id, name)
      VALUES ($1, $2, $3, 'No owner')`,
          [randomUUID(), systems[0].id, systems[0].sheet.id],
        ),
        { code: '23503' },
      );
      await createCharacter(original);
      await assert.rejects(
        q(
          'UPDATE characters SET sheet_schema_id = $1, game_system_id = $2 WHERE id = $3',
          [systems[1].sheet.id, systems[1].id, original],
        ),
        { code: '23514' },
      );
      await assert.rejects(
        q(`UPDATE characters SET data = '[]'::jsonb WHERE id = $1`, [original]),
        { code: '23514' },
      );
    },
  );

  await t.test(
    'versions have positive numbers, unique per character, and object snapshots',
    async () => {
      await q(
        `INSERT INTO character_versions (character_id, version_number, data)
      SELECT id, 1, data FROM characters WHERE id = $1`,
        [original],
      );
      await assert.rejects(
        q(
          `INSERT INTO character_versions (character_id, version_number, data)
      VALUES ($1, 1, '{}')`,
          [original],
        ),
        { code: '23505' },
      );
      await assert.rejects(
        q(
          `INSERT INTO character_versions (character_id, version_number, data)
      VALUES ($1, 0, '{}')`,
          [original],
        ),
        { code: '23514' },
      );
      await assert.rejects(
        q(
          `INSERT INTO character_versions (character_id, version_number, data)
      VALUES ($1, 2, '[]')`,
          [original],
        ),
        { code: '23514' },
      );
      await assert.rejects(
        q(
          `INSERT INTO character_versions (character_id, version_number, data)
      VALUES ($1, 1, '{}')`,
          [randomUUID()],
        ),
        { code: '23503' },
      );
    },
  );

  await t.test(
    'VIEW hides history by default; duplicate grants, invalid grants and updates fail',
    async () => {
      await q(
        `INSERT INTO character_shares (character_id, user_id, permission) VALUES ($1, $2, 'VIEW')`,
        [original, recipient],
      );
      assert.equal(
        (
          await q(
            'SELECT history_visible FROM character_shares WHERE character_id = $1',
            [original],
          )
        ).rows[0].history_visible,
        false,
      );
      await assert.rejects(
        q(
          `INSERT INTO character_shares (character_id, user_id, permission)
      VALUES ($1, $2, 'VIEW')`,
          [original, recipient],
        ),
        { code: '23505' },
      );
      await assert.rejects(
        q(
          `UPDATE character_shares SET history_visible = true WHERE character_id = $1`,
          [original],
        ),
        { code: '23514' },
      );
      await q('DELETE FROM character_shares WHERE character_id = $1', [
        original,
      ]);
      await assert.rejects(
        q(
          `INSERT INTO character_shares (character_id, user_id, permission)
      VALUES ($1, $2, 'ADMIN')`,
          [original, recipient],
        ),
        { code: '23514' },
      );
      await assert.rejects(
        q(
          `INSERT INTO character_shares (character_id, user_id, permission, history_visible)
      VALUES ($1, $2, 'EDIT', true)`,
          [original, recipient],
        ),
        { code: '23514' },
      );
      await assert.rejects(
        q(
          `INSERT INTO character_shares (character_id, user_id, permission)
      VALUES ($1, $2, 'VIEW')`,
          [original, owner],
        ),
        { code: '23514' },
      );
      await q(
        `INSERT INTO character_shares (character_id, user_id, permission, history_visible)
      VALUES ($1, $2, 'VIEW', true)`,
        [original, recipient],
      );
    },
  );

  await t.test(
    'history snapshots cannot be updated; restore truncates later versions without a new snapshot',
    async () => {
      await assert.rejects(
        q(
          `UPDATE character_versions SET data = '{}'::jsonb
      WHERE character_id = $1`,
          [original],
        ),
        { code: '23514' },
      );
      await q(
        `INSERT INTO character_versions (character_id, version_number, data)
      VALUES ($1, 2, '{"strength":18}'), ($1, 3, '{"strength":20}')`,
        [original],
      );
      await q('BEGIN');
      try {
        await q('SELECT id FROM characters WHERE id = $1 FOR UPDATE', [
          original,
        ]);
        await q(
          `UPDATE characters SET data = (
        SELECT data FROM character_versions WHERE character_id = $1 AND version_number = 1
      ) WHERE id = $1`,
          [original],
        );
        await q(
          'DELETE FROM character_versions WHERE character_id = $1 AND version_number > 1',
          [original],
        );
        await q('COMMIT');
      } catch (error) {
        await q('ROLLBACK');
        throw error;
      }
      assert.deepEqual(
        (
          await q(
            'SELECT version_number FROM character_versions WHERE character_id = $1',
            [original],
          )
        ).rows,
        [{ version_number: 1 }],
      );
      assert.equal(
        (await q('SELECT data FROM characters WHERE id = $1', [original]))
          .rows[0].data.strength,
        16,
      );
    },
  );

  await t.test(
    'published schemas reject mutation and used schemas reject deletion',
    async () => {
      await assert.rejects(
        q(`UPDATE sheet_schemas SET schema = '{"sections":[]}' WHERE id = $1`, [
          systems[0].sheet.id,
        ]),
        { code: '23514' },
      );
      await assert.rejects(
        q('DELETE FROM sheet_schemas WHERE id = $1', [systems[0].sheet.id]),
        (error) => ['23503', '23001'].includes(error.code),
      );
    },
  );

  await t.test(
    'EDIT creates independent data/history and a grant that cannot be revoked',
    async () => {
      await q('BEGIN');
      try {
        await q(
          `INSERT INTO characters
        (id, owner_id, game_system_id, sheet_schema_id, name, data,
         source_character_id, source_owner_id, source_owner_username, copied_at)
        SELECT $1, $2, game_system_id, sheet_schema_id, name || ' (копия)', data,
         id, owner_id, 'Owner', now() FROM characters WHERE id = $3`,
          [copied, recipient, original],
        );
        await q(
          `INSERT INTO character_versions (character_id, version_number, data)
        SELECT id, 1, data FROM characters WHERE id = $1`,
          [copied],
        );
        await q('DELETE FROM character_shares WHERE character_id = $1', [
          original,
        ]);
        await q(
          `INSERT INTO character_shares (character_id, user_id, permission)
        VALUES ($1, $2, 'EDIT')`,
          [original, recipient],
        );
        await q('COMMIT');
      } catch (error) {
        await q('ROLLBACK');
        throw error;
      }
      await q(
        `UPDATE characters SET data = jsonb_set(data, '{strength}', '20') WHERE id = $1`,
        [copied],
      );
      assert.equal(
        (await q('SELECT data FROM characters WHERE id = $1', [original]))
          .rows[0].data.strength,
        16,
      );
      assert.equal(
        (
          await q(
            'SELECT data FROM character_versions WHERE character_id = $1',
            [copied],
          )
        ).rows[0].data.strength,
        16,
      );
      await assert.rejects(
        q('DELETE FROM character_shares WHERE character_id = $1', [original]),
        { code: '23514' },
      );
      await assert.rejects(
        q('UPDATE characters SET source_character_id = NULL WHERE id = $1', [
          copied,
        ]),
        { code: '23514' },
      );
      await assert.rejects(
        q(
          "UPDATE characters SET source_owner_username = 'Someone else' WHERE id = $1",
          [copied],
        ),
        { code: '23514' },
      );
    },
  );

  await t.test(
    'deleting an original cascades its versions/shares and preserves the independent copy',
    async () => {
      await q('DELETE FROM characters WHERE id = $1', [original]);
      assert.equal(
        (
          await q(
            'SELECT count(*)::int AS n FROM character_versions WHERE character_id = $1',
            [original],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await q(
            'SELECT count(*)::int AS n FROM character_shares WHERE character_id = $1',
            [original],
          )
        ).rows[0].n,
        0,
      );
      const copy = (await q('SELECT * FROM characters WHERE id = $1', [copied]))
        .rows[0];
      assert.equal(copy.source_character_id, null);
      assert.equal(copy.source_owner_username, 'Owner');
      assert.ok(copy.copied_at);
      assert.equal(copy.data.strength, 20);
      assert.equal(
        (
          await q(
            'SELECT count(*)::int AS n FROM character_versions WHERE character_id = $1',
            [copied],
          )
        ).rows[0].n,
        1,
      );
    },
  );

  await t.test(
    'soft deletion preserves imported schemas, existing sheets/history and new EDIT copies',
    async () => {
      const imported = { id: randomUUID(), sheet: { id: randomUUID() } };
      const existing = randomUUID();
      await q(
        `INSERT INTO game_systems (id, owner_id, source, name)
      VALUES ($1, $2, 'IMPORTED', 'Custom game')`,
        [imported.id, owner],
      );
      await q(
        `INSERT INTO sheet_schemas (id, game_system_id, name, schema)
      VALUES ($1, $2, 'Custom sheet', $3::jsonb)`,
        [
          imported.sheet.id,
          imported.id,
          JSON.stringify(systems[0].sheet.schema),
        ],
      );
      await createCharacter(existing, imported);
      await q(
        `INSERT INTO character_versions (character_id, version_number, data)
      SELECT id, 1, data FROM characters WHERE id = $1`,
        [existing],
      );
      await q('UPDATE game_systems SET deleted_at = now() WHERE id = $1', [
        imported.id,
      ]);
      assert.equal(
        (
          await q(
            'SELECT count(*)::int AS n FROM game_systems WHERE id = $1 AND deleted_at IS NULL',
            [imported.id],
          )
        ).rows[0].n,
        0,
      );
      await assert.rejects(createCharacter(randomUUID(), imported), {
        code: '23514',
      });
      await assert.rejects(
        q('UPDATE game_systems SET deleted_at = NULL WHERE id = $1', [
          imported.id,
        ]),
        { code: '23514' },
      );
      await assert.rejects(
        q('DELETE FROM game_systems WHERE id = $1', [imported.id]),
        (error) => ['23503', '23001'].includes(error.code),
      );
      await q(
        `UPDATE characters SET data = jsonb_set(data, '{strength}', '18') WHERE id = $1`,
        [existing],
      );
      await q(
        `INSERT INTO character_versions (character_id, version_number, data)
      SELECT id, 2, data FROM characters WHERE id = $1`,
        [existing],
      );
      const secondCopy = randomUUID();
      await q(
        `INSERT INTO characters
      (id, owner_id, game_system_id, sheet_schema_id, name, data,
       source_character_id, source_owner_id, source_owner_username, copied_at)
      SELECT $1, $2, game_system_id, sheet_schema_id, name || ' (копия)', data,
       id, owner_id, 'Owner', now() FROM characters WHERE id = $3`,
        [secondCopy, recipient, existing],
      );
      assert.equal(
        (
          await q('SELECT schema FROM sheet_schemas WHERE id = $1', [
            imported.sheet.id,
          ])
        ).rows[0].schema.sections.length,
        3,
      );
      assert.equal(
        (
          await q(
            'SELECT count(*)::int AS n FROM character_versions WHERE character_id = $1',
            [existing],
          )
        ).rows[0].n,
        2,
      );
    },
  );

  await t.test(
    'seed drift rolls back all earlier inserts in the same run',
    async () => {
      const changed = structuredClone(systems);
      changed[0].id = randomUUID();
      changed[0].code = 'transaction-fixture';
      changed[0].sheet.id = randomUUID();
      changed[1].sheet.schema.sections[0].label = 'Changed';
      await assert.rejects(
        seed(db.client, changed),
        /Published seed schema differs/,
      );
      assert.equal(
        (
          await q('SELECT count(*)::int AS n FROM game_systems WHERE id = $1', [
            changed[0].id,
          ])
        ).rows[0].n,
        0,
      );
    },
  );
});

await test('Prisma baseline adopts existing tables without recreating data', async (t) => {
  const db = await database();
  t.after(db.close);
  for (const name of migrations)
    await db.client.query(await migrationSql(name));
  const id = randomUUID();
  await db.client.query(
    `INSERT INTO users (id, username, email, password_hash)
    VALUES ($1, 'Baseline', 'baseline@example.test', 'fixture-hash')`,
    [id],
  );
  const before = (
    await db.client.query('SELECT * FROM users WHERE id = $1', [id])
  ).rows;
  for (const name of migrations)
    await db.prisma('migrate', 'resolve', '--applied', name);
  await db.prisma('migrate', 'deploy');
  await db.prisma('migrate', 'status');
  assert.deepEqual(
    (await db.client.query('SELECT * FROM users WHERE id = $1', [id])).rows,
    before,
  );
  assert.equal(
    (
      await db.client.query(`SELECT count(*)::int AS n FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)
    ).rows[0].n,
    migrations.length,
  );
});
