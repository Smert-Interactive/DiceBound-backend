import { ApiProperty } from '@nestjs/swagger';
import type { Prisma } from '../../../generated/prisma/client.js';

export const sheetSchemaSummarySelect = {
  id: true,
  gameSystemId: true,
  name: true,
  createdAt: true,
} satisfies Prisma.SheetSchemaSelect;

export const sheetSchemaSelect = {
  ...sheetSchemaSummarySelect,
  schema: true,
} satisfies Prisma.SheetSchemaSelect;

type SheetSchemaSummary = Prisma.SheetSchemaGetPayload<{
  select: typeof sheetSchemaSummarySelect;
}>;
type SheetSchema = Prisma.SheetSchemaGetPayload<{
  select: typeof sheetSchemaSelect;
}>;

export class SheetSchemaSummaryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  game_system_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ format: 'date-time' })
  created_at: string;
}

export class SheetSchemaResponseDto extends SheetSchemaSummaryResponseDto {
  @ApiProperty({
    type: 'object',
    required: ['sections'],
    properties: {
      sections: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
    },
    description:
      'Published JSON sheet definition; sections contain fields for the Dynamic Sheet Renderer',
    example: {
      sections: [
        {
          id: 'core',
          label: 'Core',
          fields: [{ id: 'name', type: 'text', label: 'Name' }],
        },
      ],
    },
  })
  schema: Prisma.JsonValue;
}

export function toSheetSchemaSummaryResponse(sheet: SheetSchemaSummary) {
  return {
    id: sheet.id,
    game_system_id: sheet.gameSystemId,
    name: sheet.name,
    created_at: sheet.createdAt.toISOString(),
  };
}

export function toSheetSchemaResponse(
  sheet: SheetSchema,
): SheetSchemaResponseDto {
  return { ...toSheetSchemaSummaryResponse(sheet), schema: sheet.schema };
}
