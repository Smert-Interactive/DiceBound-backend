
import { describe, expect, it } from 'vitest';

import { envSchema } from './env.schema.js';

describe('envSchema', () => {
  const validEnv = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL:
      'postgresql://test:test@localhost:5432/dicebound_test',
  };

  it('accepts valid environment variables', () => {
    const result = envSchema.safeParse(validEnv);

    expect(result.success).toBe(true);
  });

  it.each([
    [
      'missing PORT',
      { ...validEnv, PORT: undefined },
    ],
    [
      'invalid PORT',
      { ...validEnv, PORT: 'invalid' },
    ],
    [
      'missing DATABASE_URL',
      { ...validEnv, DATABASE_URL: undefined },
    ],
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
