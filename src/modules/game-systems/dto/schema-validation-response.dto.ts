import { ApiProperty } from '@nestjs/swagger';
import { GameSystemResponseDto } from './game-system-response.dto.js';
import { SheetSchemaResponseDto } from './sheet-schema-response.dto.js';
import type { SheetDefinition } from '../validation/sheet-schema.schema.js';

export class SchemaValidationIssueDto {
  @ApiProperty({ example: 'sections[0].fields[1].formula' })
  path: string;
  @ApiProperty()
  message: string;
  @ApiProperty({ type: 'integer', nullable: true, minimum: 1 })
  line: number | null;
}

export class SchemaSummaryDto {
  @ApiProperty({ type: 'integer', minimum: 0 })
  sections_count: number;
  @ApiProperty({ type: 'integer', minimum: 0 })
  fields_count: number;
}

export class SchemaValidationResponseDto {
  @ApiProperty()
  valid: boolean;
  @ApiProperty({ type: SchemaValidationIssueDto, isArray: true })
  errors: SchemaValidationIssueDto[];
  @ApiProperty({ type: SchemaSummaryDto, nullable: true })
  summary: SchemaSummaryDto | null;
  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description: 'Validated sheet definition or null on failure',
  })
  schema: SheetDefinition | null;
}

export class ImportedSystemResponseDto {
  @ApiProperty({ type: GameSystemResponseDto })
  system: GameSystemResponseDto;
  @ApiProperty({ type: SheetSchemaResponseDto })
  sheet_schema: SheetSchemaResponseDto;
}

export class SchemaImportErrorResponseDto {
  @ApiProperty({ example: 422 })
  statusCode: number;
  @ApiProperty({ format: 'date-time' })
  timestamp: string;
  @ApiProperty()
  path: string;
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code: string;
  @ApiProperty({ example: 'Invalid sheet schema' })
  message: string;
  @ApiProperty({ type: SchemaValidationIssueDto, isArray: true })
  details: SchemaValidationIssueDto[];
}
