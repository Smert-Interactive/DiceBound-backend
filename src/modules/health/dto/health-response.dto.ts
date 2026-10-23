import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({
    description: 'Current API health status',
    example: 'ok',
    enum: ['ok'],
  })
  status!: 'ok';
}
