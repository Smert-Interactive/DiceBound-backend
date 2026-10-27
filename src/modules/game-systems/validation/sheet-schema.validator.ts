import { Injectable } from '@nestjs/common';
import type { ValidationIssue } from '../../../common/exceptions/validation.exception.js';
import {
  FormulaError,
  parseFormula,
} from '../../../common/formulas/formula-parser.js';
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
    const fields = new Map(
      schema.sections.flatMap((section, si) =>
        section.fields.map(
          (field, fi) =>
            [
              field.id,
              { field, path: `sections[${si}].fields[${fi}].formula` },
            ] as const,
        ),
      ),
    );
    const errors: SchemaValidationIssue[] = [];
    const dependencies = new Map<string, Set<string>>();
    for (const [id, { field, path }] of fields) {
      if (field.type !== 'calculated') continue;
      try {
        const formula = parseFormula(field.formula);
        const calculated = new Set<string>();
        for (const reference of formula.dependencies) {
          const target = fields.get(reference)?.field;
          if (!target)
            errors.push({
              path,
              message: `Unknown field '${reference}'`,
              line: null,
            });
          else if (target.type !== 'number' && target.type !== 'calculated')
            errors.push({
              path,
              message: `Field '${reference}' is not numeric`,
              line: null,
            });
          if (target?.type === 'calculated') calculated.add(reference);
        }
        dependencies.set(id, calculated);
      } catch (error) {
        if (!(error instanceof FormulaError)) throw error;
        errors.push({ path, message: error.message, line: null });
      }
    }
    // Kahn's algorithm avoids recursion for long dependency chains.
    const pending = new Map(
      [...dependencies].map(([id, refs]) => [id, refs.size]),
    );
    const dependents = new Map<string, string[]>();
    for (const [id, refs] of dependencies) {
      for (const ref of refs) {
        const users = dependents.get(ref) ?? [];
        users.push(id);
        dependents.set(ref, users);
      }
    }
    const queue = [...pending]
      .filter(([, count]) => count === 0)
      .map(([id]) => id);
    for (let index = 0; index < queue.length; index++) {
      for (const id of dependents.get(queue[index]) ?? []) {
        const count = pending.get(id)! - 1;
        pending.set(id, count);
        if (count === 0) queue.push(id);
      }
    }
    // Do not report spurious cycles when a dependency already has a syntax error.
    if (errors.length === 0) {
      for (const [id, count] of pending) {
        if (count > 0)
          errors.push({
            path: fields.get(id)!.path,
            message: 'Calculated field has a cyclic dependency',
            line: null,
          });
      }
    }
    if (errors.length) return invalid(errors);
    return {
      valid: true,
      errors: [],
      summary: {
        sections_count: schema.sections.length,
        fields_count: fields.size,
      },
      schema,
    };
  }
}
