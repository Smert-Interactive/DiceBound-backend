import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

// Normalize before email validation, so surrounding whitespace is accepted.
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email());
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
});

export class LoginDto {
  @ApiProperty({
    format: 'email',
    maxLength: 254,
    example: 'player@example.com',
  })
  email: string;

  @ApiProperty({ minLength: 1, maxLength: 1024, writeOnly: true })
  password: string;
}
