import { UnprocessableEntityException } from '@nestjs/common';

export interface ValidationIssue {
  path: string;
  message: string;
  line: number | null;
}

export interface CharacterValidationIssue {
  field: string;
  message: string;
}

/** Only explicitly constructed validation errors may expose details to the client. */
export class ValidationException extends UnprocessableEntityException {
  constructor(
    readonly details: (ValidationIssue | CharacterValidationIssue)[],
    message = 'Invalid sheet schema',
  ) {
    super(message);
  }
}
