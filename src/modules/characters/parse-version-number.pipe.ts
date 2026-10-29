import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  ParseIntPipe,
} from '@nestjs/common';

@Injectable()
export class ParseVersionNumberPipe extends ParseIntPipe {
  override async transform(
    value: string,
    metadata: ArgumentMetadata,
  ): Promise<number> {
    const versionNumber = await super.transform(value, metadata);
    // CharacterVersion.versionNumber is a PostgreSQL integer, not a JS float.
    if (
      typeof versionNumber !== 'number' ||
      !Number.isSafeInteger(versionNumber) ||
      versionNumber < 1 ||
      versionNumber > 2_147_483_647
    ) {
      throw new BadRequestException(
        'Version number must be an integer between 1 and 2147483647',
      );
    }
    return versionNumber;
  }
}
