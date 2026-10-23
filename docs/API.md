### API / OpenAPI

Backend использует Swagger (OpenAPI) для автоматической генерации документации HTTP API.

Документация доступна при `NODE_ENV=development`.

Для локального просмотра запустите backend:

```bash
npm run start:dev
```

При `PORT=3000` доступны следующие адреса:

| Назначение | URL |
|---|---|
| Base URL API | `http://localhost:3000` |
| Swagger UI | `http://localhost:3000/docs` |
| OpenAPI JSON | `http://localhost:3000/docs-json` |

Все API-ответы, описанные в OpenAPI, используют формат JSON. Структура ответа зависит от конкретного endpoint.

#### GET /health

Проверяет доступность HTTP API. Не выполняет проверку подключения к PostgreSQL.

**Метод:** `GET`  
**Путь:** `/health`  
**Авторизация:** не требуется  
**Успешный статус:** `200 OK`  
**Content-Type:** `application/json`

Ответ:

```json
{
  "status": "ok"
}
```

Для проверки из терминала:

```bash
curl -i http://localhost:3000/health
```

Swagger UI и OpenAPI JSON доступны только в development-окружении.

Новые endpoint'ы документируются через декораторы `@nestjs/swagger` в соответствующих контроллерах.