import { createHash } from 'node:crypto';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { verify } from 'argon2';
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
import { SessionService } from '../src/modules/auth/session.service.js';
import { authPrismaMock } from './helpers/auth-prisma.mock.js';

const origin = 'http://localhost:5173';
const credentials = {
  email: 'player@example.com',
  password: 'example-password-123',
};
const registration = {
  ...credentials,
  password_confirmation: credentials.password,
};

@Controller('test-private')
class PrivateController {
  @Get()
  get() {
    return { protected: true };
  }
}

describe('Session authentication (HTTP acceptance)', () => {
  let app: INestApplication;
  const db = authPrismaMock();
  const http = () => request(app.getHttpServer());
  const register = (body = registration) =>
    http().post('/api/v1/auth/register').set('Origin', origin).send(body);
  const login = (body = credentials) =>
    http().post('/api/v1/auth/login').set('Origin', origin).send(body);
  const cookieFrom = (response: request.Response) =>
    (response.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  const signIn = async () => {
    await register().expect(201);
    return cookieFrom(await login().expect(200));
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [PrivateController],
    })
      .overrideProvider(PrismaService)
      .useValue(db.prisma)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  beforeEach(() => {
    db.users.clear();
    db.sessions.clear();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('registers normalized email, hashes the password, and creates no session', async () => {
    const result = await register({
      ...registration,
      email: '  Player@Example.COM  ',
    }).expect(201);
    expect(Object.keys(result.body).sort()).toEqual([
      'created_at',
      'email',
      'id',
      'username',
    ]);
    expect(result.body.email).toBe(credentials.email);
    expect(result.body.username).toMatch(/^player_/);
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(db.sessions.size).toBe(0);
    const user = [...db.users.values()][0];
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verify(user.passwordHash, credentials.password)).toBe(true);
  });

  it.each([
    { ...registration, password: 'short', password_confirmation: 'short' },
    { ...registration, password_confirmation: 'different' },
    { ...registration, email: 'invalid' },
    { email: credentials.email },
    { ...registration, password: 12345 },
    {
      ...registration,
      password: 'x'.repeat(1025),
      password_confirmation: 'x'.repeat(1025),
    },
  ])('rejects invalid registration: %j', async (body) => {
    const result = await http()
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send(body)
      .expect(400);
    expect(result.body.code).toBe('BAD_REQUEST');
    expect(typeof result.body.message).toBe('string');
    expect(db.users.size).toBe(0);
  });

  it('maps the DB unique violation to 409 for mixed-case duplicate email', async () => {
    await register().expect(201);
    const result = await register({
      ...registration,
      email: 'PLAYER@EXAMPLE.COM',
    }).expect(409);
    expect(result.body.code).toBe('CONFLICT');
    expect(db.users.size).toBe(1);
  });

  it('logs in, sets cookie flags, stores only a token hash, and returns safe user data', async () => {
    await register().expect(201);
    const result = await login({
      ...credentials,
      email: ' PLAYER@EXAMPLE.COM ',
    }).expect(200);
    const header = (result.headers['set-cookie'] as unknown as string[])[0];
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/api/v1');
    expect(header).toMatch(/Max-Age=60479[0-9]|Max-Age=604800/);
    expect(header).not.toContain('Secure');
    expect(Object.keys(result.body).sort()).toEqual([
      'created_at',
      'email',
      'id',
      'username',
    ]);
    const token = cookieFrom(result).split('=')[1];
    const session = [...db.sessions.values()][0];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.tokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      604_790_000,
    );
  });

  it('uses the same error for unknown email and wrong password', async () => {
    await register().expect(201);
    const wrongPassword = await login({
      ...credentials,
      password: 'wrong-password',
    }).expect(401);
    const unknown = await login({
      ...credentials,
      email: 'unknown@example.com',
    }).expect(401);
    expect(wrongPassword.body.message).toBe(unknown.body.message);
    expect(unknown.body.code).toBe('UNAUTHORIZED');
    expect(db.sessions.size).toBe(0);
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('validates login input', async () => {
    await login({ ...credentials, email: 'invalid' }).expect(400);
  });

  it('me returns CurrentUser and counts only VIEW as shared', async () => {
    const cookie = await signIn();
    db.prisma.character.count.mockResolvedValueOnce(3);
    db.prisma.characterShare.count.mockResolvedValueOnce(2);
    const result = await http()
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(result.body).toMatchObject({
      email: credentials.email,
      owned_characters_count: 3,
      shared_characters_count: 2,
    });
    expect(Object.keys(result.body).sort()).toEqual([
      'created_at',
      'email',
      'id',
      'owned_characters_count',
      'shared_characters_count',
      'username',
    ]);
    expect(db.prisma.characterShare.count).toHaveBeenCalledWith({
      where: { userId: result.body.id, permission: 'VIEW' },
    });
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it.each([
    undefined,
    'dicebound_session=invalid',
    `dicebound_session=${'x'.repeat(43)}`,
  ])('rejects missing, malformed, or unknown session (%s)', async (cookie) => {
    const call = http().get('/api/v1/auth/me');
    if (cookie) call.set('Cookie', cookie);
    const result = await call.expect(401);
    expect(result.body).toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
      path: '/api/v1/auth/me',
    });
    expect(new Date(result.body.timestamp).toISOString()).toBe(
      result.body.timestamp,
    );
  });

  it('rejects expired sessions immediately, before cleanup runs', async () => {
    const cookie = await signIn();
    [...db.sessions.values()][0].expiresAt = new Date(Date.now() - 1);
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });

  it('rejects a session whose user no longer exists', async () => {
    const cookie = await signIn();
    db.users.clear();
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });

  it('logout clears the cookie and revokes a copied token, preserving other devices', async () => {
    const cookie = await signIn();
    const otherDevice = cookieFrom(await login().expect(200));
    const result = await http()
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('Cookie', cookie)
      .expect(204);
    expect(result.text).toBe('');
    expect((result.headers['set-cookie'] as unknown as string[])[0]).toContain(
      'Path=/api/v1',
    );
    expect((result.headers['set-cookie'] as unknown as string[])[0]).toContain(
      'Expires=Thu, 01 Jan 1970',
    );
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    await http().get('/api/v1/auth/me').set('Cookie', otherDevice).expect(200);
  });

  it('rotates a previous cookie on re-login', async () => {
    const cookie = await signIn();
    const result = await login().set('Cookie', cookie).expect(200);
    expect(cookieFrom(result)).not.toBe(cookie);
    expect(db.sessions.size).toBe(1);
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
  });

  it.each([
    'https://evil.example',
    'null',
    'http://localhost:5173.evil.example',
    undefined,
  ])(
    'rejects disallowed/missing Origin (%s), including public login',
    async (untrusted) => {
      const call = http().post('/api/v1/auth/login').send(credentials);
      if (untrusted) call.set('Origin', untrusted);
      const result = await call.expect(403);
      expect(result.body.code).toBe('FORBIDDEN');
      expect(db.prisma.$queryRaw).not.toHaveBeenCalled();
    },
  );

  it('CSRF rejection leaves an authenticated session unchanged', async () => {
    const cookie = await signIn();
    await http()
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookie)
      .expect(403);
    await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
  });

  it('CORS supports credentialed preflight only for allowed origins', async () => {
    const allowed = await http()
      .options('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(origin);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const denied = await http()
      .options('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('protects new controllers by default and leaves infrastructure public', async () => {
    await http().get('/test-private').expect(401);
    const cookie = await signIn();
    await http().get('/test-private').set('Cookie', cookie).expect(200);
    await http().get('/').expect(200);
    await http().get('/health').expect(200);
  });

  it('cleans expired records without deleting active sessions', async () => {
    await signIn();
    const expired = [...db.sessions.values()][0];
    expired.expiresAt = new Date(Date.now() - 1);
    await login().expect(200);
    await app.get(SessionService).cleanupExpired();
    expect(db.sessions.size).toBe(1);
    expect(db.sessions.has(expired.id)).toBe(false);
  });

  it('sanitizes unexpected backend errors', async () => {
    db.prisma.user.create.mockRejectedValueOnce(
      new Error('private database detail'),
    );
    const result = await register().expect(500);
    expect(result.body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(JSON.stringify(result.body)).not.toContain('private');
  });
});

describe('Authentication rate limits', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(authPrismaMock().prisma)
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['login', 10],
    ['register', 5],
  ] as const)(
    'limits %s attempts per IP before hashing',
    async (route, limit) => {
      for (let i = 0; i < limit; i++) {
        await request(app.getHttpServer())
          .post(`/api/v1/auth/${route}`)
          .set('Origin', origin)
          .send({})
          .expect(400);
      }
      const result = await request(app.getHttpServer())
        .post(`/api/v1/auth/${route}`)
        .set('Origin', origin)
        .send({})
        .expect(429);
      expect(result.body.code).toBe('TOO_MANY_REQUESTS');
      expect(result.headers['retry-after']).toBeDefined();
    },
  );
});
