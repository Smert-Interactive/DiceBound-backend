import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module.js';
import { CharacterDataValidator } from './character-data.validator.js';
import { CharactersController } from './characters.controller.js';
import { CharactersService } from './characters.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CharactersController],
  providers: [CharactersService, CharacterDataValidator],
})
export class CharactersModule {}
