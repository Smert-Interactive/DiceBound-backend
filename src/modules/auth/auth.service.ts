import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { publicUserSelect } from './auth.types.js';
import type { PublicUser } from './auth.types.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import { toUserResponse } from './dto/user-response.dto.js';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyPasswordHash: string;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Unknown emails still perform password verification to reduce account timing disclosure.
    this.dummyPasswordHash = await hash(randomBytes(32), { type: argon2id });
  }

  async register(input: RegisterDto) {
    const passwordHash = await hash(input.password, { type: argon2id });
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          username: `player_${randomBytes(8).toString('hex')}`,
          passwordHash,
        },
        select: publicUserSelect,
      });
      return toUserResponse(user);
    } catch (error) {
      // The DB index is authoritative, including concurrent registration attempts.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  async login(input: LoginDto) {
    // Match the existing expression index, including legacy mixed-case/padded emails.
    const [user] = await this.prisma.$queryRaw<
      (PublicUser & { passwordHash: string })[]
    >`
      SELECT id, username, email, created_at AS "createdAt", password_hash AS "passwordHash"
      FROM users WHERE lower(btrim(email)) = ${input.email} LIMIT 1
    `;
    const valid = await verify(
      user?.passwordHash ?? this.dummyPasswordHash,
      input.password,
    );
    if (!user || !valid)
      throw new UnauthorizedException('Invalid email or password');
    return toUserResponse(user);
  }

  async me(user: PublicUser) {
    const [owned, shared] = await Promise.all([
      this.prisma.character.count({ where: { ownerId: user.id } }),
      // EDIT creates an owned copy; only VIEW grants count as shared characters.
      this.prisma.characterShare.count({
        where: { userId: user.id, permission: 'VIEW' },
      }),
    ]);
    return {
      ...toUserResponse(user),
      owned_characters_count: owned,
      shared_characters_count: shared,
    };
  }
}
