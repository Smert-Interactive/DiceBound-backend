import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535),

    DATABASE_URL: z.url().refine(
      (value) => {
        const protocol = new URL(value).protocol;

        return protocol === 'postgresql:' ||
              protocol === 'postgres:';
      },
      'DATABASE_URL must be a PostgreSQL URL',
    ),
});