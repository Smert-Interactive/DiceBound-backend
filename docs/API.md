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

## Игровые системы и схемы листов

Все методы требуют действующую сессию. POST и DELETE также требуют Origin
из `ALLOWED_ORIGINS`. Ответы GET и POST используют `Cache-Control: private, no-store`.

| Метод | Путь | Успех |
|---|---|---|
| GET | `/api/v1/systems` | 200 + GameSystemSummary[] |
| GET | `/api/v1/systems/:id` | 200 + GameSystemSummary |
| GET | `/api/v1/systems/:id/schemas` | 200 + SheetSchemaSummary[] |
| GET | `/api/v1/schemas/:id` | 200 + SheetSchema |
| POST | `/api/v1/systems/import/validate` | 200 + SchemaValidationResult |
| POST | `/api/v1/systems/import` | 201 + ImportedSystemResult |
| DELETE | `/api/v1/systems/:id` | 204 без тела |

### Чтение и права доступа

Список содержит активные встроенные D&D 5e / Call of Cthulhu и собственные
импортированные системы. Данные читаются из PostgreSQL, поэтому для встроенных
систем нужно предварительно выполнить `npm run db:seed`.
Порядок списка: source, created_at, id; порядок схем: created_at, id.
Пагинация в MVP не используется.

GameSystemSummary:

```json
{
  "id": "10000000-0000-4000-8000-000000000001",
  "owner_id": null,
  "name": "D&D 5e (simplified)",
  "description": "Simplified DiceBound MVP sheet; not a complete rules implementation.",
  "source": "BUILT_IN",
  "character_count": 0,
  "created_at": "2026-10-10T12:00:00.000Z"
}
```

`source` принимает `BUILT_IN` или `IMPORTED`. В БД остаётся значение `BUILTIN`.
`character_count` включает всех персонажей данной системы, независимо от их
владельца, в том числе независимые EDIT-копии.

SheetSchemaSummary содержит `id`, `game_system_id`, `name`, `created_at`.
Полная SheetSchema дополнительно содержит `schema` как JSON-объект с `sections`
и `fields`, без повторной сериализации в строку.
Для доступной системы без схем возвращается `[]`; для недоступной системы — 404.

Полную схему можно читать, если система доступна для выбора **или** по этой
конкретной схеме есть персонаж, принадлежащий пользователю либо доступный ему
по VIEW. Второе условие сохраняет чтение схемы после архивирования системы.
Старая EDIT-запись сама по себе не даёт доступа: право появляется через
независимую копию, владельцем которой стал получатель.
Доступ к одной схеме не раскрывает остальные схемы чужой системы.

### Проверка JSON

Запрос:

```json
{"schema_text":"{\"sections\":[]}"}
```

Корректная схема:

```json
{
  "valid": true,
  "errors": [],
  "summary": {"sections_count": 0, "fields_count": 0},
  "schema": {"sections": []}
}
```

Некорректный JSON или схема возвращают **200**, а не 422:

```json
{
  "valid": false,
  "errors": [{"path":"sections[0].fields[1].type","message":"Unsupported field type","line":null}],
  "summary": null,
  "schema": null
}
```

`line` — номер строки с единицы, только если JSON-парсер сообщил точную позицию
синтаксической ошибки. Для структурных и семантических ошибок возвращается null.
Проверка JSON не создаёт систему или схему в БД.

### Импорт

Запрос:

```json
{
  "system_name": "My RPG",
  "sheet_schema_name": "My sheet",
  "schema_text": "{\"sections\":[{\"id\":\"core\",\"label\":\"Core\",\"fields\":[{\"id\":\"energy\",\"type\":\"number\",\"label\":\"Energy\",\"min\":0,\"max\":100},{\"id\":\"bonus\",\"type\":\"calculated\",\"label\":\"Bonus\",\"formula\":\"floor(energy / 10)\"}]}]}"
}
```

Названия обрезаются по краям и должны содержать от 1 до 255 символов.
Владелец берётся из сессии, source задаётся сервером. Дополнительные поля
запроса, включая owner_id/source, отклоняются с 400.

Ответ: `{"system": GameSystemSummary, "sheet_schema": SheetSchema}`.
GameSystem и SheetSchema создаются одной транзакцией; отказ второй записи
откатывает первую. Повторный импорт создаёт новые идентификаторы даже при
совпадающих названиях.

Невалидная схема при импорте возвращает **422 VALIDATION_ERROR**:

```json
{
  "statusCode": 422,
  "timestamp": "2026-10-26T12:00:00.000Z",
  "path": "/api/v1/systems/import",
  "code": "VALIDATION_ERROR",
  "message": "Invalid sheet schema",
  "details": [{"path":"sections[0].fields[1].formula","message":"Unknown field 'missing'","line":null}]
}
```

`details` добавляется только к явно созданной ошибке валидации схемы.
Внутренние ошибки Prisma/PostgreSQL не передаются клиенту.

### Правила SheetSchema

Объекты схемы, секций, полей и select-вариантов проверяются строго:
неизвестные свойства отклоняются. Секция содержит `id`, `label`, `fields`;
поле — `id`, `type`, `label` и необязательный boolean `required`.
`section.id` уникален по схеме, `field.id` уникален среди всех её секций.

| Тип | Допустимые дополнительные свойства |
|---|---|
| text | maxLength: положительное целое |
| number | min/max: конечные числа, min ≤ max |
| select | непустые options[] с уникальными строковыми value и непустыми label |
| checkbox | нет |
| resource | min: конечное число; current/max находятся в Character.data |
| calculated | непустая formula |

Пустые `sections` и `fields` допустимы. ID: 1–128 символов, без пробелов по краям;
`__proto__`, `prototype`, `constructor` зарезервированы.
Подписи и значения select — непустые строки до 255 символов.

Формулы поддерживают `+`, `-`, `*`, `/`, унарные знаки, скобки и функции
`floor`, `ceil`, `round` (один аргумент), `min`, `max` (один или более).
Имена полей в формулах имеют вид `[A-Za-z_][A-Za-z0-9_]*`.
Ссылки разрешены только на number/calculated; неизвестные ссылки, циклы,
постоянное деление на ноль, неограниченные числа, доступ к свойствам,
вызовы других функций и JavaScript отклоняются.
Деление на ноль при конкретных данных персонажа проверяется при вычислении.

Ограничения обработки: schema_text — до 64 KiB UTF-8; максимум 64 секции,
256 полей в секции, 1024 поля в схеме, 1024 select-варианта у поля.
Формула — до 2048 символов, 512 токенов и 64 уровней вложенности.
В ответе возвращается максимум 50 ошибок.
Некорректный HTTP-объект или превышение размера schema_text даёт 400;
превышение общего лимита HTTP-тела может быть отклонено сервером с 413.

### Архивирование системы

DELETE доступен только владельцу активной импортированной системы.
Он устанавливает `deleted_at` и возвращает 204. Система исчезает из выбора,
но GameSystem, SheetSchema, Character, CharacterVersion и копии сохраняются.

- Встроенная система: 403 FORBIDDEN.
- Чужая, отсутствующая или уже архивированная система: 404 NOT_FOUND.
- Неверный UUID: 400 BAD_REQUEST.
- Нет сессии: 401 UNAUTHORIZED.
- Нет разрешённого Origin: 403 FORBIDDEN.

Новые персонажи требуют активную доступную систему. Доступ к существующему
персонажу определяется его владельцем/VIEW, а не активностью исходной системы.
Связи и история сохраняются; опубликованную схему менять нельзя.

### Примеры curl

После login с сохранением cookie в `/tmp/dicebound-cookies.txt`:

```bash
curl -b /tmp/dicebound-cookies.txt http://localhost:3000/api/v1/systems
curl -b /tmp/dicebound-cookies.txt \
  http://localhost:3000/api/v1/systems/10000000-0000-4000-8000-000000000001/schemas
curl -b /tmp/dicebound-cookies.txt \
  http://localhost:3000/api/v1/schemas/20000000-0000-4000-8000-000000000001
```

Тела POST формируются как JSON с текстом схемы внутри `schema_text`.
Файл `test/fixtures/third-game-system.json` содержит пример третьей НРИ,
используемый интеграционными тестами без ветвления по идентификатору системы.

Проверка с PostgreSQL: `npm run test:systems:db`. Нужен DATABASE_URL и права
на создание/удаление временной схемы. Рабочие таблицы тест не изменяет.
Модуль Characters #17 и полная интеграция Formula Engine #18 остаются отдельными
задачами: сценарий создания/сохранения персонажа пока проверяется на границе
Prisma/PostgreSQL, а не через отсутствующие HTTP endpoint Characters.
