import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SheetSchemaValidator } from '../validation/sheet-schema.validator.js';

const validator = new SheetSchemaValidator();
const number = {
  id: 'energy',
  type: 'number',
  label: 'Energy',
  min: 0,
  max: 100,
};
const calculated = (id: string, formula: string) => ({
  id,
  type: 'calculated',
  label: id,
  formula,
});
const definition = (fields: unknown[]) => ({
  sections: [{ id: 'core', label: 'Core', fields }],
});
const validate = (input: unknown) => validator.validate(JSON.stringify(input));

describe('Sheet schema import validation', () => {
  it('accepts both published seeds and preserves their definitions', async () => {
    const seeds = JSON.parse(
      await readFile(
        new URL(
          '../../../../prisma/seeds/builtin-systems.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { sheet: { schema: unknown } }[];
    for (const seed of seeds) {
      const result = validate(seed.sheet.schema);
      expect(result.valid).toBe(true);
      expect(result.schema).toEqual(seed.sheet.schema);
    }
  });

  it('accepts a third system with all six types and returns counts', async () => {
    const text = await readFile(
      new URL(
        '../../../../test/fixtures/third-game-system.json',
        import.meta.url,
      ),
      'utf8',
    );
    expect(validator.validate(text)).toMatchObject({
      valid: true,
      errors: [],
      summary: { sections_count: 1, fields_count: 6 },
    });
  });

  it('accepts an empty schema as specified in the API contract', () => {
    expect(validate({ sections: [] })).toEqual({
      valid: true,
      errors: [],
      schema: { sections: [] },
      summary: { sections_count: 0, fields_count: 0 },
    });
  });

  it.each(['{', '', '{"sections": [\n  INVALID\n]}'])(
    'reports JSON syntax failure without throwing or exposing internals',
    (text) => {
      const result = validator.validate(text);
      expect(result).toMatchObject({
        valid: false,
        schema: null,
        summary: null,
        errors: [{ path: 'schema_text', message: 'Invalid JSON syntax' }],
      });
    },
  );

  it('reports the source line only when the JSON parser provides a position', () => {
    const result = validator.validate('{"sections": [\n {"id" "core"}\n]}');
    expect(result.errors[0].line).toBe(2);
  });

  it.each([
    null,
    [],
    {},
    { sections: {} },
    { sections: [], unrelated: true },
    definition([{ ...number, type: 'script' }]),
    definition([{ ...number, min: 10, max: 1 }]),
    definition([{ ...number, min: '0' }]),
    definition([{ ...number, options: [] }]),
    definition([{ ...number, id: '' }]),
    definition([{ ...number, id: '  ' }]),
    definition([{ ...number, id: '__proto__' }]),
    definition([{ ...number, label: ' ' }]),
    definition([{ ...number, required: 'yes' }]),
    definition([{ id: 'name', type: 'text', label: 'Name', maxLength: 0 }]),
    definition([{ id: 'name', type: 'text', label: 'Name', maxLength: 1.5 }]),
    definition([{ id: 'role', type: 'select', label: 'Role', options: [] }]),
    definition([
      {
        id: 'role',
        type: 'select',
        label: 'Role',
        options: [
          { value: 'x', label: 'X' },
          { value: 'x', label: 'Duplicate' },
        ],
      },
    ]),
    definition([
      {
        id: 'role',
        type: 'select',
        label: 'Role',
        options: [{ value: 1, label: 'X' }],
      },
    ]),
    definition([{ id: 'alive', type: 'checkbox', label: 'Alive', min: 0 }]),
    definition([{ id: 'hp', type: 'resource', label: 'HP', max: 100 }]),
    definition([calculated('bonus', '')]),
  ])('rejects invalid shape/parameters %#', (input) => {
    const result = validate(input);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.summary).toBeNull();
    expect(result.schema).toBeNull();
  });

  it('rejects duplicate field IDs across different sections with an exact path', () => {
    const result = validate({
      sections: [
        { id: 'first', label: 'First', fields: [number] },
        { id: 'second', label: 'Second', fields: [number] },
      ],
    });
    expect(result.errors).toContainEqual({
      path: 'sections[1].fields[0].id',
      message: 'Duplicate field ID across the schema',
      line: null,
    });
  });

  it('rejects duplicate section IDs', () => {
    const result = validate({
      sections: [
        { id: 'core', label: 'One', fields: [] },
        { id: 'core', label: 'Two', fields: [] },
      ],
    });
    expect(result.errors[0].path).toBe('sections[1].id');
  });

  it.each(
    [
      [calculated('bonus', 'missing + 1')],
      [
        { id: 'name', type: 'text', label: 'Name' },
        calculated('bonus', 'name + 1'),
      ],
      [
        { id: 'hp', type: 'resource', label: 'HP' },
        calculated('bonus', 'hp + 1'),
      ],
      [calculated('bonus', 'bonus + 1')],
      [calculated('a', 'b + 1'), calculated('b', 'a + 1')],
      [calculated('a', 'floor(1, 2)')],
      [calculated('a', '1 / 0')],
    ].map((fields) => ({ fields })),
  )('rejects invalid formula semantics %#', ({ fields }) => {
    const result = validate(definition(fields));
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toMatch(/\.formula$/);
  });

  it('allows forward calculated dependencies without treating them as cycles', () => {
    expect(
      validate(
        definition([
          calculated('a', 'b + 1'),
          calculated('b', 'energy / 2'),
          number,
        ]),
      ).valid,
    ).toBe(true);
  });

  it('defers runtime division by a field value to the Formula Engine', () => {
    expect(
      validate(definition([number, calculated('a', '10 / energy')])).valid,
    ).toBe(true);
  });

  it('rejects nonfinite JSON numbers and overly large UTF-8 text', () => {
    expect(
      validator.validate(
        '{"sections":[{"id":"x","label":"x","fields":[{"id":"n","type":"number","label":"N","max":1e999}]}]}',
      ).valid,
    ).toBe(false);
    expect(validator.validate('я'.repeat(40_000)).valid).toBe(false);
  });
  it('bounds section, per-section field and total field counts independently', () => {
    const sections = Array.from({ length: 65 }, (_, index) => ({
      id: `s_${index}`,
      label: 'S',
      fields: [],
    }));
    expect(validate({ sections }).valid).toBe(false);
    const fields = Array.from({ length: 257 }, (_, index) => ({
      id: `f_${index}`,
      type: 'checkbox',
      label: 'F',
    }));
    expect(validate(definition(fields)).valid).toBe(false);
    const many = Array.from({ length: 5 }, (_, section) => ({
      id: `s_${section}`,
      label: 'S',
      fields: Array.from({ length: 205 }, (_, field) => ({
        id: `f_${section}_${field}`,
        type: 'checkbox',
        label: 'F',
      })),
    }));
    const result = validate({ sections: many });
    expect(result.errors).toContainEqual({
      path: 'sections',
      message: 'Schema must not exceed 1024 fields',
      line: null,
    });
  });

  it('caps detailed error output to 50 entries', () => {
    const sections = Array.from({ length: 60 }, () => ({
      id: 'duplicate',
      label: 'S',
      fields: [],
    }));
    const result = validate({ sections });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(50);
  });
});
