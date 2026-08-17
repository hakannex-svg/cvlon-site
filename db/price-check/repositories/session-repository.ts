import "../server-boundary.ts";

import { and, eq, gt, isNull } from "drizzle-orm";

import type { PriceCheckDb } from "../index.ts";
import { adminSessions, adminUsers } from "../schema.ts";
import { generateOrderedId } from "../domain/identifiers.ts";
import {
  ADMIN_SESSION_TTL_SECONDS,
  hashAdminSessionToken,
  newAdminSessionToken,
} from "../../../lib/price-check/admin/session.ts";

export async function createAdminSession(
  db: PriceCheckDb,
  adminUserId: string,
  sessionSecret: string,
) {
  const token = newAdminSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.valueOf() + ADMIN_SESSION_TTL_SECONDS * 1000);
  await db.transaction(async (tx) => {
    await tx.update(adminSessions)
      .set({ revokedAt: now })
      .where(and(
        eq(adminSessions.adminUserId, adminUserId),
        isNull(adminSessions.revokedAt),
      ));
    await tx.insert(adminSessions).values({
      id: generateOrderedId(),
      adminUserId,
      tokenHash: hashAdminSessionToken(token, sessionSecret),
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
    });
  });
  return { token, expiresAt };
}

export async function resolveAdminSession(
  db: PriceCheckDb,
  token: string,
  sessionSecret: string,
) {
  const now = new Date();
  const [record] = await db.select({ session: adminSessions, user: adminUsers })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.adminUserId, adminUsers.id))
    .where(and(
      eq(adminSessions.tokenHash, hashAdminSessionToken(token, sessionSecret)),
      isNull(adminSessions.revokedAt),
      gt(adminSessions.expiresAt, now),
      eq(adminUsers.active, true),
    ))
    .limit(1);
  if (!record) return null;

  if (now.valueOf() - record.session.lastSeenAt.valueOf() >= 5 * 60 * 1000) {
    await db.update(adminSessions)
      .set({ lastSeenAt: now })
      .where(eq(adminSessions.id, record.session.id));
  }
  return record.user;
}

export async function revokeAdminSession(
  db: PriceCheckDb,
  token: string,
  sessionSecret: string,
) {
  await db.update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(adminSessions.tokenHash, hashAdminSessionToken(token, sessionSecret)),
      isNull(adminSessions.revokedAt),
    ));
}
