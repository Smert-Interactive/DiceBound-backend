import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { GameSystemsController } from './game-systems.controller.js';
import { SchemasController } from './schemas.controller.js';
import { GameSystemsService } from './game-systems.service.js';
import { SheetSchemaValidator } from './validation/sheet-schema.validator.js';

@Module({
  imports: [PrismaModule],
  controllers: [GameSystemsController, SchemasController],
  providers: [GameSystemsService, SheetSchemaValidator],
  exports: [GameSystemsService],
})
export class GameSystemsModule {}
