import { and, inArray, lt, sql } from 'drizzle-orm'

import type { AppDatabase } from '#/lib/db/connection'
import {
  asset,
  block,
  collectionRow,
  comment,
  organization,
  page,
} from '#/lib/db/schema'

/** Uploads younger than this are never cleaned up (they may be mid-edit). */
export const ASSET_CLEANUP_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000
const BATCH_SIZE = 200

/**
 * Delete uploads nothing uses any more: asset records older than `minAgeMs`
 * whose `/api/assets/…` path appears nowhere a user or agent can put it —
 * block content, card bodies and cells (url/text values), page property
 * values, page covers, comments, workspace logos. Removes the R2 objects,
 * then the records. Any mention of the path counts as a use (an exact
 * substring match), so this errs on the side of keeping files. Runs from the
 * daily cron (src/server.ts) against the primary database, so a reference
 * written moments ago is never missed on a lagging read replica.
 */
export async function deleteUnusedAssets(input: {
  db: AppDatabase
  bucket: R2Bucket
  now?: number
  minAgeMs?: number
  batchSize?: number
}): Promise<{ deleted: string[] }> {
  const cutoff = new Date(
    (input.now ?? Date.now()) - (input.minAgeMs ?? ASSET_CLEANUP_MIN_AGE_MS),
  )
  const path = sql`'/api/' || ${asset.r2Key}`

  const unused = await input.db
    .select({ id: asset.id, r2Key: asset.r2Key })
    .from(asset)
    .where(
      and(
        lt(asset.createdAt, cutoff),
        sql`not exists (select 1 from ${block} where instr(${block.content}, ${path}) > 0)`,
        sql`not exists (select 1 from ${collectionRow} where instr(${collectionRow.body}, ${path}) > 0 or instr(${collectionRow.values}, ${path}) > 0)`,
        sql`not exists (select 1 from ${page} where ${page.coverAssetId} = ${asset.id} or instr(${page.propertyValues}, ${path}) > 0)`,
        sql`not exists (select 1 from ${comment} where instr(${comment.body}, ${path}) > 0)`,
        sql`not exists (select 1 from ${organization} where instr(${organization.logo}, ${path}) > 0)`,
      ),
    )
    .limit(input.batchSize ?? BATCH_SIZE)

  if (unused.length === 0) {
    return { deleted: [] }
  }

  // Objects first: if this fails the records stay and the next run retries.
  await input.bucket.delete(unused.map((record) => record.r2Key))
  await input.db.delete(asset).where(
    inArray(
      asset.id,
      unused.map((record) => record.id),
    ),
  )

  return { deleted: unused.map((record) => record.r2Key) }
}
