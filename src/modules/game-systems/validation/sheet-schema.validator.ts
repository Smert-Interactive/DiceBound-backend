import { Injectable } from '@nestjs/common';
import type { ValidationIssue } from '../../../common/exceptions/validation.exception.js';
import { compileFormulaGraph } from '../../../common/formulas/compile-formula-graph.js';
import { MAX_SCHEMA_BYTES, sheetSchema } from './sheet-schema.schema.js';
import type { SheetDefinition } from './sheet-schema.schema.js';

export type SchemaValidationIssue = ValidationIssue;
export type SchemaValidationResult =
  | {
      valid: true;
      errors: [];
      summary: { sections_count: number; fields_count: number };
      schema: SheetDefinition;
    }
  | {
      valid: false;
      errors: SchemaValidationIssue[];
      summary: null;
      schema: null;
    };

function pathOf(path: PropertyKey[]): string {
  return (
    path.reduce<string>(
      (result, part) =>
        typeof part === 'number'
          ? `${result}[${part}]`
          : `${result}${result ? '.' : ''}${String(part)}`,
      '',
    ) || 'schema'
  );
}
function invalid(errors: SchemaValidationIssue[]): SchemaValidationResult {
  return {
    valid: false,
    errors: errors.slice(0, 50),
    summary: null,
    schema: null,
  };
}

@Injectable()
export class SheetSchemaValidator {
  validate(text: string): SchemaValidationResult {
    if (Buffer.byteLength(text, 'utf8') > MAX_SCHEMA_BYTES) {
      return invalid([
        {
          path: 'schema_text',
          message: `Schema text exceeds ${MAX_SCHEMA_BYTES} bytes`,
          line: null,
        },
      ]);
    }
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch (error) {
      let line: number | null = null;
      const position =
        error instanceof SyntaxError
          ? /\bat position (\d+)/.exec(error.message)
          : null;
      if (position) {
        const offset = Number(position[1]);
        if (offset <= text.length)
          line = text.slice(0, offset).split('\n').length;
      }
      return invalid([
        { path: 'schema_text', message: 'Invalid JSON syntax', line },
      ]);
    }
    const parsed = sheetSchema.safeParse(input);
    if (!parsed.success) {
      return invalid(
        parsed.error.issues.map((issue) => ({
          path: pathOf(issue.path),
          message:
            issue.code === 'invalid_union' && issue.path.at(-1) === 'type'
              ? 'Unsupported field type'
              : issue.message,
          line: null,
        })),
      );
    }
    const schema = parsed.data;
    const graph = compileFormulaGraph(schema);
    if (!graph.valid) {
      return invalid(
        graph.errors.map(({ path, message }) => ({
          path,
          message,
          line: null,
        })),
      );
    }
    return {
      valid: true,
      errors: [],
      summary: {
        sections_count: schema.sections.length,
        fields_count: schema.sections.reduce(
          (count, section) => count + section.fields.length,
          0,
        ),
      },
      schema,
    };
  }
}
