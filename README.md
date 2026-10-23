# DiceBound-backend

Backend платформы **DiceBound**, построенный на NestJS, TypeScript, Prisma ORM и PostgreSQL.

## Структура проекта

```text
src/
├── common/          # Общая инфраструктура и обработка ошибок
├── config/          # Конфигурация и валидация окружения
├── database/        # PrismaService и PrismaModule
├── generated/       # Сгенерированный Prisma Client
├── modules/         # Бизнес-модули
├── app.module.ts    # Корневой модуль NestJS
└── main.ts          # Точка входа

prisma/
├── schema.prisma    # Модели Prisma Client
├── migrations/      # SQL-миграции Prisma Migrate
├── seed.mjs         # Запуск seed через Prisma CLI
└── seeds/           # Две встроенные системы и схемы листов
```

Бизнес-логика размещается в `src/modules/`. Работа с PostgreSQL осуществляется через Prisma ORM. Конфигурация приложения загружается из environment variables и валидируется через Zod.

## Локальный запуск

### Требования

- Node.js 24
- npm
- Доступная PostgreSQL (для запуска backend)

### 1. Установка зависимостей

```bash
npm ci
```

### 2. Конфигурация окружения

```bash
cp .env.example .env
```

Указать в `.env` параметры подключения к PostgreSQL:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL="postgresql://dicebound:change_me@localhost:5432/dicebound"
```

База данных и пользователь PostgreSQL должны быть предоставлены заранее. Значения в примере необходимо заменить своими.
Для CLI, seed и приложения используется один `DATABASE_URL`.

### 3. Подготовка Prisma

```bash
npm run db:generate
```

Для применения миграций к БД без таблиц DiceBound:

```bash
npm run db:migrate:deploy
npm run db:seed
```

**Если таблицы уже созданы старым SQL-runner, сначала выполните сверку и baseline
по [инструкции перехода](docs/database.md#переход-существующей-серверной-бд-baseline).**
Повторно создавать таблицы или сбрасывать серверную БД не нужно.
Seed и генерация Prisma Client в Prisma 7 запускаются явно.

### 4. Запуск backend

```bash
npm run start:dev
```

API будет доступен по адресу `http://localhost:3000`.

### 5. Проверка работоспособности

```bash
curl http://localhost:3000/health
```

Ожидаемый ответ:

```json
{
  "status": "ok"
}
```

Endpoint проверяет работоспособность API. Подключение к PostgreSQL проверяется отдельно при запуске приложения.

## Полезные команды

| Команда | Назначение |
|---|---|
| `npm run start:dev` | Запуск в режиме разработки |
| `npm run build` | Сборка приложения |
| `npm run start:prod` | Запуск production-сборки |
| `npm run lint` | Проверка линтером |
| `npm test` | Unit-тесты |
| `npm run test:e2e` | E2E-тесты |
| `npm run db:generate` | Генерация Prisma Client |
| `npm run db:migrate:dev` | Создание и применение миграций |
| `npm run db:migrate:deploy` | Применение готовых миграций |
| `npm run db:migrate:status` | Состояние истории миграций |
| `npm run db:seed` | Встроенные системы и схемы листов |
| `npm run test:seed` | Проверка seed без БД |
| `npm run test:db` | Интеграционные проверки во временных схемах существующей БД |
| `npm run db:studio` | Интерфейс Prisma Studio |

## Документация

- [База данных, миграции, seed и переход существующей БД](docs/database.md)
- [Конфигурация приложения](docs/configuration.md)
- [Логирование](docs/logging.md)
