import { describe, expect, it } from 'vitest';
import { ValidationException } from '../../common/exceptions/validation.exception.js';
import {
  characterDefinition,
  validCharacterData,
} from '../../../test/helpers/character.fixture.js';
import { CharacterDataValidator } from './character-data.validator.js';

const validator = new CharacterDataValidator();
describe('CharacterDataValidator', () => {
  it('creates a draft without fabricating constrained numbers, selects or resources', () => {
    expect(validator.initialData(characterDefinition)).toEqual({
      name: '',
      note: '',
      inspiration: false,
      constant: 2,
    });
  });
  it('validates every input type and computes dependent fields in dependency order', () => {
    const input = structuredClone(validCharacterData);
    expect(validator.validate(characterDefinition, input)).toEqual({
      ...input,
      constant: 2,
      strength_modifier: 3,
      final_score: 5,
    });
    expect(input).toEqual(validCharacterData);
  });
  it('accepts zero and false for required fields', () => {
    expect(
      validator.validate(characterDefinition, {
        ...validCharacterData,
        strength: 0,
        hit_points: { current: 0, max: 0 },
      }),
    ).toMatchObject({ strength: 0, inspiration: false, strength_modifier: -5 });
  });
  it.each([
    ['name', undefined],
    ['name', null],
    ['name', 12],
    ['name', ''],
    ['name', '   '],
    ['name', 'x'.repeat(101)],
    ['strength', undefined],
    ['strength', null],
    ['strength', '16'],
    ['strength', false],
    ['strength', NaN],
    ['strength', Infinity],
    ['strength', -1],
    ['strength', 31],
    ['inspiration', undefined],
    ['inspiration', null],
    ['inspiration', 0],
    ['inspiration', 'false'],
    ['role', undefined],
    ['role', null],
    ['role', 'thief'],
    ['role', 1],
    ['hit_points', undefined],
    ['hit_points', null],
    ['hit_points', []],
    ['hit_points', { current: 1 }],
    ['hit_points', { current: 13, max: 12 }],
    ['hit_points', { current: -1, max: 12 }],
    ['hit_points', { current: '8', max: 12 }],
    ['hit_points', { current: 0, max: Infinity }],
    ['hit_points', { current: 0, max: 12, extra: true }],
    ['note', 'abcdef'],
    ['note', null],
    ['secret_power', 42],
    ['strength_modifier', 3],
    ['constant', 2],
    ['final_score', 5],
    ['__proto__', 1],
    ['constructor', 1],
  ])('rejects invalid %s (%j) with safe field details', (id, value) => {
    const input: Record<string, unknown> = { ...validCharacterData };
    if (value === undefined) delete input[id];
    else Object.defineProperty(input, id, { value, enumerable: true });
    try {
      validator.validate(characterDefinition, input);
      expect.fail('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException);
      const validation = error as ValidationException;
      expect(validation.message).toBe('Invalid character data');
      expect(validation.details).toContainEqual({
        field: `data.${id}`,
        message: expect.any(String),
      });
    }
  });
  it('removes optional values on replacement and does not require optional fields', () => {
    expect(
      validator.validate(characterDefinition, validCharacterData),
    ).not.toHaveProperty('note');
  });
  it('caps structured errors at 50', () => {
    const input = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`unknown_${i}`, i]),
    );
    try {
      validator.validate(characterDefinition, input);
      expect.fail();
    } catch (error) {
      expect((error as ValidationException).details).toHaveLength(50);
    }
  });
});
