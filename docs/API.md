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

`details` добавляется только к явно созданной ошибке валидации схемы или данных персонажа.
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

Пустые `sections` и `fields` допустимы. ID: 1–128 символов, без пробелов по краям.
Все `field.id` должны соответствовать `[A-Za-z_][A-Za-z0-9_]*`, чтобы ссылки
в формулах читались однозначно. Дефисы, пробелы, точки и другие символы
в ID полей отклоняются при валидации. Это ограничение не распространяется
на `section.id`: секции не используются как переменные формул.
`__proto__`, `prototype`, `constructor` зарезервированы.
Подписи и значения select — непустые строки до 255 символов.

Формулы поддерживают `+`, `-`, `*`, `/`, унарные знаки, скобки и функции
`floor`, `ceil`, `round` (один аргумент), `min`, `max` (один или более).
Имена полей в формулах имеют вид `[A-Za-z_][A-Za-z0-9_]*`.
Ссылки разрешены только на number/calculated; неизвестные ссылки, циклы,
постоянное деление на ноль, неограниченные числа, доступ к свойствам,
вызовы других функций и JavaScript отклоняются.
Деление на ноль при конкретных данных персонажа проверяется при вычислении.

Числа и результаты используют JavaScript `number` (IEEE 754 double precision);
строки и boolean не преобразуются в числа. `NaN`, бесконечность и переполнение
отклоняются. `round` следует `Math.round`: половины округляются к +∞,
поэтому `round(1.5) = 2`, `round(-1.5) = -1`, `round(-0.5) = -0`
(в JSON сохраняется `0`). `floor(-1.5) = -2`, `ceil(-1.5) = -1`.
Доступ к `resource.current` и `resource.max` не поддерживается.

Импорт схем и расчёт Character используют общий `compileFormulaGraph(schema)`:
он проверяет AST и числовые ссылки, затем строит план алгоритмом Кана.
Порядок секций и полей не влияет на зависимости. Например, даже если
`attack_bonus` объявлен раньше `strength_modifier` и `strength`, формулы
`strength_modifier = floor((strength - 10) / 2)` и
`attack_bonus = strength_modifier + 2` дают соответственно `3` и `5`
при `strength = 16`, `-1` и `1` при `strength = 9`.

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
Сценарий третьей НРИ проверяет создание и сохранение персонажа через Characters
HTTP API, включая пересчёт формул после архивирования системы.

## Персонажи

Все маршруты требуют сессию; POST, PUT и DELETE также требуют разрешённый
Origin. UUID проверяется до обращения к персонажу. Отсутствующий и чужой
персонаж одинаково возвращают `404 NOT_FOUND`.

| Метод | Маршрут | Ответ |
|---|---|---|
| GET | `/api/v1/characters` | 200 CharacterList |
| POST | `/api/v1/characters` | 201 Character |
| GET | `/api/v1/characters/:id` | 200 CharacterDetails |
| PUT | `/api/v1/characters/:id` | 200 CharacterDetails |
| DELETE | `/api/v1/characters/:id` | 204 без тела |

### Создание и чтение

```json
{
  "game_system_id": "10000000-0000-4000-8000-000000000001",
  "sheet_schema_id": "20000000-0000-4000-8000-000000000001",
  "name": "Arin"
}
```

Имя обрезается по краям, длина — от 1 до 255 символов. Неизвестные свойства
запроса отклоняются с 400. Схема должна принадлежать выбранной активной системе:
встроенной либо импортированной текущим пользователем. Недоступная или
несовместимая схема возвращает 404.

Создание атомарно записывает Character и полный snapshot v1. Начальные text
равны `""`, checkbox — `false`; number, select и resource отсутствуют.
`min` не используется как значение по умолчанию. Вычисляются константные
формулы и цепочки с доступными зависимостями; остальные calculated отсутствуют
до заполнения листа. Обязательность полей проверяется при PUT.

Character содержит `id`, `owner_id`, `game_system_id`, `sheet_schema_id`,
`name`, `data`, `created_at`, `updated_at`, `current_version_number`.
CharacterDetails дополнительно возвращает `access: "OWNER"`, `can_edit: true`,
`can_view_history: true`, `owner_username`. Полная схема получается отдельно
через `/api/v1/schemas/:id`.

CharacterList имеет форму `{"owned": [], "shared_view": []}`.
В `owned` входят все собственные персонажи и независимые EDIT-копии, включая
персонажей на архивированных системах. Сортировка: updated_at по убыванию,
затем id. CharacterSummary содержит `id`, `name`, `game_system_id`,
`game_system_name`, `updated_at`, `access`, `owner_username`,
`copy_source_owner_name` (имя источника копии либо null).
`shared_view` пока пуст; чтение чужих оригиналов через VIEW подключается на
этапе Sharing. EDIT-запись сама по себе не даёт доступа к оригиналу.

### Полная замена данных и snapshot

```json
{
  "data": {
    "name": "Arin",
    "level": 1,
    "class": "fighter",
    "strength": 16,
    "dexterity": 12,
    "constitution": 14,
    "intelligence": 10,
    "wisdom": 8,
    "charisma": 10,
    "armor_class": 16,
    "inspiration": false,
    "hit_points": {"current": 8, "max": 12}
  }
}
```

PUT принимает полный набор пользовательских полей, без calculated. Пропущенные
необязательные поля удаляются. Неизвестные field.id, calculated во входных
данных и неверные значения возвращают 422; строковые числа и boolean не
преобразуются. `0` и `false` допустимы. Обязательный text не может быть пустым
или состоять из пробелов. text проверяется по maxLength, number — по конечности
и min/max, select — по options, checkbox должен быть boolean. resource — строго
`{current, max}` с конечными числами и `min <= current <= max` при заданном min.

Общая функция `calculateFields` использует существующий безопасный AST-парсер
и определяет порядок по графу зависимостей. Для strength=16 результат
strength_modifier=3. Неизвестные/нечисловые ссылки, циклы, отсутствующие значения,
деление на ноль и бесконечный результат отклоняются. При сохранении отсутствие
даже необязательного number отклоняется, если от него зависит формула.

Сохранение получает блокировку строки `SELECT ... FOR UPDATE` с условием
владельца. После блокировки читается максимальный номер версии, выполняется
валидация и расчёт, затем обновляются Character.data и CharacterVersion с
номером max+1. Всё происходит в одной транзакции READ COMMITTED. Каждое успешное
PUT, включая повтор с идентичными значениями, создаёт ровно один snapshot.
Ошибка валидации, формулы или БД откатывает всё, включая updated_at.

```json
{
  "statusCode": 422,
  "timestamp": "2026-10-27T10:00:00.000Z",
  "path": "/api/v1/characters/44444444-4444-4444-8444-444444444444",
  "code": "VALIDATION_ERROR",
  "message": "Invalid character data",
  "details": [{"field": "data.strength", "message": "Must be less than or equal to 30"}]
}
```

### Удаление и проверка

DELETE применяет условие владельца непосредственно к удалению. PostgreSQL
каскадно удаляет историю и shares. Независимые EDIT-копии сохраняют свои данные,
историю и имя исходного владельца, а source_character_id становится null.
Endpoints истории, restore и управления Sharing в этот модуль не входят.

Интеграционные проверки: `npm run test:characters:db`. Используется DATABASE_URL
из окружения или `.env`; отдельная база и дополнительные переменные не нужны.
Внутри базы создаётся случайная временная схема без `public` в search_path.
Перед запуском проверяется, что Prisma работает именно в этой схеме;
миграции, seed, очистка данных и тестовые ограничения применяются только к ней.
После тестов схема удаляется. Пользователю PostgreSQL нужны права на создание
и удаление собственных схем. CI использует собственную `dicebound_test`.

Проверяются rollback создания и сохранения при реальном отказе PostgreSQL,
восемь одновременных сохранений без пропусков/дубликатов версий, совпадение
snapshot с ответом и Character.data, ownership, каскады и сохранность копий.
