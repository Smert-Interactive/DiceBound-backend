import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const saveCharacterSchema = z.strictObject({
  // Keep every JSON key for the schema validator, including __proto__.
  // z.record silently removes that key before unknown-field validation.
  data: z.custom<Record<string, unknown>>(
    (value) =>
      value !== null && typeof value === 'object' && !Array.isArray(value),
    'data must be an object',
  ),
});

export class SaveCharacterDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Complete replacement of user fields, without calculated fields',
    example: {
      strength: 16,
      inspiration: false,
      hit_points: { current: 8, max: 12 },
    },
  })
  data: Record<string, unknown>;
}
