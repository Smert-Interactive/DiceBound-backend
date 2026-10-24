import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client.js';

interface User {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
}
interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export function authPrismaMock() {
  const users = new Map<string, User>();
  const sessions = new Map<string, Session>();
  const prisma = {
    user: {
      create: vi.fn(
        async ({ data }: { data: Omit<User, 'id' | 'createdAt'> }) => {
          if (
            [...users.values()].some(
              (user) => user.email.trim().toLowerCase() === data.email,
            )
          ) {
            throw new Prisma.PrismaClientKnownRequestError(
              'Unique constraint',
              { code: 'P2002', clientVersion: 'test' },
            );
          }
          const user = { ...data, id: randomUUID(), createdAt: new Date() };
          users.set(user.id, user);
          return user;
        },
      ),
    },
    $queryRaw: vi.fn(async (_sql: TemplateStringsArray, email: string) =>
      [...users.values()].filter(
        (user) => user.email.trim().toLowerCase() === email,
      ),
    ),
    character: { count: vi.fn(async () => 0) },
    characterShare: { count: vi.fn(async () => 0) },
    authSession: {
      create: vi.fn(async ({ data }: { data: Omit<Session, 'id'> }) => {
        const session = { ...data, id: randomUUID() };
        sessions.set(session.id, session);
        return session;
      }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const session = [...sessions.values()].find(
          (item) => item.tokenHash === where.tokenHash,
        );
        const user = session && users.get(session.userId);
        return session && user ? { ...session, user } : null;
      }),
      deleteMany: vi.fn(
        async ({
          where,
        }: {
          where: { id?: string; tokenHash?: string; expiresAt?: { lte: Date } };
        }) => {
          let count = 0;
          for (const [id, session] of sessions) {
            if (
              (where.id === undefined || id === where.id) &&
              (where.tokenHash === undefined ||
                session.tokenHash === where.tokenHash) &&
              (where.expiresAt === undefined ||
                session.expiresAt <= where.expiresAt.lte)
            ) {
              sessions.delete(id);
              count++;
            }
          }
          return { count };
        },
      ),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof prisma) => Promise<unknown>) =>
      callback(prisma),
  );
  return { prisma, users, sessions };
}
