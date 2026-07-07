import { and, eq, sql } from 'drizzle-orm'

import { db } from '#/lib/db/connection'
import {
  invitation,
  member,
  organization as organizationTable,
} from '#/lib/db/schema'

/**
 * Whether the given email has a pending workspace invitation waiting. Used at
 * signup to decide whether to auto-provision a personal workspace: an invited
 * user should join the inviting workspace instead (or only get a personal one
 * if they later decline).
 */
export async function hasPendingInvitation(email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        // Invitation emails are stored lowercased by Better Auth; match
        // case-insensitively against the (possibly mixed-case) signup email.
        eq(sql`lower(${invitation.email})`, email.toLowerCase()),
        eq(invitation.status, 'pending'),
      ),
    )
    .limit(1)

  return Boolean(row)
}

async function getMembershipOrganizationId(
  userId: string,
): Promise<string | null> {
  const [membership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  return membership?.organizationId ?? null
}

/**
 * Ensure the user owns a personal workspace, creating one if they belong to
 * none. Returns the organization id of their (existing or freshly created)
 * workspace. Idempotent — safe to call whenever a user might be workspace-less.
 */
export async function ensurePersonalWorkspace(
  userId: string,
  profile: { name?: string | null; email: string },
): Promise<string> {
  const existing = await getMembershipOrganizationId(userId)

  if (existing) {
    return existing
  }

  const organizationId = crypto.randomUUID()
  const displayName = profile.name?.trim() || profile.email.split('@')[0]
  const now = new Date()

  await db.insert(organizationTable).values({
    id: organizationId,
    name: `${displayName}'s workspace`,
    slug: `w-${userId}`,
    createdAt: now,
  })

  await db.insert(member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId,
    role: 'owner',
    createdAt: now,
  })

  return organizationId
}
