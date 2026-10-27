import { UnprocessableEntityException } from '@nestjs/common';

export interface ValidationIssue {
  path: string;
  message: string;
  line: number | null;
}

/** Only explicitly constructed validation errors may expose details to the client. */
export class ValidationException extends UnprocessableEntityException {
  constructor(readonly details: ValidationIssue[]) {
    super('Invalid sheet schema');
  }
}
