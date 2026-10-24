import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { configureApp } from '../../src/configure-app.js';
import { SessionService } from '../../src/modules/auth/session.service.js';

const exec = promisify(execFile);
const origin = 'http://localhost:5173';
const registration = {
  email: 'postgres@example.com',
  password: 'safe-password-123',
  password_confirmation: 'safe-password-123',
};

describe('Authentication with real PostgreSQL and deployed migrations', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaClient | undefined;
  let admin: pg.Client | undefined;
  let schemaCreated = false;
  const schema = `dicebound_auth_test_${randomUUID().replaceAll('-', '')}`;
  const http = () => request(app!.getHttpServer());
  const register = (body = registration) =>
    http().post('/api/v1/auth/register').set('Origin', origin).send(body);
  const login = (email = registration.email) =>
    http()
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email, password: registration.password });
  const cookieFrom = (response: request.Response) =>
    (response.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL is required for PostgreSQL auth tests');
    const target = new URL(process.env.DATABASE_URL);
    target.searchParams.delete('schema');
    admin = new pg.Client({
      connectionString: target.toString(),
      connectionTimeoutMillis: 5000,
    });
    await admin.connect();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const migrationTarget = new URL(target);
    migrationTarget.searchParams.set('schema', schema);
    try {
      await exec(
        process.execPath,
        ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
        {
          env: { ...process.env, DATABASE_URL: migrationTarget.toString() },
          timeout: 60_000,
        },
      );
    } catch {
      throw new Error('Prisma migrate deploy failed for isolated auth schema');
    }
    prisma = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: target.toString(),
          options: `-c search_path=${schema}`,
          connectionTimeoutMillis: 5000,
        },
        { schema },
      ),
    });
    await prisma.$connect();
    expect(await prisma.$queryRaw`SELECT current_schema() AS name`).toEqual([
      { name: schema },
    ]);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      // Rate limiting is verified separately; DB cases must exercise DB concurrency.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  beforeEach(async () => {
    // The connection is pinned to the random schema, with no public search_path fallback.
    await prisma!.$executeRawUnsafe('TRUNCATE users, game_systems CASCADE');
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      try {
        await prisma?.$disconnect();
      } finally {
        try {
          if (schemaCreated)
            await admin?.query(`DROP SCHEMA "${schema}" CASCADE`);
        } finally {
          await admin?.end();
        }
      }
    }
  });

  it('migrates an empty schema, registers without a session, and persists Argon2id', async () => {
    const result = await register().expect(201);
    const user = await prisma!.user.findUniqueOrThrow({
      where: { id: result.body.id },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await prisma!.authSession.count()).toBe(0);
    expect(Object.keys(result.body).sort()).toEqual([
      'created_at',
      'email',
      'id',
      'username',
    ]);
    const history = await prisma!.$queryRaw<
      { migration_name: string }[]
    >`SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name`;
    expect(history.at(-1)?.migration_name).toBe('005_auth_sessions');
  });

  it('handles a concurrent normalized email collision as 201 + 409', async () => {
    const results = await Promise.all([
      register(),
      register({ ...registration, email: ' POSTGRES@EXAMPLE.COM ' }),
    ]);
    expect(results.map((item) => item.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(results.find((item) => item.status === 409)?.body.code).toBe(
      'CONFLICT',
    );
    expect(await prisma!.user.count()).toBe(1);
  });

  it('logs in against legacy padded mixed-case email using the expression index', async () => {
    const result = await register().expect(201);
    await prisma!.user.update({
      where: { id: result.body.id },
      data: { email: ' Postgres@Example.COM ' },
    });
    await login(' POSTGRES@EXAMPLE.COM ').expect(200);
    await register().expect(409);
  });

  it('persists login across a new session service and logout invalidates the original cookie', async () => {
    await register().expect(201);
    const agent = request.agent(app!.getHttpServer());
    const loginResult = await agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send(registration)
      .expect(200);
    const cookie = cookieFrom(loginResult);
    const token = cookie.split('=')[1];
    const replacement = new SessionService(
      prisma as PrismaService,
      new ConfigService({ NODE_ENV: 'test' }),
    );
    expect(await replacement.authenticate(token)).toMatchObject({
      user: { email: registration.email },
    });
    await agent
      .get('/api/v1/auth/me')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          owned_characters_count: 0,
          shared_characters_count: 0,
        });
      });
    await agent.post('/api/v1/auth/logout').set('Origin', origin).expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    expect(await prisma!.authSession.count()).toBe(0);
  });

  it('rejects expired sessions and cleans only expired records', async () => {
    await register().expect(201);
    const oldCookie = cookieFrom(await login().expect(200));
    await prisma!.authSession.updateMany({
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const activeCookie = cookieFrom(await login().expect(200));
    await http().get('/api/v1/auth/me').set('Cookie', oldCookie).expect(401);
    await app!.get(SessionService).cleanupExpired();
    expect(await prisma!.authSession.count()).toBe(1);
    await http().get('/api/v1/auth/me').set('Cookie', activeCookie).expect(200);
  });

  it('enforces token uniqueness, user FK, indexes, and session cascade deletion', async () => {
    const result = await register().expect(201);
    const cookie = cookieFrom(await login().expect(200));
    const session = await prisma!.authSession.findFirstOrThrow();
    const { id: _id, ...duplicate } = session;
    await expect(
      prisma!.authSession.create({ data: duplicate }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma!.authSession.create({
        data: { ...duplicate, tokenHash: 'a'.repeat(64), userId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const indexes = await prisma!.$queryRaw<
      { indexname: string }[]
    >`SELECT indexname FROM pg_indexes WHERE schemaname = ${schema} AND tablename = 'auth_sessions'`;
    expect(indexes.map((item) => item.indexname)).toEqual(
      expect.arrayContaining([
        'auth_sessions_user_idx',
        'auth_sessions_expires_idx',
        'auth_sessions_token_hash_key',
      ]),
    );
    await prisma!.user.delete({ where: { id: result.body.id } });
    expect(await prisma!.authSession.count()).toBe(0);
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });

  it('counts owned characters/copies and VIEW shares without double counting EDIT', async () => {
    const first = await register().expect(201);
    const second = await register({
      ...registration,
      email: 'owner@example.com',
    }).expect(201);
    const system = await prisma!.gameSystem.create({
      data: {
        source: 'BUILTIN',
        builtinCode: 'auth-test',
        name: 'Test system',
      },
    });
    const sheet = await prisma!.sheetSchema.create({
      data: {
        gameSystemId: system.id,
        name: 'Test sheet',
        schema: { sections: [] },
      },
    });
    const character = (ownerId: string, name: string) =>
      prisma!.character.create({
        data: {
          ownerId,
          name,
          gameSystemId: system.id,
          sheetSchemaId: sheet.id,
        },
      });
    await character(first.body.id, 'Owned');
    const viewed = await character(second.body.id, 'Viewed');
    const edited = await character(second.body.id, 'Source');
    await prisma!.characterShare.createMany({
      data: [
        { characterId: viewed.id, userId: first.body.id, permission: 'VIEW' },
        { characterId: edited.id, userId: first.body.id, permission: 'EDIT' },
      ],
    });
    await prisma!.character.create({
      data: {
        ownerId: first.body.id,
        name: 'Copy',
        gameSystemId: system.id,
        sheetSchemaId: sheet.id,
        sourceCharacterId: edited.id,
        sourceOwnerId: second.body.id,
        sourceOwnerUsername: second.body.username,
        copiedAt: new Date(),
      },
    });
    const cookie = cookieFrom(await login().expect(200));
    const me = await http()
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body).toMatchObject({
      owned_characters_count: 2,
      shared_characters_count: 1,
    });
  });
});
