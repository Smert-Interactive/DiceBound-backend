import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';

const exec = promisify(execFile);

/** All DDL/fixtures are confined to a random schema, without a public search_path fallback. */
export async function createPostgresApp() {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required for PostgreSQL tests');
  const namespace = `dicebound_systems_test_${randomUUID().replaceAll('-', '')}`;
  const target = new URL(process.env.DATABASE_URL);
  target.searchParams.delete('schema');
  target.searchParams.delete('options');
  const admin = new pg.Client({
    connectionString: target.toString(),
    connectionTimeoutMillis: 5000,
  });
  let created = false;
  let prisma: PrismaClient | undefined;
  let app: INestApplication | undefined;
  const close = async () => {
    try {
      await app?.close();
    } finally {
      try {
        await prisma?.$disconnect();
      } finally {
        try {
          if (created) await admin.query(`DROP SCHEMA "${namespace}" CASCADE`);
        } finally {
          await admin.end();
        }
      }
    }
  };
  const migrationTarget = new URL(target);
  migrationTarget.searchParams.set('schema', namespace);
  const run = async (args: string[]) => {
    try {
      await exec(process.execPath, args, {
        env: { ...process.env, DATABASE_URL: migrationTarget.toString() },
        timeout: 60_000,
      });
    } catch {
      // Never echo a CLI error that might include DATABASE_URL.
      throw new Error('Isolated test database migration/seed failed');
    }
  };
  try {
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${namespace}"`);
    created = true;
    await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
    prisma = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: target.toString(),
          options: `-c search_path=${namespace}`,
          connectionTimeoutMillis: 5000,
        },
        { schema: namespace },
      ),
    });
    await prisma.$connect();
    const [actual] = await prisma.$queryRaw<
      { name: string }[]
    >`SELECT current_schema() AS name`;
    if (actual.name !== namespace)
      throw new Error('Test database schema isolation failed');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    return { app, prisma, close, seed: () => run(['prisma/seed.mjs']) };
  } catch (error) {
    await close();
    throw error;
  }
}
