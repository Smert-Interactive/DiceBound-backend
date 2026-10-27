import { describe, expect, it } from 'vitest';
import type { SheetDefinition } from '../../modules/game-systems/validation/sheet-schema.schema.js';
import {
  characterDefinition,
  validCharacterData,
} from '../../../test/helpers/character.fixture.js';
import { calculateFields, CalculatedFieldError } from './calculate-fields.js';

const schemaWith = (
  fields: SheetDefinition['sections'][number]['fields'],
): SheetDefinition => ({ sections: [{ id: 'core', label: 'Core', fields }] });
const numeric = { id: 'x', type: 'number', label: 'X' } as const;
const formula = (id: string, expression: string) => ({
  id,
  type: 'calculated' as const,
  label: id,
  formula: expression,
});

describe('calculateFields', () => {
  it('uses server results instead of stale computed input and preserves the input object', () => {
    const input = {
      ...validCharacterData,
      strength_modifier: 999,
      final_score: 999,
    };
    expect(calculateFields(characterDefinition, input)).toMatchObject({
      strength_modifier: 3,
      final_score: 5,
    });
    expect(input.strength_modifier).toBe(999);
  });
  it('omits unavailable formulas transitively only in draft mode', () => {
    expect(
      calculateFields(characterDefinition, {}, { allowMissing: true }),
    ).toEqual({ constant: 2 });
    expect(() => calculateFields(characterDefinition, {})).toThrow(
      CalculatedFieldError,
    );
  });
  it.each([
    [
      schemaWith([numeric, formula('a', '10 / x')]),
      { x: 0 },
      'Division by zero',
    ],
    [schemaWith([numeric, formula('a', 'x * 1e308')]), { x: 30 }, 'finite'],
    [schemaWith([numeric, formula('a', 'x + 1')]), {}, 'finite number'],
    [schemaWith([numeric, formula('a', 'x + 1')]), { x: '1' }, 'finite number'],
    [schemaWith([formula('a', 'missing + 1')]), {}, 'Unknown field'],
    [
      schemaWith([
        { id: 'x', type: 'text', label: 'X' },
        formula('a', 'x + 1'),
      ]),
      { x: '1' },
      'not numeric',
    ],
    [schemaWith([formula('a', 'a + 1')]), {}, 'cyclic'],
    [schemaWith([formula('a', 'b'), formula('b', 'a')]), {}, 'cyclic'],
    [schemaWith([formula('a', 'eval(1)')]), {}, 'Unsupported function'],
    [schemaWith([formula('a', '1 / 0')]), {}, 'Division by zero'],
  ])(
    'rejects bad graphs or evaluation with the calculated field ID (%#)',
    (schema, data, message) => {
      try {
        calculateFields(schema, data);
        expect.fail();
      } catch (error) {
        expect(error).toBeInstanceOf(CalculatedFieldError);
        expect((error as CalculatedFieldError).fieldId).toBe('a');
        expect((error as Error).message).toContain(message);
      }
    },
  );
  it('rejects invalid graphs even when draft values are missing', () => {
    expect(() =>
      calculateFields(
        schemaWith([formula('a', 'b'), formula('b', 'a')]),
        {},
        { allowMissing: true },
      ),
    ).toThrow('cyclic');
    expect(() =>
      calculateFields(
        schemaWith([formula('a', 'missing')]),
        {},
        { allowMissing: true },
      ),
    ).toThrow('Unknown field');
  });
  it('evaluates a 1000-field dependency chain without recursive graph traversal', () => {
    const fields = [
      formula('f0', '1'),
      ...Array.from({ length: 999 }, (_, i) =>
        formula(`f${i + 1}`, `f${i} + 1`),
      ),
    ].reverse();
    expect(calculateFields(schemaWith(fields), {}).f999).toBe(1000);
  });
});
