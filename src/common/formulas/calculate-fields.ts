import type { SheetDefinition } from '../../modules/game-systems/validation/sheet-schema.schema.js';
import { evaluateFormula, FormulaError } from './formula-parser.js';
import { compileFormulaGraph } from './compile-formula-graph.js';

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
  const graph = compileFormulaGraph(schema);
  if (!graph.valid) {
    const error = graph.errors[0];
    throw new CalculatedFieldError(error.fieldId, error.message);
  }

  const data: Record<string, T | number> = { ...inputData };
  // Never reuse calculated values supplied by the caller.
  for (const { fieldId } of graph.plan) delete data[fieldId];
  for (const formula of graph.plan) {
    if (
      options.allowMissing &&
      formula.dependencies.some((reference) => !Object.hasOwn(data, reference))
    )
      continue;
    try {
      data[formula.fieldId] = evaluateFormula(formula.ast, data);
    } catch (error) {
      if (!(error instanceof FormulaError)) throw error;
      throw new CalculatedFieldError(formula.fieldId, error.message);
    }
  }
  return data;
}
