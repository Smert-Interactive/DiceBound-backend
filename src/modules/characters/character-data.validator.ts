import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  ValidationException,
  type CharacterValidationIssue,
} from '../../common/exceptions/validation.exception.js';
import {
  calculateFields,
  CalculatedFieldError,
} from '../../common/formulas/calculate-fields.js';
import type { SheetDefinition } from '../game-systems/validation/sheet-schema.schema.js';

type CharacterValue =
  string | number | boolean | { current: number; max: number };
export type CharacterData = Record<string, CharacterValue>;
const resourceSchema = z.strictObject({ current: z.number(), max: z.number() });

@Injectable()
export class CharacterDataValidator {
  initialData(schema: SheetDefinition): CharacterData {
    const data: CharacterData = {};
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (field.type === 'text') data[field.id] = '';
        if (field.type === 'checkbox') data[field.id] = false;
      }
    }
    return this.calculate(schema, data, true);
  }

  validate(
    schema: SheetDefinition,
    input: Record<string, unknown>,
  ): CharacterData {
    const fields = schema.sections.flatMap((section) => section.fields);
    const known = new Set(fields.map((field) => field.id));
    const errors: CharacterValidationIssue[] = [];
    const data: CharacterData = {};
    const issue = (id: string, message: string) => {
      errors.push({ field: `data.${id}`, message });
    };
    for (const id of Object.keys(input)) {
      if (!known.has(id)) issue(id, 'Unknown field');
    }
    for (const field of fields) {
      const present = Object.hasOwn(input, field.id);
      if (field.type === 'calculated') {
        if (present) issue(field.id, 'Calculated fields cannot be supplied');
        continue;
      }
      if (!present) {
        if (field.required) issue(field.id, 'Required field');
        continue;
      }
      const value = input[field.id];
      switch (field.type) {
        case 'text':
          if (typeof value !== 'string') issue(field.id, 'Must be a string');
          else {
            if (field.required && value.trim().length === 0)
              issue(field.id, 'Required field');
            if (field.maxLength !== undefined && value.length > field.maxLength)
              issue(
                field.id,
                `Must contain at most ${field.maxLength} characters`,
              );
            data[field.id] = value;
          }
          break;
        case 'number':
          if (typeof value !== 'number' || !Number.isFinite(value))
            issue(field.id, 'Must be a finite number');
          else {
            if (field.min !== undefined && value < field.min)
              issue(field.id, `Must be greater than or equal to ${field.min}`);
            if (field.max !== undefined && value > field.max)
              issue(field.id, `Must be less than or equal to ${field.max}`);
            data[field.id] = value;
          }
          break;
        case 'select':
          if (
            typeof value !== 'string' ||
            !field.options.some((o) => o.value === value)
          )
            issue(field.id, 'Must be one of the available options');
          else data[field.id] = value;
          break;
        case 'checkbox':
          if (typeof value !== 'boolean') issue(field.id, 'Must be a boolean');
          else data[field.id] = value;
          break;
        case 'resource': {
          const parsed = resourceSchema.safeParse(value);
          if (!parsed.success) {
            issue(field.id, 'Must contain only finite numbers current and max');
          } else {
            const resource = parsed.data;
            if (resource.current > resource.max)
              issue(field.id, 'current must be less than or equal to max');
            if (field.min !== undefined && resource.current < field.min)
              issue(
                field.id,
                `current must be greater than or equal to ${field.min}`,
              );
            data[field.id] = resource;
          }
          break;
        }
      }
    }
    if (errors.length)
      throw new ValidationException(
        errors.slice(0, 50),
        'Invalid character data',
      );
    return this.calculate(schema, data);
  }

  private calculate(
    schema: SheetDefinition,
    data: CharacterData,
    allowMissing = false,
  ): CharacterData {
    try {
      return calculateFields(schema, data, { allowMissing });
    } catch (error) {
      if (!(error instanceof CalculatedFieldError)) throw error;
      throw new ValidationException(
        [{ field: `data.${error.fieldId}`, message: error.message }],
        'Invalid character data',
      );
    }
  }
}
