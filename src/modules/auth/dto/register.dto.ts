import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { emailSchema } from './login.dto.js';

export const registerSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(8).max(1024),
    password_confirmation: z.string().max(1024),
  })
  .refine((data) => data.password === data.password_confirmation, {
    path: ['password_confirmation'],
    message: 'Passwords do not match',
  });

export class RegisterDto {
  @ApiProperty({
    format: 'email',
    maxLength: 254,
    example: 'player@example.com',
  })
  email: string;

  @ApiProperty({ minLength: 8, maxLength: 1024, writeOnly: true })
  password: string;

  @ApiProperty({ maxLength: 1024, writeOnly: true })
  password_confirmation: string;
}
