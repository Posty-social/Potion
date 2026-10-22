import { and, eq, inArray } from 'drizzle-orm'

import { db } from '#/lib/db/connection'
import { asset, block, page } from '#/lib/db/schema'
import { listUserWorkspaces } from '#/lib/workspace/access.server'

/**
 * Whether a signed-in user may read the uploaded file at `key`
 * (`assets/<assetId>/<file>`): only members of the workspace it was uploaded
 * to can. Files from before uploads were recorded have no asset row; those
 * are allowed when an image or video block in one of the user's workspaces
 * uses the file (the backfill migration records most of them).
 */
export async function canReadAsset(
  userId: string,
  key: string,
): Promise<boolean> {
  const assetId = key.split('/')[1]
  if (!assetId) {
    return false
  }

  const workspaceIds = (await listUserWorkspaces(userId)).map((w) => w.id)
  if (workspaceIds.length === 0) {
    return false
  }

  const record = await db.query.asset.findFirst({
    columns: { organizationId: true, r2Key: true },
    where: eq(asset.id, assetId),
  })

  if (record) {
    return record.r2Key === key && workspaceIds.includes(record.organizationId)
  }

  // Legacy, unrecorded upload. A join (block → page → workspace), so this
  // stays on select().
  const [reference] = await db
    .select({ id: block.id })
    .from(block)
    .innerJoin(page, eq(block.pageId, page.id))
    .where(
      and(
        inArray(block.type, ['image', 'video']),
        eq(block.content, `/api/${key}`),
        inArray(page.organizationId, workspaceIds),
      ),
    )
    .limit(1)

  return Boolean(reference)
}
