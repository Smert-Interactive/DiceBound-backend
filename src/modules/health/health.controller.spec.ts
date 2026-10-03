import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  const controller = new HealthController();

  describe('getHealth', () => {
    it('should return health status', () => {
      expect(controller.getHealth()).toEqual({
        status: 'ok',
      });
    });
  });
});