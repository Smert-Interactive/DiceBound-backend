import type { SheetDefinition } from '../../src/modules/game-systems/validation/sheet-schema.schema.js';

export const characterDefinition: SheetDefinition = {
  sections: [
    {
      id: 'core',
      label: 'Core',
      fields: [
        {
          id: 'name',
          type: 'text',
          label: 'Name',
          required: true,
          maxLength: 100,
        },
        {
          id: 'strength',
          type: 'number',
          label: 'Strength',
          required: true,
          min: 0,
          max: 30,
        },
        {
          id: 'inspiration',
          type: 'checkbox',
          label: 'Inspiration',
          required: true,
        },
        {
          id: 'role',
          type: 'select',
          label: 'Role',
          required: true,
          options: [
            { value: 'fighter', label: 'Fighter' },
            { value: 'wizard', label: 'Wizard' },
          ],
        },
        {
          id: 'hit_points',
          type: 'resource',
          label: 'HP',
          required: true,
          min: 0,
        },
        { id: 'note', type: 'text', label: 'Note', maxLength: 5 },
        {
          id: 'final_score',
          type: 'calculated',
          label: 'Final',
          formula: 'strength_modifier + constant',
        },
        {
          id: 'strength_modifier',
          type: 'calculated',
          label: 'Modifier',
          formula: 'floor((strength - 10) / 2)',
        },
        { id: 'constant', type: 'calculated', label: 'Constant', formula: '2' },
      ],
    },
  ],
};

export const validCharacterData = {
  name: 'Arin',
  strength: 16,
  inspiration: false,
  role: 'fighter',
  hit_points: { current: 8, max: 12 },
};
