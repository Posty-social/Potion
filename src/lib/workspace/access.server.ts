import { eq } from 'drizzle-orm'

import { auth } from '#/lib/auth'
import { db } from '#/lib/db/connection'
import { member, organization } from '#/lib/db/schema'

import type { WorkspaceAccess } from './access'
import type { WorkspaceContext } from './repository'

/**
 * Resolve the acting user and their active workspace organization from the
 * request. Auth is always required; an unauthenticated request resolves to a
 * null user so callers can redirect to the login page.
 */
export async function resolveWorkspaceAccess(
  headers: Headers,
): Promise<WorkspaceAccess> {
  const session = await auth.api.getSession({ headers })

  if (!session?.user) {
    return { user: null, organizationId: null }
  }

  let organizationId = session.session.activeOrganizationId ?? null

  if (!organizationId) {
    const [membership] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, session.user.id))
      .limit(1)

    organizationId = membership?.organizationId ?? null
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    },
    organizationId,
  }
}

async function organizationForUser(userId: string): Promise<string | null> {
  const [membership] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)

  return membership?.organizationId ?? null
}

export type McpWorkspaceMembership = {
  id: string
  name: string
  slug: string
  role: string
}

/**
 * Every workspace (organization) the user belongs to, with their role. Powers
 * the MCP `list_workspaces` tool and per-call `workspaceId` membership checks.
 */
export async function listUserWorkspaces(
  userId: string,
): Promise<McpWorkspaceMembership[]> {
  return db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
}

/**
 * Resolve the acting user + organization for an MCP request. Accepts either an
 * OAuth access token (issued to MCP clients) or a normal Better Auth session
 * cookie. Returns null when the request is not authenticated.
 */
export async function resolveMcpContext(
  headers: Headers,
): Promise<WorkspaceContext | null> {
  let userId: string | null = null

  try {
    const token = await auth.api.getMcpSession({ headers })
    userId = token?.userId ?? null
  } catch {
    userId = null
  }

  if (!userId) {
    const session = await auth.api.getSession({ headers }).catch(() => null)
    userId = session?.user?.id ?? null
  }

  if (!userId) {
    return null
  }

  const organizationId = await organizationForUser(userId)

  if (!organizationId) {
    return null
  }

  return { organizationId, userId }
}
