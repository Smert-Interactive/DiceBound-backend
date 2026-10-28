import type { SheetDefinition } from '../../modules/game-systems/validation/sheet-schema.schema.js';
import {
  FormulaError,
  parseFormula,
  type FormulaNode,
} from './formula-parser.js';

export type CompiledFormula = {
  readonly fieldId: string;
  readonly ast: FormulaNode;
  readonly dependencies: readonly string[];
};

export type FormulaGraphIssue = {
  fieldId: string;
  path: string;
  message: string;
};

export type FormulaGraphResult =
  | { valid: true; plan: readonly CompiledFormula[]; errors: [] }
  | { valid: false; plan: null; errors: FormulaGraphIssue[] };

/** Compile a structurally validated schema for both import and character calculation. */
export function compileFormulaGraph(
  schema: SheetDefinition,
): FormulaGraphResult {
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
  const formulas = new Map<string, CompiledFormula>();
  const pending = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const errors: FormulaGraphIssue[] = [];
  const issue = (fieldId: string, message: string) => {
    errors.push({ fieldId, path: fields.get(fieldId)!.path, message });
  };

  for (const [id, { field }] of fields) {
    if (field.type !== 'calculated') continue;
    try {
      const formula = parseFormula(field.formula);
      formulas.set(id, {
        fieldId: id,
        ast: formula.ast,
        dependencies: [...formula.dependencies],
      });
      let count = 0;
      for (const reference of formula.dependencies) {
        const target = fields.get(reference)?.field;
        if (!target) issue(id, `Unknown field '${reference}'`);
        else if (target.type !== 'number' && target.type !== 'calculated')
          issue(id, `Field '${reference}' is not numeric`);
        if (target?.type === 'calculated') {
          count++;
          const users = dependents.get(reference) ?? [];
          users.push(id);
          dependents.set(reference, users);
        }
      }
      pending.set(id, count);
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      issue(id, error.message);
    }
  }
  // A failed dependency must not produce misleading cycle errors in its users.
  if (errors.length) return { valid: false, plan: null, errors };

  // Kahn's algorithm handles long chains without recursive graph traversal.
  const order = [...pending]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  for (let index = 0; index < order.length; index++) {
    for (const id of dependents.get(order[index]) ?? []) {
      const count = pending.get(id)! - 1;
      pending.set(id, count);
      if (count === 0) order.push(id);
    }
  }
  for (const [id, count] of pending) {
    if (count > 0) issue(id, 'Calculated field has a cyclic dependency');
  }
  if (errors.length) return { valid: false, plan: null, errors };
  return {
    valid: true,
    plan: order.map((id) => formulas.get(id)!),
    errors: [],
  };
}
