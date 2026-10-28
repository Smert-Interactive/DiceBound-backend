import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { CharacterDataValidator } from './character-data.validator.js';
import { CharactersController } from './characters.controller.js';
import { CharactersService } from './characters.service.js';
import { CharacterHistoryController } from './character-history.controller.js';
import { CharacterHistoryService } from './character-history.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CharactersController, CharacterHistoryController],
  providers: [
    CharactersService,
    CharacterDataValidator,
    CharacterHistoryService,
  ],
})
export class CharactersModule {}
