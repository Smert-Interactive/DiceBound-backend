import { describe, expect, it } from 'vitest';
import {
  evaluateFormula,
  FormulaError,
  parseFormula,
} from './formula-parser.js';

describe('Safe arithmetic formula grammar', () => {
  it.each([
    ['floor((strength - 10) / 2)', { strength: 16 }, 3],
    ['1 + 2 * 3', {}, 7],
    ['(1 + 2) * 3', {}, 9],
    ['10 - 3 - 2', {}, 5],
    ['20 / 2 / 5', {}, 2],
    ['-strength + +2', { strength: 4 }, -2],
    ['min(ceil(1.2), round(2.5), max(1, 8))', {}, 2],
    ['.5 + 1e2 + 2E-1', {}, 100.7],
    [' max( -1, -2 ) ', {}, -1],
    ['min + floor(2.8)', { min: 1 }, 3],
  ] as const)(
    'evaluates %s with arithmetic precedence',
    (formula, values, expected) => {
      expect(evaluateFormula(parseFormula(formula).ast, values)).toBeCloseTo(
        expected,
      );
    },
  );

  it('collects unique field dependencies separately from function names', () => {
    expect(
      [...parseFormula('max(energy, bonus) + energy').dependencies].sort(),
    ).toEqual(['bonus', 'energy']);
  });

  it.each([
    '',
    ' ',
    '1 +',
    '(1 + 2',
    '1 2',
    '()',
    'floor()',
    'floor(1,2)',
    'min()',
    'max()',
    'min(1,)',
    'sin(1)',
    'Math.floor(1)',
    'energy.current',
    'data[0]',
    '1 ** 2',
    '1 % 2',
    '2; process.exit()',
    'new Function("return 1")()',
    'constructor.constructor(1)',
    'x = 2',
    '1 ? 2 : 3',
    '1 // 2',
    '1e999',
    '1 / 0',
    'x / (2 - 2)',
    '1e308 * 10',
  ])('rejects invalid/unsafe formula %j', (formula) => {
    expect(() => parseFormula(formula)).toThrow(FormulaError);
  });

  it('leaves data-dependent division for runtime validation', () => {
    const { ast } = parseFormula('10 / energy');
    expect(evaluateFormula(ast, { energy: 2 })).toBe(5);
    expect(() => evaluateFormula(ast, { energy: 0 })).toThrow(
      'Division by zero',
    );
  });

  it.each([{}, { energy: '2' }, { energy: Infinity }, { energy: NaN }])(
    'rejects missing or nonnumeric values',
    (values) => {
      expect(() =>
        evaluateFormula(parseFormula('energy + 1').ast, values),
      ).toThrow(FormulaError);
    },
  );

  it('does not resolve fields through the object prototype', () => {
    expect(() => evaluateFormula(parseFormula('toString').ast, {})).toThrow(
      FormulaError,
    );
  });

  it.each([
    '('.repeat(66) + '1' + ')'.repeat(66),
    '1+'.repeat(300) + '1',
    'x'.repeat(2049),
  ])('bounds formula complexity and recursion', (formula) => {
    expect(() => parseFormula(formula)).toThrow(FormulaError);
  });
});
