import { describe, expect, it } from 'vitest';

import { envSchema } from './env.schema.js';

describe('envSchema', () => {
  const validEnv = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/dicebound_test',
  };

  it('accepts valid environment variables', () => {
    const result = envSchema.safeParse(validEnv);

    expect(result.success).toBe(true);
  });

  it.each([
    ['missing PORT', { ...validEnv, PORT: undefined }],
    ['invalid PORT', { ...validEnv, PORT: 'invalid' }],
    ['missing DATABASE_URL', { ...validEnv, DATABASE_URL: undefined }],
    [
      'invalid DATABASE_URL protocol',
      {
        ...validEnv,
        DATABASE_URL: 'mysql://localhost:3306/test',
      },
    ],
  ])('rejects %s', (_name, env) => {
    const result = envSchema.safeParse(env);

    expect(result.success).toBe(false);
  });
});

describe('auth origin configuration', () => {
  const base = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgresql://test:test@localhost/test',
  };

  it('provides development origins and parses an explicit allowlist', () => {
    expect(envSchema.parse(base).ALLOWED_ORIGINS).toContain(
      'http://localhost:5173',
    );
    expect(
      envSchema.parse({
        ...base,
        ALLOWED_ORIGINS: 'https://app.example.com, https://api.example.com',
      }).ALLOWED_ORIGINS,
    ).toEqual(['https://app.example.com', 'https://api.example.com']);
  });

  it.each([
    '*',
    'null',
    '',
    'not a URL',
    'ftp://example.com',
    'https://example.com/',
    'https://example.com/path',
  ])('rejects invalid origin %s without throwing', (value) => {
    expect(
      envSchema.safeParse({ ...base, ALLOWED_ORIGINS: value }).success,
    ).toBe(false);
  });

  it('requires explicit origins in production', () => {
    expect(
      envSchema.safeParse({ ...base, NODE_ENV: 'production' }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...base,
        NODE_ENV: 'production',
        ALLOWED_ORIGINS: 'https://app.example.com',
      }).success,
    ).toBe(true);
  });

  it('rejects a malformed database URL without throwing', () => {
    expect(
      envSchema.safeParse({ ...base, DATABASE_URL: 'not a URL' }).success,
    ).toBe(false);
  });
});
