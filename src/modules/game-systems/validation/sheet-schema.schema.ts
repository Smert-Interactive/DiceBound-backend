import { z } from 'zod';
import { MAX_FORMULA_LENGTH } from '../../../common/formulas/formula-parser.js';

export const MAX_SCHEMA_BYTES = 64 * 1024;
export const MAX_FIELDS = 1024;
const nonempty = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value.trim().length > 0, 'Must not be blank');
const identifier = z
  .string()
  .min(1)
  .max(128)
  .refine(
    (value) => value.trim() === value,
    'IDs must not have surrounding whitespace',
  )
  .refine(
    (value) => !['__proto__', 'prototype', 'constructor'].includes(value),
    'Reserved field identifier',
  );
const base = {
  id: identifier,
  label: nonempty,
  required: z.boolean().optional(),
};

const fieldSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...base,
    type: z.literal('text'),
    maxLength: z.number().int().positive().optional(),
  }),
  z
    .strictObject({
      ...base,
      type: z.literal('number'),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .refine(
      (field) =>
        field.min === undefined ||
        field.max === undefined ||
        field.min <= field.max,
      { path: ['max'], message: 'max must be greater than or equal to min' },
    ),
  z
    .strictObject({
      ...base,
      type: z.literal('select'),
      options: z
        .array(z.strictObject({ value: nonempty, label: nonempty }))
        .min(1)
        .max(1024),
    })
    .superRefine((field, context) => {
      const values = new Set<string>();
      field.options.forEach((option, index) => {
        if (values.has(option.value))
          context.addIssue({
            code: 'custom',
            path: ['options', index, 'value'],
            message: 'Duplicate option value',
          });
        values.add(option.value);
      });
    }),
  z.strictObject({ ...base, type: z.literal('checkbox') }),
  z.strictObject({
    ...base,
    type: z.literal('resource'),
    min: z.number().optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('calculated'),
    formula: z.string().min(1).max(MAX_FORMULA_LENGTH),
  }),
]);

export const sheetSchema = z
  .strictObject({
    sections: z
      .array(
        z.strictObject({
          id: identifier,
          label: nonempty,
          fields: z.array(fieldSchema).max(256),
        }),
      )
      .max(64),
  })
  .superRefine((schema, context) => {
    const sectionIds = new Set<string>();
    const fieldIds = new Set<string>();
    let total = 0;
    schema.sections.forEach((section, sectionIndex) => {
      if (sectionIds.has(section.id))
        context.addIssue({
          code: 'custom',
          path: ['sections', sectionIndex, 'id'],
          message: 'Duplicate section ID',
        });
      sectionIds.add(section.id);
      section.fields.forEach((field, fieldIndex) => {
        total++;
        if (fieldIds.has(field.id))
          context.addIssue({
            code: 'custom',
            path: ['sections', sectionIndex, 'fields', fieldIndex, 'id'],
            message: 'Duplicate field ID across the schema',
          });
        fieldIds.add(field.id);
      });
    });
    if (total > MAX_FIELDS)
      context.addIssue({
        code: 'custom',
        path: ['sections'],
        message: `Schema must not exceed ${MAX_FIELDS} fields`,
      });
  });

export type SheetDefinition = z.infer<typeof sheetSchema>;
