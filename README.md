# DiceBound-backend

## Структура backend

Backend построен на NestJS и разделён на инфраструктурный код, конфигурацию и бизнес-модули.

```text
src/
├── common/          # Общая инфраструктура приложения
│   └── filters/     # Глобальные фильтры обработки ошибок
├── config/          # Конфигурация и валидация переменных окружения
├── modules/         # Бизнес-модули приложения
├── app.module.ts    # Корневой модуль NestJS
└── main.ts          # Точка запуска приложения
```

Бизнес-функциональность размещается в `src/modules`.

Например:

```text
src/modules/
├── users/
├── characters/
├── systems/
├── versions/
└── sharing/
```

## Документация

Дополнительные соглашения backend:

- [Конфигурация приложения](docs/configuration.md)
- [Логирование](docs/logging.md)