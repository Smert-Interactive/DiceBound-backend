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

## Подключение PostgreSQL

`DATABASE_URL` обязателен для запуска приложения, миграций и seed:

```dotenv
DATABASE_URL="postgresql://dicebound:change_me@localhost:5432/dicebound"
```

CLI Prisma читает его через `prisma.config.ts`, приложение — через
ConfigService, seed — из того же окружения. `.env` загружается автоматически.
Проверка Prisma-схемы, генерация клиента и `test:seed` не требуют подключения
к PostgreSQL.
Старые PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD не заменяют DATABASE_URL.
[Миграции, seed и переход существующей БД](database.md).

## Источники запросов и сессии

`ALLOWED_ORIGINS` — список точных HTTP(S) origin через запятую, без пути
и завершающего `/`. Используется одновременно для CORS с credentials
и CSRF-проверки изменяющих запросов, включая публичные login/register.
В production переменная обязательна; в development/test по умолчанию разрешены
`http://localhost:3000` и `http://localhost:5173`.
`*`, пустые значения и `null` не принимаются.

```dotenv
ALLOWED_ORIGINS=https://app.example.com,https://api.example.com
```

Для production нужен HTTPS: сессионная cookie получает Secure.
SameSite=Lax предполагает размещение frontend/backend в пределах одного сайта;
разные порты localhost работают с credentials и разрешённым Origin.
CLI-запросы тоже должны передавать разрешённый Origin на POST/PUT/PATCH/DELETE.

TTL сессии зафиксирован в коде на 7 дней; очистка просроченных строк — раз в час.
Проверка истечения действует на каждом защищённом запросе независимо от очистки.
Rate limiter хранит состояние в процессе; несколько реплик требуют общего хранилища.
