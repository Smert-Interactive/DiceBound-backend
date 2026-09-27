# Логирование backend

Для логирования в DiceBound Backend используется встроенный `Logger` NestJS.

## Использование Logger

Пример для NestJS-сервиса:

```ts
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ExampleService {
  private readonly logger = new Logger(ExampleService.name);

  doSomething(): void {
    this.logger.log('Операция успешно выполнена');
  }
}
```

В качестве контекста логгера следует используется имя класса:

```ts
new Logger(ExampleService.name);
```

Это позволяет определить источник сообщения в логах.

## Уровни логирования

Основные уровни:

- `log` — штатные значимые события;
- `warn` — потенциальная проблема, при которой приложение может продолжать работу;
- `error` — ошибка выполнения операции;
- `debug` — информация для диагностики и разработки;
- `verbose` — подробная диагностическая информация.

## Логирование ошибок

При обработке исключений следует сохранять полезный контекст ошибки.

Пример:

```ts
try {
  await this.performOperation();
} catch (error) {
  this.logger.error(
    'Не удалось выполнить операцию',
    error instanceof Error ? error.stack : undefined,
  );

  throw error;
}
```

Если исключение не обрабатывается на уровне конкретного сервиса, его обработка и логирование могут выполняться глобальным exception filter.

## Общие правила

Логи должны описывать событие, а не внутренние детали реализации.

Предпочтительно:

```ts
this.logger.warn(`Character ${characterId} was not found`);
```

Вместо:

```ts
this.logger.warn('Something went wrong');
```

Сообщение должно позволять понять:

- что произошло;
- в каком компоненте;
- с каким объектом или операцией это связано.

При этом лог не должен раскрывать секреты или чувствительные данные.