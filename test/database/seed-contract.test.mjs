import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSeed } from '../../prisma/seed.mjs';

const systems = await readSeed();
const types = new Set([
  'text',
  'number',
  'select',
  'checkbox',
  'resource',
  'calculated',
]);
const allowedProperties = {
  text: ['maxLength'],
  number: ['min', 'max'],
  select: ['options'],
  checkbox: [],
  resource: ['min'],
  calculated: ['formula'],
};
const fieldsOf = (system) =>
  system.sheet.schema.sections.flatMap((section) => section.fields);
const systemWithCode = (code) => systems.find((system) => system.code === code);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const nonempty = (value) =>
  assert.ok(typeof value === 'string' && value.trim().length > 0);

await test('seed defines exactly two built-in systems with distinct stable identities', () => {
  assert.equal(systems.length, 2);
  assert.deepEqual(systems.map((system) => system.code).sort(), [
    'call-of-cthulhu-mvp',
    'dnd-5e-mvp',
  ]);
  assert.equal(new Set(systems.map((system) => system.id)).size, 2);
  assert.equal(new Set(systems.map((system) => system.sheet.id)).size, 2);
  for (const system of systems) {
    assert.match(system.id, uuid);
    assert.match(system.sheet.id, uuid);
    nonempty(system.name);
    nonempty(system.description);
    nonempty(system.sheet.name);
  }
});

for (const system of systems) {
  await test(`${system.code}: schema follows the agreed renderer field contract`, () => {
    assert.deepEqual(Object.keys(system.sheet.schema), ['sections']);
    assert.ok(
      Array.isArray(system.sheet.schema.sections) &&
        system.sheet.schema.sections.length > 0,
    );
    const sectionIds = new Set();
    const fields = new Map();
    for (const section of system.sheet.schema.sections) {
      assert.deepEqual(Object.keys(section).sort(), ['fields', 'id', 'label']);
      nonempty(section.id);
      nonempty(section.label);
      assert.ok(
        !sectionIds.has(section.id),
        `Duplicate section ID: ${section.id}`,
      );
      sectionIds.add(section.id);
      assert.ok(Array.isArray(section.fields) && section.fields.length > 0);
      for (const field of section.fields) {
        nonempty(field.id);
        nonempty(field.label);
        assert.ok(types.has(field.type), `Unsupported type: ${field.type}`);
        assert.ok(!fields.has(field.id), `Duplicate field ID: ${field.id}`);
        fields.set(field.id, field);
        const allowed = new Set([
          'id',
          'type',
          'label',
          'required',
          ...allowedProperties[field.type],
        ]);
        for (const property of Object.keys(field)) {
          assert.ok(
            allowed.has(property),
            `Unsupported property ${property} for ${field.type}`,
          );
        }
        if (field.required !== undefined)
          assert.equal(typeof field.required, 'boolean');
        if (field.maxLength !== undefined)
          assert.ok(Number.isInteger(field.maxLength) && field.maxLength > 0);
        for (const bound of ['min', 'max']) {
          if (field[bound] !== undefined)
            assert.ok(Number.isFinite(field[bound]));
        }
        if (field.min !== undefined && field.max !== undefined)
          assert.ok(field.min <= field.max);
        if (field.type === 'select') {
          assert.ok(Array.isArray(field.options) && field.options.length > 0);
          const values = new Set();
          for (const option of field.options) {
            assert.deepEqual(Object.keys(option).sort(), ['label', 'value']);
            nonempty(option.value);
            nonempty(option.label);
            assert.ok(!values.has(option.value));
            values.add(option.value);
          }
        }
      }
    }
    for (const field of fields.values()) {
      if (field.type !== 'calculated') continue;
      nonempty(field.formula);
      assert.match(field.formula, /^[a-zA-Z0-9_+\-*/().,\s]+$/);
      for (const symbol of field.formula.match(/[a-z_][a-z_0-9]*/g) ?? []) {
        if (['floor', 'ceil', 'round', 'min', 'max'].includes(symbol)) continue;
        assert.ok(fields.has(symbol), `Unknown formula field: ${symbol}`);
        assert.equal(fields.get(symbol).type, 'number');
        assert.notEqual(symbol, field.id);
      }
    }
  });
}

await test('D&D covers the agreed MVP fields, ranges and ability modifiers', () => {
  const fields = new Map(
    fieldsOf(systemWithCode('dnd-5e-mvp')).map((field) => [field.id, field]),
  );
  assert.equal(fields.get('name').type, 'text');
  assert.equal(fields.get('name').required, true);
  assert.equal(fields.get('level').min, 1);
  assert.equal(fields.get('level').max, 20);
  assert.equal(fields.get('class').type, 'select');
  assert.equal(fields.get('hit_points').type, 'resource');
  assert.equal(fields.get('armor_class').type, 'number');
  for (const ability of [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ]) {
    assert.equal(fields.get(ability).type, 'number');
    assert.equal(fields.get(ability).min, 1);
    assert.equal(fields.get(ability).max, 30);
    assert.equal(fields.get(`${ability}_modifier`).type, 'calculated');
    assert.equal(
      fields.get(`${ability}_modifier`).formula,
      `floor((${ability} - 10) / 2)`,
    );
  }
});

await test('CoC covers investigators, eight characteristics, resources and MVP skills', () => {
  const fields = new Map(
    fieldsOf(systemWithCode('call-of-cthulhu-mvp')).map((field) => [
      field.id,
      field,
    ]),
  );
  assert.equal(fields.get('name').required, true);
  assert.equal(fields.get('occupation').type, 'text');
  assert.equal(fields.get('age').type, 'number');
  for (const characteristic of [
    'strength',
    'constitution',
    'dexterity',
    'intelligence',
    'size',
    'power',
    'appearance',
    'education',
  ]) {
    assert.equal(fields.get(characteristic).type, 'number');
    assert.equal(fields.get(characteristic).min, 1);
    assert.equal(fields.get(characteristic).max, 99);
  }
  for (const resource of ['hit_points', 'sanity', 'luck'])
    assert.equal(fields.get(resource).type, 'resource');
  for (const skill of ['spot_hidden', 'library_use', 'listen'])
    assert.equal(fields.get(skill).type, 'number');
  const dnd = systemWithCode('dnd-5e-mvp');
  const coc = systemWithCode('call-of-cthulhu-mvp');
  assert.notDeepEqual(
    dnd.sheet.schema.sections.map((section) => section.id),
    coc.sheet.schema.sections.map((section) => section.id),
  );
  assert.deepEqual(
    new Set(systems.flatMap(fieldsOf).map((field) => field.type)),
    types,
  );
});
