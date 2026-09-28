import { describe, expect, it } from 'vitest';

import { envSchema } from './env.schema.js';

describe('envSchema', () => {
  it('accepts valid environment variables', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      PORT: '3000',
    });

    expect(result.success).toBe(true);
  });

  it('rejects environment without PORT', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid PORT', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      PORT: 'not-a-port',
    });

    expect(result.success).toBe(false);
  });
});