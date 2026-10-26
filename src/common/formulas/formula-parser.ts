/** A small arithmetic grammar shared with the future Formula Engine. No JavaScript execution. */
export type FormulaFunction = 'floor' | 'ceil' | 'round' | 'min' | 'max';
export type FormulaNode =
  | { kind: 'number'; value: number }
  | { kind: 'field'; id: string }
  | { kind: 'unary'; operator: '+' | '-'; operand: FormulaNode }
  | {
      kind: 'binary';
      operator: '+' | '-' | '*' | '/';
      left: FormulaNode;
      right: FormulaNode;
    }
  | { kind: 'call'; name: FormulaFunction; args: FormulaNode[] };

export class FormulaError extends Error {}

const functions = new Set<string>(['floor', 'ceil', 'round', 'min', 'max']);
const MAX_TOKENS = 512;
const MAX_DEPTH = 64;
export const MAX_FORMULA_LENGTH = 2048;

type Token = {
  kind: 'number' | 'identifier' | 'symbol' | 'end';
  value: string;
};

function tokenize(text: string): Token[] {
  if (text.length > MAX_FORMULA_LENGTH)
    throw new FormulaError('Formula is too long');
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < text.length) {
    const rest = text.slice(offset);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      offset += whitespace[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    let token: Token;
    if (number) token = { kind: 'number', value: number[0] };
    else if (identifier) token = { kind: 'identifier', value: identifier[0] };
    else if ('+-*/(),'.includes(rest[0]))
      token = { kind: 'symbol', value: rest[0] };
    else
      throw new FormulaError(
        `Unsupported formula syntax at position ${offset + 1}`,
      );
    tokens.push(token);
    if (tokens.length > MAX_TOKENS)
      throw new FormulaError('Formula is too complex');
    offset += token.value.length;
  }
  tokens.push({ kind: 'end', value: '' });
  return tokens;
}

class Parser {
  private position = 0;
  readonly dependencies = new Set<string>();
  constructor(private readonly tokens: Token[]) {}

  private current(): Token {
    return this.tokens[this.position];
  }
  private take(value: string): boolean {
    if (this.current().kind === 'symbol' && this.current().value === value) {
      this.position++;
      return true;
    }
    return false;
  }
  private expect(value: string): void {
    if (!this.take(value))
      throw new FormulaError(`Expected '${value}' in formula`);
  }

  parse(): FormulaNode {
    const node = this.expression(0);
    if (this.current().kind !== 'end')
      throw new FormulaError('Unexpected token in formula');
    return node;
  }

  private expression(depth: number): FormulaNode {
    let node = this.product(depth);
    while (this.current().value === '+' || this.current().value === '-') {
      const operator = this.current().value as '+' | '-';
      this.position++;
      node = {
        kind: 'binary',
        operator,
        left: node,
        right: this.product(depth),
      };
    }
    return node;
  }

  private product(depth: number): FormulaNode {
    let node = this.primary(depth);
    while (this.current().value === '*' || this.current().value === '/') {
      const operator = this.current().value as '*' | '/';
      this.position++;
      node = {
        kind: 'binary',
        operator,
        left: node,
        right: this.primary(depth),
      };
    }
    return node;
  }

  private primary(depth: number): FormulaNode {
    if (depth > MAX_DEPTH)
      throw new FormulaError('Formula nesting is too deep');
    if (this.take('+'))
      return { kind: 'unary', operator: '+', operand: this.primary(depth + 1) };
    if (this.take('-'))
      return { kind: 'unary', operator: '-', operand: this.primary(depth + 1) };
    if (this.take('(')) {
      const node = this.expression(depth + 1);
      this.expect(')');
      return node;
    }
    const token = this.current();
    if (token.kind === 'number') {
      this.position++;
      const value = Number(token.value);
      if (!Number.isFinite(value))
        throw new FormulaError('Formula numbers must be finite');
      return { kind: 'number', value };
    }
    if (token.kind === 'identifier') {
      this.position++;
      if (!this.take('(')) {
        this.dependencies.add(token.value);
        return { kind: 'field', id: token.value };
      }
      if (!functions.has(token.value))
        throw new FormulaError(`Unsupported function '${token.value}'`);
      const args: FormulaNode[] = [];
      if (!this.take(')')) {
        do {
          args.push(this.expression(depth + 1));
        } while (this.take(','));
        this.expect(')');
      }
      const name = token.value as FormulaFunction;
      if (
        ['floor', 'ceil', 'round'].includes(name)
          ? args.length !== 1
          : args.length === 0
      ) {
        throw new FormulaError(`Invalid argument count for '${name}'`);
      }
      return { kind: 'call', name, args };
    }
    throw new FormulaError('Expected a number, field or function in formula');
  }
}

function finite(value: number): number {
  if (!Number.isFinite(value))
    throw new FormulaError('Formula result must be finite');
  return value;
}

/** Evaluates only the typed AST. Missing values may be skipped for static validation. */
function evaluate(
  node: FormulaNode,
  field: (id: string) => number | undefined,
): number | undefined {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'field':
      return field(node.id);
    case 'unary': {
      const value = evaluate(node.operand, field);
      return value === undefined
        ? undefined
        : node.operator === '-'
          ? -value
          : value;
    }
    case 'binary': {
      const left = evaluate(node.left, field);
      const right = evaluate(node.right, field);
      if (node.operator === '/' && right === 0)
        throw new FormulaError('Division by zero');
      if (left === undefined || right === undefined) return undefined;
      switch (node.operator) {
        case '+':
          return finite(left + right);
        case '-':
          return finite(left - right);
        case '*':
          return finite(left * right);
        case '/':
          return finite(left / right);
      }
      break;
    }
    case 'call': {
      const args = node.args.map((arg) => evaluate(arg, field));
      if (args.some((arg) => arg === undefined)) return undefined;
      const values = args as number[];
      switch (node.name) {
        case 'floor':
          return Math.floor(values[0]);
        case 'ceil':
          return Math.ceil(values[0]);
        case 'round':
          return Math.round(values[0]);
        case 'min':
          return Math.min(...values);
        case 'max':
          return Math.max(...values);
      }
    }
  }
  throw new FormulaError('Invalid formula expression');
}

export function parseFormula(text: string): {
  ast: FormulaNode;
  dependencies: Set<string>;
} {
  const parser = new Parser(tokenize(text));
  const ast = parser.parse();
  // Reject provably invalid constant subexpressions, including x / (2 - 2).
  evaluate(ast, () => undefined);
  return { ast, dependencies: parser.dependencies };
}

export function evaluateFormula(
  ast: FormulaNode,
  values: Readonly<Record<string, unknown>>,
): number {
  const result = evaluate(ast, (id) => {
    const value = Object.hasOwn(values, id) ? values[id] : undefined;
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new FormulaError(`Field '${id}' must be a finite number`);
    return value;
  });
  if (result === undefined) throw new FormulaError('Missing formula value');
  return finite(result);
}
