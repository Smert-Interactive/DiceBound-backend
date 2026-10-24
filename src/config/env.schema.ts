import { z } from 'zod';

const originSchema = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
}, 'Each allowed origin must be an exact HTTP(S) origin without a path');

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535),
    DATABASE_URL: z
      .url()
      .refine(
        (value) =>
          URL.canParse(value) &&
          ['postgresql:', 'postgres:'].includes(new URL(value).protocol),
        'DATABASE_URL must be a PostgreSQL URL',
      ),
    ALLOWED_ORIGINS: z
      .string()
      .optional()
      .transform((value) =>
        value === undefined
          ? undefined
          : value.split(',').map((origin) => origin.trim()),
      )
      .pipe(z.array(originSchema).min(1).optional()),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && !env.ALLOWED_ORIGINS) {
      context.addIssue({
        code: 'custom',
        path: ['ALLOWED_ORIGINS'],
        message: 'ALLOWED_ORIGINS is required in production',
      });
    }
  })
  .transform((env) => ({
    ...env,
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS ?? [
      'http://localhost:3000',
      'http://localhost:5173',
    ],
  }));
