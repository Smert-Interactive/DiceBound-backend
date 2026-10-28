import {
  ConflictException,
  HttpException,
  type ArgumentsHost,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

describe('AllExceptionsFilter codes', () => {
  it.each([
    [new ConflictException('Conflict'), 409, 'CONFLICT', 'Conflict'],
    [
      new ConflictException({
        code: 'RESTORE_NOT_ALLOWED',
        message: 'Cannot restore',
      }),
      409,
      'RESTORE_NOT_ALLOWED',
      'Cannot restore',
    ],
    [
      new ConflictException({ code: 42, message: 'Conflict' }),
      409,
      'CONFLICT',
      'Conflict',
    ],
    [
      new ConflictException({ code: '', message: 'Conflict' }),
      409,
      'CONFLICT',
      'Conflict',
    ],
    [
      new HttpException(
        { code: 'PRIVATE_CODE', message: 'Private details' },
        500,
      ),
      500,
      'INTERNAL_ERROR',
      'Internal server error',
    ],
  ])(
    'formats %s without changing fallback or server error codes',
    (exception, status, code, message) => {
      const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const host = {
        switchToHttp: () => ({
          getRequest: () => ({ method: 'POST', url: '/test' }),
          getResponse: () => response,
        }),
      } as unknown as ArgumentsHost;
      new AllExceptionsFilter().catch(exception, host);
      expect(response.status).toHaveBeenCalledWith(status);
      expect(response.json).toHaveBeenCalledWith({
        statusCode: status,
        timestamp: expect.any(String),
        path: '/test',
        code,
        message,
      });
    },
  );
});
