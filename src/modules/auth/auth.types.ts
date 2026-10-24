import type { Request } from 'express';
import type { Prisma } from '../../generated/prisma/client.js';

export const publicUserSelect = {
  id: true,
  username: true,
  email: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;

export interface AuthenticatedRequest extends Request {
  auth: { sessionId: string; user: PublicUser };
}
