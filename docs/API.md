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
## Авторизация

| Метод | Путь | Результат |
|---|---|---|
| POST | `/api/v1/auth/register` | 201 + User, без сессии |
| POST | `/api/v1/auth/login` | 200 + User, сессионная cookie |
| POST | `/api/v1/auth/logout` | 204, отзыв текущей сессии |
| GET | `/api/v1/auth/me` | 200 + CurrentUser |

Register принимает `email`, `password` (8–1024 символа),
`password_confirmation`. Login принимает `email`, `password` (1–1024 символа).
Email нормализуется, максимум — 254 символа. Username генерируется сервером.
User содержит `id`, `username`, `email`, `created_at`.
CurrentUser дополнительно содержит `owned_characters_count` (включая EDIT-копии)
и `shared_characters_count` (только VIEW).

Cookie: `dicebound_session`, HttpOnly, SameSite=Lax, Path=/api/v1,
Secure в production; TTL — 7 дней без автоматического продления.
Logout и me требуют действующую сессию. Повторный login с текущей cookie
отзывает прежний токен этого браузера.

Для всех изменяющих запросов, включая register/login/logout, обязателен
разрешённый `Origin`. Отсутствующий или чужой Origin возвращает 403.
Браузерный frontend должен использовать `credentials: 'include'`.

Пример регистрации:

```bash
curl -i http://localhost:3000/api/v1/auth/register \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"email":"player@example.com","password":"safe-password-123","password_confirmation":"safe-password-123"}'
```

Пример входа и проверки сессии:

```bash
curl -i -c /tmp/dicebound-cookies.txt http://localhost:3000/api/v1/auth/login \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"email":"player@example.com","password":"safe-password-123"}'
curl -i -b /tmp/dicebound-cookies.txt http://localhost:3000/api/v1/auth/me
curl -i -X POST -b /tmp/dicebound-cookies.txt -c /tmp/dicebound-cookies.txt \
  -H 'Origin: http://localhost:5173' http://localhost:3000/api/v1/auth/logout
```

Ошибки содержат `statusCode`, `timestamp`, `path`, `code`, `message` (строка):
400 BAD_REQUEST, 401 UNAUTHORIZED, 403 FORBIDDEN, 409 CONFLICT,
429 TOO_MANY_REQUESTS, 500 INTERNAL_ERROR.
Для неверного email и пароля сообщение одинаковое: `Invalid email or password`.
Лимит на IP: login — 10 запросов/минуту, register — 5; при превышении есть Retry-After.

[Пошаговое объяснение реализации и альтернатив](auth-implementation.md).
