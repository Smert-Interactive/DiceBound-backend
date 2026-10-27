import type { SheetDefinition } from '../../modules/game-systems/validation/sheet-schema.schema.js';
import {
  evaluateFormula,
  FormulaError,
  parseFormula,
} from './formula-parser.js';

export class CalculatedFieldError extends FormulaError {
  constructor(
    readonly fieldId: string,
    message: string,
  ) {
    super(message);
  }
}

/** Calculate a complete derived state without mutating the caller's input. */
export function calculateFields<T>(
  schema: SheetDefinition,
  inputData: Readonly<Record<string, T>>,
  options: { allowMissing?: boolean } = {},
): Record<string, T | number> {
  const fields = new Map(
    schema.sections.flatMap((section) =>
      section.fields.map((field) => [field.id, field] as const),
    ),
  );
  const formulas = new Map<string, ReturnType<typeof parseFormula>>();
  const pending = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const [id, field] of fields) {
    if (field.type !== 'calculated') continue;
    try {
      const formula = parseFormula(field.formula);
      formulas.set(id, formula);
      let count = 0;
      for (const reference of formula.dependencies) {
        const target = fields.get(reference);
        if (!target) throw new FormulaError(`Unknown field '${reference}'`);
        if (target.type !== 'number' && target.type !== 'calculated')
          throw new FormulaError(`Field '${reference}' is not numeric`);
        if (target.type === 'calculated') {
          count++;
          const users = dependents.get(reference) ?? [];
          users.push(id);
          dependents.set(reference, users);
        }
      }
      pending.set(id, count);
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      throw new CalculatedFieldError(id, error.message);
    }
  }
  // Kahn's algorithm handles long chains without recursion.
  const order = [...pending].filter(([, n]) => n === 0).map(([id]) => id);
  for (let index = 0; index < order.length; index++) {
    for (const id of dependents.get(order[index]) ?? []) {
      const count = pending.get(id)! - 1;
      pending.set(id, count);
      if (count === 0) order.push(id);
    }
  }
  if (order.length !== formulas.size) {
    const id = [...pending].find(([, n]) => n > 0)![0];
    throw new CalculatedFieldError(
      id,
      'Calculated field has a cyclic dependency',
    );
  }

  const data: Record<string, T | number> = { ...inputData };
  // Never reuse calculated values supplied by the caller.
  for (const id of formulas.keys()) delete data[id];
  for (const id of order) {
    const formula = formulas.get(id)!;
    if (
      options.allowMissing &&
      [...formula.dependencies].some(
        (reference) => !Object.hasOwn(data, reference),
      )
    )
      continue;
    try {
      data[id] = evaluateFormula(formula.ast, data);
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      throw new CalculatedFieldError(id, error.message);
    }
  }
  return data;
}
