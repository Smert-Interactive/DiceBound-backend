import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { SESSION_COOKIE } from './modules/auth/session.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();
  configureApp(app);

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const port = config.getOrThrow<number>('PORT');
  const environment = config.getOrThrow<string>('NODE_ENV');

  // Swagger is available only in development.
  if (environment === 'development') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('DiceBound API')
      .setDescription('REST API for the DiceBound tabletop RPG platform')
      .setVersion('0.1.0')
      .addCookieAuth(
        SESSION_COOKIE,
        { type: 'apiKey', in: 'cookie' },
        SESSION_COOKIE,
      )
      .addServer(`http://localhost:${port}`, 'Local development')
      .build();

    const documentFactory = () =>
      SwaggerModule.createDocument(app, swaggerConfig);

    SwaggerModule.setup('docs', app, documentFactory);

    logger.log(`Swagger UI: http://localhost:${port}/docs`);
  }

  await app.listen(port);

  logger.log(
    `DiceBound API started on port ${port} in ${environment} environment`,
  );
}
await bootstrap();
