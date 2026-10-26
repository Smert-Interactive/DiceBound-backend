import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { MAX_SCHEMA_BYTES } from '../validation/sheet-schema.schema.js';

const schemaText = z
  .string()
  .max(MAX_SCHEMA_BYTES)
  .refine(
    (text) => Buffer.byteLength(text, 'utf8') <= MAX_SCHEMA_BYTES,
    `schema_text must not exceed ${MAX_SCHEMA_BYTES} UTF-8 bytes`,
  );
export const validateGameSystemSchema = z.strictObject({
  schema_text: schemaText,
});
export const importGameSystemSchema = z.strictObject({
  system_name: z.string().trim().min(1).max(255),
  sheet_schema_name: z.string().trim().min(1).max(255),
  schema_text: schemaText,
});

export class ValidateGameSystemDto {
  @ApiProperty({
    maxLength: MAX_SCHEMA_BYTES,
    description: 'JSON text of a SheetSchema, at most 64 KiB in UTF-8',
    example: '{"sections":[]}',
  })
  schema_text: string;
}

export class ImportGameSystemDto extends ValidateGameSystemDto {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  system_name: string;

  @ApiProperty({ minLength: 1, maxLength: 255 })
  sheet_schema_name: string;
}
