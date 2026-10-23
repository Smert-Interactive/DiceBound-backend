import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { HealthResponseDto } from './dto/health-response.dto.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Check API health',
    description:
      'Checks whether the API process is responding. ' +
      'Does not verify database connectivity.',
  })
  @ApiOkResponse({
    description: 'The API is running',
    type: HealthResponseDto,
  })
  getHealth(): HealthResponseDto {
    return {
      status: 'ok',
    };
  }
}
