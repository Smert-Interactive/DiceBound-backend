# Конфигурация backend

Конфигурация DiceBound Backend передаётся через environment variables и загружается через `@nestjs/config`.

Переменные окружения валидируются при запуске приложения. Если обязательный параметр отсутствует или имеет некорректное значение, backend не должен запускаться.

## Локальная конфигурация

Локальные значения хранятся в файле:

```text
.env
```

`.env` содержит локальные настройки и потенциально может содержать секреты, поэтому он не должен попадать в Git.

Для создания локальной конфигурации используется `.env.example`:

```bash
cp .env.example .env
```

## Использование конфигурации


```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ExampleService {
  constructor(private readonly config: ConfigService) {}

  getValue(): string {
    return this.config.getOrThrow<string>('EXAMPLE_VALUE');
  }
}
```

Это позволяет использовать единый механизм конфигурации приложения и централизованно контролировать обязательные параметры.

## Добавление новой переменной окружения

При добавлении новой environment variable необходимо:

1. добавить её в схему валидации;
2. добавить её в `.env.example`;
3. использовать её через `ConfigService`.

Пример схемы:

```ts
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535),
});
```
