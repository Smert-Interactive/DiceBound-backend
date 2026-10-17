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
├── schema.prisma    # Схема базы данных
└── migrations/      # Миграции PostgreSQL
```

Бизнес-логика размещается в `src/modules/`. Работа с PostgreSQL осуществляется через Prisma ORM. Конфигурация приложения загружается из environment variables и валидируется через Zod.

## Локальный запуск

### Требования

- Node.js 24
- npm
- PostgreSQL (не обязательно)

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

База данных и пользователь PostgreSQL должны быть созданы заранее. Значения в примере необходимо заменить локальными.

### 3. Подготовка Prisma

```bash
npm run db:generate
```

Для применения существующих миграций:

```bash
npm run db:migrate:deploy
```

До появления первых миграций этот шаг можно пропустить.

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
| `npm run db:studio` | Интерфейс Prisma Studio |

## Документация

- [Конфигурация приложения](docs/configuration.md)
- [Логирование](docs/logging.md)