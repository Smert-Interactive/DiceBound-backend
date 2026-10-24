import { ApiProperty } from '@nestjs/swagger';
import type { PublicUser } from '../auth.types.js';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;
  @ApiProperty()
  username: string;
  @ApiProperty({ format: 'email' })
  email: string;
  @ApiProperty({ format: 'date-time' })
  created_at: string;
}

export class CurrentUserResponseDto extends UserResponseDto {
  @ApiProperty({ minimum: 0 })
  owned_characters_count: number;
  @ApiProperty({ minimum: 0 })
  shared_characters_count: number;
}

export function toUserResponse(user: PublicUser) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    created_at: user.createdAt.toISOString(),
  };
}
