import 'reflect-metadata';

process.env.NODE_ENV = 'test';
process.env.PORT = '3000';

process.env.DATABASE_URL =
  'postgresql://test:test@127.0.0.1:1/dicebound_test';
