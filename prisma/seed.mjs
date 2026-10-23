import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const migrationNames = [
  '001_users',
  '002_game_systems',
  '003_characters',
  '004_character_shares',
];

export async function readSeed() {
  return JSON.parse(
    await readFile(
      new URL('./seeds/builtin-systems.json', import.meta.url),
      'utf8',
    ),
  );
}

// Prisma invokes this script; pg keeps the seed executable without a TS loader.
// All writes share one transaction, including checks against published data.
export async function seed(client, systems) {
  systems ??= await readSeed();
  await client.query('BEGIN');
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('dicebound:builtin-seed'))",
    );
    const history = await client.query(
      `SELECT to_regclass('"_prisma_migrations"') IS NOT NULL AS present`,
    );
    if (!history.rows[0].present)
      throw new Error('Seed blocked: pending migrations');
    const applied = await client.query(
      `SELECT migration_name FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    const names = new Set(applied.rows.map((row) => row.migration_name));
    if (migrationNames.some((name) => !names.has(name))) {
      throw new Error('Seed blocked: pending migrations');
    }

    for (const system of systems) {
      await client.query(
        `INSERT INTO game_systems (id, source, builtin_code, name, description)
         VALUES ($1, 'BUILTIN', $2, $3, $4) ON CONFLICT DO NOTHING`,
        [system.id, system.code, system.name, system.description],
      );
      const actualSystem = await client.query(
        `SELECT id, owner_id, source, builtin_code, name, description, deleted_at
         FROM game_systems WHERE id = $1 FOR SHARE`,
        [system.id],
      );
      assert.deepEqual(
        actualSystem.rows[0],
        {
          id: system.id,
          owner_id: null,
          source: 'BUILTIN',
          builtin_code: system.code,
          name: system.name,
          description: system.description,
          deleted_at: null,
        },
        `Published seed system differs: ${system.code}`,
      );

      await client.query(
        `INSERT INTO sheet_schemas (id, game_system_id, name, schema)
         VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING`,
        [
          system.sheet.id,
          system.id,
          system.sheet.name,
          JSON.stringify(system.sheet.schema),
        ],
      );
      const actualSchema = await client.query(
        `SELECT id, game_system_id, name, schema FROM sheet_schemas WHERE id = $1 FOR SHARE`,
        [system.sheet.id],
      );
      assert.deepEqual(
        actualSchema.rows[0],
        {
          id: system.sheet.id,
          game_system_id: system.id,
          name: system.sheet.name,
          schema: system.sheet.schema,
        },
        `Published seed schema differs: ${system.code}`,
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is required for db:seed');
  }
  const url = new URL(process.env.DATABASE_URL);
  const namespace = url.searchParams.get('schema') ?? 'public';
  // Prisma uses ?schema=; pg needs search_path instead. Quote identifiers so an
  // explicit Prisma schema is also respected by seed and database tests.
  url.searchParams.delete('schema');
  const client = new pg.Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query("SELECT set_config('search_path', $1, false)", [
      `"${namespace.replaceAll('"', '""')}"`,
    ]);
    await seed(client);
    console.log('Built-in systems and sheet schemas are up to date.');
  } finally {
    await client.end();
  }
}
