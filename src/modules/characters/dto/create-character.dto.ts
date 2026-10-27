import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const createCharacterSchema = z.strictObject({
  game_system_id: z.uuid(),
  sheet_schema_id: z.uuid(),
  name: z.string().trim().min(1).max(255),
});

export class CreateCharacterDto {
  @ApiProperty({ format: 'uuid' })
  game_system_id: string;

  @ApiProperty({ format: 'uuid' })
  sheet_schema_id: string;

  @ApiProperty({ minLength: 1, maxLength: 255 })
  name: string;
}
