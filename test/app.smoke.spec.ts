import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

describe('Backend smoke tests', () => {
  let app: INestApplication | undefined;

  const prismaMock = {
    onModuleInit: vi.fn(),
    onModuleDestroy: vi.fn(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $queryRaw: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication();

    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('initializes the application', () => {
    expect(app).toBeDefined();
    expect(app?.getHttpServer()).toBeDefined();
  });

  it('GET /health returns 200 and valid JSON', async () => {
    if (!app) {
      throw new Error('Application was not initialized');
    }

    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect('Content-Type', /json/)
      .expect({ status: 'ok' });
  });
});
