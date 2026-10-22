import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  like,
  or,
  sql,
} from 'drizzle-orm'

import { buildR2AssetKey } from '#/lib/assets/intents'
import type { AppDatabase } from '#/lib/db/connection'
import {
  asset as assetTable,
  block as blockTable,
  collection as collectionTable,
  collectionRow as collectionRowTable,
  collectionView as collectionViewTable,
  member as memberTable,
  page as pageTable,
  user as userTable,
  workspaceProperty as workspacePropertyTable,
  type CollectionField as DbCollectionField,
  type CollectionViewConfig,
  type JsonRecord,
} from '#/lib/db/schema'

import { createUniqueSlug } from './import'
import { generateKeyBetween, keyAtEnd } from './ordering'
import {
  FIELD_OPTION_COLORS,
  OPTION_PROPERTY_TYPES,
  nextOptionColor,
  type CellValue,
  type DatabaseProperty,
  type DatabaseRow,
  type DatabaseView,
  type DatabaseViewType,
  type PropertyOption,
  type PropertyType,
  type WorkspaceBlock,
  type WorkspaceBlockType,
  type WorkspaceDatabase,
  type WorkspacePage,
  type WorkspacePageSummary,
} from './types'

type WorkspaceRepositoryErrorCode =
  | 'page_not_found'
  | 'block_not_found'
  | 'database_not_found'
  | 'view_not_found'
  | 'property_not_found'
  | 'row_not_found'
  | 'option_not_found'
  | 'version_conflict'
  | 'invalid_input'

export class WorkspaceRepositoryError extends Error {
  constructor(
    readonly code: WorkspaceRepositoryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceRepositoryError'
  }
}

type BlockProperties = { checked?: boolean }

export type WorkspaceContext = {
  organizationId: string
  userId: string
}

/**
 * Best-effort realtime hook: called after every successful write with the
 * affected page id so live viewers of that page can be told to refetch.
 * Implementations must never throw (realtime is not allowed to fail a write).
 */
export type WorkspaceNotifier = {
  pageChanged: (pageId: string) => Promise<void> | void
}

/** read_page payload for agents: databases carry a row preview + counts. */
export type AgentPage = Omit<WorkspacePage, 'databases'> & {
  databases: Array<
    Omit<WorkspaceDatabase, 'rows'> & {
      rows: Array<DatabaseRow & { hasBody: boolean }>
      rowCount: number
      archivedRowCount: number
      rowsTruncated: boolean
    }
  >
}

export type WorkspaceBlockUpdate = {
  pageId: string
  blockId: string
  content: string
  version: number
}

const DEFAULT_ICON = '📄'
const VIEW_DEFAULT_NAMES: Record<DatabaseViewType, string> = {
  table: 'Table',
  board: 'Board',
  list: 'List',
  gallery: 'Gallery',
  calendar: 'Calendar',
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}

function toIso(value: Date | number | null): string {
  if (value === null) {
    return new Date(0).toISOString()
  }

  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function pickColor(index: number): string {
  return FIELD_OPTION_COLORS[index % FIELD_OPTION_COLORS.length]
}

/** A page's `properties` column → attached ids (handles legacy object rows). */
function normalizeAttachedIds(raw: unknown): string[] {
  return ((raw ?? []) as unknown[]).map((entry) =>
    typeof entry === 'string' ? entry : (entry as DatabaseProperty).id,
  )
}

/** Map a shared catalog row to the UI property shape. */
function catalogRowToProperty(
  row: typeof workspacePropertyTable.$inferSelect,
): DatabaseProperty {
  const type = row.type as PropertyType
  const property: DatabaseProperty = { id: row.id, name: row.name, type }

  if (OPTION_PROPERTY_TYPES.includes(type)) {
    property.options = (row.options ?? []).map((option, index) => ({
      id: option.id,
      name: option.name,
      color: option.color ?? pickColor(index),
    }))
  }

  return property
}

function titlePropertyId(properties: DatabaseProperty[]): string {
  return (
    properties.find((property) => property.type === 'title')?.id ??
    properties[0]?.id ??
    ''
  )
}

function firstGroupableProperty(properties: DatabaseProperty[]): string | null {
  return (
    properties.find(
      (property) => property.type === 'select' || property.type === 'status',
    )?.id ?? null
  )
}

function firstDateProperty(properties: DatabaseProperty[]): string | null {
  return properties.find((property) => property.type === 'date')?.id ?? null
}

/** Sensible default view config for a given layout. */
function defaultViewConfig(
  type: DatabaseViewType,
  properties: DatabaseProperty[],
  existing: CollectionViewConfig = {},
): CollectionViewConfig {
  if (type === 'board') {
    return {
      ...existing,
      groupByFieldId:
        existing.groupByFieldId ??
        firstGroupableProperty(properties) ??
        undefined,
    }
  }

  if (type === 'calendar') {
    return {
      ...existing,
      datePropertyId:
        existing.datePropertyId ?? firstDateProperty(properties) ?? undefined,
    }
  }

  return existing
}

/**
 * D1/Drizzle-backed workspace store. Every method is scoped to a single
 * organization + acting user, so the caller never has to remember to filter.
 */
export class WorkspaceRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly ctx: WorkspaceContext,
    private readonly notifier?: WorkspaceNotifier,
    // R2 bucket for page media; injected so the repository stays free of the
    // Workers runtime (and tests can omit it). When absent, media cleanup on
    // block delete is skipped.
    private readonly assets?: R2Bucket,
  ) {}

  /** Tell live viewers of a page that it changed (no-op without a notifier). */
  private async notifyPage(pageId: string | null | undefined): Promise<void> {
    if (pageId) {
      await this.notifier?.pageChanged(pageId)
    }
  }

  /** Notify the page hosting a database (databases live on pages). */
  private async notifyDatabase(databaseId: string): Promise<void> {
    if (!this.notifier) {
      return
    }

    const row = await this.db.query.collection.findFirst({
      columns: { pageId: true },
      where: eq(collectionTable.id, databaseId),
    })

    await this.notifyPage(row?.pageId)
  }

  // --- Pages -------------------------------------------------------------

  async listPages(): Promise<WorkspacePageSummary[]> {
    const rows = await this.db
      .select()
      .from(pageTable)
      .where(
        and(
          eq(pageTable.organizationId, this.ctx.organizationId),
          eq(pageTable.isArchived, false),
        ),
      )
      .orderBy(asc(pageTable.position))

    return rows.map(toPageSummary)
  }

  /**
   * Find pages whose title, slug, or block content matches `query`. The outer
   * organization filter keeps the block-content subquery scoped to this org.
   */
  async searchPages(
    query: string,
    limit: number,
  ): Promise<WorkspacePageSummary[]> {
    const term = `%${query}%`

    const pageIdsWithMatchingContent = this.db
      .select({ pageId: blockTable.pageId })
      .from(blockTable)
      .where(like(blockTable.content, term))

    const rows = await this.db
      .select()
      .from(pageTable)
      .where(
        and(
          eq(pageTable.organizationId, this.ctx.organizationId),
          eq(pageTable.isArchived, false),
          or(
            like(pageTable.title, term),
            like(pageTable.slug, term),
            inArray(pageTable.id, pageIdsWithMatchingContent),
          ),
        ),
      )
      .orderBy(asc(pageTable.position))
      .limit(limit)

    return rows.map(toPageSummary)
  }

  /**
   * A page for agents: like getPage, but each database carries only a preview
   * of its non-archived rows (without bodies) plus row counts, so a big board
   * is never loaded in full.
   */
  async getPageForAgent(
    slug: string,
    rowPreviewLimit: number,
  ): Promise<AgentPage | null> {
    const pageRow = await this.db.query.page.findFirst({
      where: and(
        eq(pageTable.organizationId, this.ctx.organizationId),
        eq(pageTable.slug, slug),
        eq(pageTable.isArchived, false),
      ),
    })

    if (!pageRow) {
      return null
    }

    const page = await this.assemblePage(pageRow, { skipDatabases: true })
    const databaseIds = page.blocks
      .filter((block) => block.type === 'database' && block.databaseId)
      .map((block) => block.databaseId as string)
    const databases = await Promise.all(
      databaseIds.map(async (databaseId) => {
        const result = await this.getDatabaseRowsPage(databaseId, {
          includeArchived: false,
          includeBodies: false,
          limit: rowPreviewLimit,
          offset: 0,
        })
        return Object.assign(result.database, {
          rowCount: result.total,
          archivedRowCount: result.archivedCount,
          rowsTruncated: result.total > result.database.rows.length,
        })
      }),
    )

    return { ...page, databases }
  }

  async getPage(slug: string): Promise<WorkspacePage | null> {
    const [pageRow] = await this.db
      .select()
      .from(pageTable)
      .where(
        and(
          eq(pageTable.organizationId, this.ctx.organizationId),
          eq(pageTable.slug, slug),
          eq(pageTable.isArchived, false),
        ),
      )
      .limit(1)

    return pageRow ? this.assemblePage(pageRow) : null
  }

  async getPageById(pageId: string): Promise<WorkspacePage | null> {
    const [pageRow] = await this.db
      .select()
      .from(pageTable)
      .where(
        and(
          eq(pageTable.organizationId, this.ctx.organizationId),
          eq(pageTable.id, pageId),
        ),
      )
      .limit(1)

    return pageRow ? this.assemblePage(pageRow) : null
  }

  /** Load a single database (schema, rows, views) by id, scoped to the org. */
  async getDatabaseById(databaseId: string): Promise<WorkspaceDatabase | null> {
    await this.assertDatabaseInOrg(databaseId)

    const ownerBlocks = await this.db
      .select()
      .from(blockTable)
      .where(eq(blockTable.collectionId, databaseId))
      .limit(1)

    const [database] = await this.loadDatabases([databaseId], ownerBlocks)

    return database ?? null
  }

  /**
   * One page of a database's rows, with the archive filter, LIMIT/OFFSET and
   * body exclusion done in SQL so large boards are never loaded in full.
   * `total` counts the rows matching the archive filter; `archivedCount` is
   * every archived row. Rows carry `hasBody`; `body` is null unless
   * `includeBodies`.
   */
  async getDatabaseRowsPage(
    databaseId: string,
    options: {
      includeArchived: boolean
      includeBodies: boolean
      limit: number
      offset: number
    },
  ): Promise<{
    database: Omit<WorkspaceDatabase, 'rows'> & {
      rows: Array<DatabaseRow & { hasBody: boolean }>
    }
    total: number
    archivedCount: number
  }> {
    const database = await this.assertDatabaseInOrg(databaseId)
    const properties = (database.schema ?? []) as DatabaseProperty[]
    const scope = eq(collectionRowTable.collectionId, databaseId)

    const [ownerBlock, views, counts, rows] = await Promise.all([
      this.db.query.block.findFirst({
        columns: { id: true },
        where: eq(blockTable.collectionId, databaseId),
      }),
      this.db.query.collectionView.findMany({
        where: eq(collectionViewTable.collectionId, databaseId),
        orderBy: asc(collectionViewTable.position),
      }),
      // Aggregation, so this stays on select().
      this.db
        .select({
          all: count(),
          archived: sql<number>`coalesce(sum(case when ${collectionRowTable.isArchived} then 1 else 0 end), 0)`,
        })
        .from(collectionRowTable)
        .where(scope),
      this.db.query.collectionRow.findMany({
        columns: options.includeBodies ? undefined : { body: false },
        extras: {
          hasBody:
            sql<number>`(${collectionRowTable.body} is not null and trim(${collectionRowTable.body}) != '')`.as(
              'has_body',
            ),
        },
        where: options.includeArchived
          ? scope
          : and(scope, eq(collectionRowTable.isArchived, false)),
        orderBy: asc(collectionRowTable.position),
        limit: options.limit,
        offset: options.offset,
      }),
    ])

    const all = Number(counts[0]?.all ?? 0)
    const archivedCount = Number(counts[0]?.archived ?? 0)

    return {
      database: {
        id: database.id,
        blockId: ownerBlock?.id ?? '',
        title: database.title,
        titlePropertyId: titlePropertyId(properties),
        properties,
        views: views.map((view) => toDatabaseView(view, properties)),
        // toDatabaseRow returns a fresh object, so extend it in place.
        rows: rows.map((row) =>
          Object.assign(
            toDatabaseRow({ ...row, body: 'body' in row ? row.body : null }),
            { hasBody: Boolean(row.hasBody) },
          ),
        ),
      },
      total: options.includeArchived ? all : all - archivedCount,
      archivedCount,
    }
  }

  /** A database's columns without loading its rows (cheap; for validation). */
  async getDatabaseSchema(databaseId: string): Promise<{
    id: string
    title: string
    titlePropertyId: string
    properties: DatabaseProperty[]
  }> {
    const database = await this.assertDatabaseInOrg(databaseId)
    const properties = (database.schema ?? []) as DatabaseProperty[]

    return {
      id: database.id,
      title: database.title,
      titlePropertyId: titlePropertyId(properties),
      properties,
    }
  }

  /** One row (with its body) and the database it belongs to. */
  async getRow(rowId: string): Promise<DatabaseRow & { databaseId: string }> {
    const row = await this.assertRowInOrg(rowId)

    return { ...toDatabaseRow(row), databaseId: row.collectionId }
  }

  private async assemblePage(
    pageRow: typeof pageTable.$inferSelect,
    options: { skipDatabases?: boolean } = {},
  ): Promise<WorkspacePage> {
    const [blocks, summaries] = await Promise.all([
      this.db
        .select()
        .from(blockTable)
        .where(eq(blockTable.pageId, pageRow.id))
        .orderBy(asc(blockTable.position)),
      this.listPages(),
    ])

    const databaseIds = blocks
      .filter((block) => block.type === 'database' && block.collectionId)
      .map((block) => block.collectionId as string)

    const databases = options.skipDatabases
      ? []
      : await this.loadDatabases(databaseIds, blocks)
    const properties = await this.resolveAttachedProperties(pageRow)

    const summaryById = new Map(summaries.map((page) => [page.id, page]))
    const ancestors: WorkspacePageSummary[] = []
    let cursor = pageRow.parentPageId

    while (cursor) {
      const ancestor = summaryById.get(cursor)
      if (!ancestor) {
        break
      }
      ancestors.unshift(ancestor)
      cursor = ancestor.parentPageId
    }

    return {
      ...toPageSummary(pageRow),
      blocks: blocks.map(toWorkspaceBlock),
      databases,
      ancestors,
      childPages: summaries.filter((page) => page.parentPageId === pageRow.id),
      properties,
      propertyValues: (pageRow.propertyValues ?? {}) as Record<
        string,
        CellValue
      >,
    }
  }

  private async loadDatabases(
    databaseIds: string[],
    blocks: Array<typeof blockTable.$inferSelect>,
  ): Promise<WorkspaceDatabase[]> {
    if (databaseIds.length === 0) {
      return []
    }

    const [collections, rows, views] = await Promise.all([
      this.db
        .select()
        .from(collectionTable)
        .where(inArray(collectionTable.id, databaseIds)),
      this.db
        .select()
        .from(collectionRowTable)
        .where(inArray(collectionRowTable.collectionId, databaseIds))
        .orderBy(asc(collectionRowTable.position)),
      this.db
        .select()
        .from(collectionViewTable)
        .where(inArray(collectionViewTable.collectionId, databaseIds))
        .orderBy(asc(collectionViewTable.position)),
    ])

    const rowsByDb = groupBy(rows, (row) => row.collectionId)
    const viewsByDb = groupBy(views, (view) => view.collectionId)

    return collections
      .map((collection) => {
        const ownerBlock = blocks.find(
          (block) => block.collectionId === collection.id,
        )

        if (!ownerBlock) {
          return null
        }

        const properties = (collection.schema ?? []) as DatabaseProperty[]

        return {
          id: collection.id,
          blockId: ownerBlock.id,
          title: collection.title,
          titlePropertyId: titlePropertyId(properties),
          properties,
          rows: (rowsByDb.get(collection.id) ?? []).map(toDatabaseRow),
          views: (viewsByDb.get(collection.id) ?? []).map((view) =>
            toDatabaseView(view, properties),
          ),
        } satisfies WorkspaceDatabase
      })
      .filter((database): database is WorkspaceDatabase => database !== null)
  }

  async createPage(input: {
    title: string
    parentPageId?: string | null
    icon?: string
  }): Promise<WorkspacePageSummary> {
    const title = input.title.trim() || 'Untitled'
    const parentPageId = input.parentPageId ?? null

    if (parentPageId) {
      await this.assertPageInOrg(parentPageId)
    }

    const existing = await this.db
      .select({ slug: pageTable.slug })
      .from(pageTable)
      .where(eq(pageTable.organizationId, this.ctx.organizationId))

    const slug = createUniqueSlug(title, new Set(existing.map((r) => r.slug)))
    const siblingPositions = (
      await this.db
        .select({ position: pageTable.position })
        .from(pageTable)
        .where(
          and(
            eq(pageTable.organizationId, this.ctx.organizationId),
            parentPageId
              ? eq(pageTable.parentPageId, parentPageId)
              : isNull(pageTable.parentPageId),
          ),
        )
    ).map((r) => r.position)

    const id = newId('page')
    const now = new Date()
    const icon = input.icon ?? DEFAULT_ICON

    await this.db.insert(pageTable).values({
      id,
      organizationId: this.ctx.organizationId,
      parentPageId,
      title,
      slug,
      icon,
      position: keyAtEnd(siblingPositions),
      createdByUserId: this.ctx.userId,
      lastEditedByUserId: this.ctx.userId,
      createdAt: now,
      updatedAt: now,
    })

    return {
      id,
      slug,
      title,
      icon,
      parentPageId,
      position: keyAtEnd(siblingPositions),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
  }

  async renamePage(input: {
    pageId: string
    title: string
  }): Promise<WorkspacePageSummary> {
    const page = await this.assertPageInOrg(input.pageId)
    const title = input.title.trim() || 'Untitled'
    const now = new Date()

    await this.db
      .update(pageTable)
      .set({ title, updatedAt: now, lastEditedByUserId: this.ctx.userId })
      .where(eq(pageTable.id, page.id))
    await this.notifyPage(page.id)

    return { ...toPageSummary(page), title, updatedAt: now.toISOString() }
  }

  async setPageIcon(input: { pageId: string; icon: string }): Promise<void> {
    const page = await this.assertPageInOrg(input.pageId)

    await this.db
      .update(pageTable)
      .set({ icon: input.icon, updatedAt: new Date() })
      .where(eq(pageTable.id, page.id))
    await this.notifyPage(page.id)

    return
  }

  async deletePage(input: { pageId: string }): Promise<void> {
    const page = await this.assertPageInOrg(input.pageId)
    await this.db.delete(pageTable).where(eq(pageTable.id, page.id))
    await this.notifyPage(page.id)

    return
  }

  // --- Page properties ---------------------------------------------------
  // Notion-style properties shown at the top of a page. Property *definitions*
  // (name, type, options) live in the shared `workspace_property` catalog so
  // pages reuse each other's properties and select options; a page's
  // `properties` column stores the ordered ids of the catalog properties it has
  // attached, and `propertyValues` holds this page's values keyed by that id.
  // Editing a definition (rename/retype/options) is therefore shared across
  // every page that attaches it; deleting a property only *detaches* it here.

  /** Workspace members, for `person` properties (tag a user by id). */
  async listMembers(): Promise<
    Array<{ userId: string; name: string; email: string; role: string }>
  > {
    // A join, so this stays on select() (no drizzle relations are defined).
    const rows = await this.db
      .select({
        userId: memberTable.userId,
        name: userTable.name,
        email: userTable.email,
        role: memberTable.role,
      })
      .from(memberTable)
      .innerJoin(userTable, eq(memberTable.userId, userTable.id))
      .where(eq(memberTable.organizationId, this.ctx.organizationId))
      .orderBy(asc(userTable.name))

    return rows
  }

  /** Every shared property definition in the workspace, for the picker. */
  async listWorkspaceProperties(): Promise<DatabaseProperty[]> {
    const rows = await this.db.query.workspaceProperty.findMany({
      where: eq(workspacePropertyTable.organizationId, this.ctx.organizationId),
      orderBy: asc(workspacePropertyTable.name),
    })

    return rows.map(catalogRowToProperty)
  }

  async addPageProperty(input: {
    pageId: string
    name: string
    type: Exclude<PropertyType, 'title'>
    // Optional client-generated id so optimistic UI can know the id upfront.
    propertyId?: string
  }): Promise<{ propertyId: string }> {
    const page = await this.assertPageInOrg(input.pageId)
    const propertyId = input.propertyId ?? newId('prop')

    await this.db.insert(workspacePropertyTable).values({
      id: propertyId,
      organizationId: this.ctx.organizationId,
      name: input.name.trim() || 'Property',
      type: input.type,
      options: [],
    })

    const ids = await this.attachedIds(page)
    await this.writeAttachedIds(page.id, [...ids, propertyId])

    return { propertyId }
  }

  /** Attach an existing workspace property (by id) to this page. */
  async attachPageProperty(input: {
    pageId: string
    propertyId: string
  }): Promise<void> {
    const page = await this.assertPageInOrg(input.pageId)
    await this.getCatalogProperty(input.propertyId)

    const ids = await this.attachedIds(page)
    if (!ids.includes(input.propertyId)) {
      await this.writeAttachedIds(page.id, [...ids, input.propertyId])
    }

    return
  }

  async updatePageProperty(input: {
    pageId: string
    propertyId: string
    name?: string
    type?: Exclude<PropertyType, 'title'>
  }): Promise<void> {
    await this.assertPageInOrg(input.pageId)
    await this.updateCatalogProperty(input)
    await this.notifyPage(input.pageId)

    return
  }

  /** Rename/retype a shared property — changes it on every page using it. */
  async updateCatalogProperty(input: {
    propertyId: string
    name?: string
    type?: Exclude<PropertyType, 'title'>
  }): Promise<void> {
    const row = await this.getCatalogProperty(input.propertyId)

    const patch: Partial<typeof workspacePropertyTable.$inferInsert> = {
      updatedAt: new Date(),
    }
    if (input.name !== undefined) {
      patch.name = input.name.trim() || 'Property'
    }
    if (input.type !== undefined && input.type !== row.type) {
      patch.type = input.type
      patch.options = OPTION_PROPERTY_TYPES.includes(input.type)
        ? (row.options ?? [])
        : []
    }

    await this.db
      .update(workspacePropertyTable)
      .set(patch)
      .where(
        and(
          eq(workspacePropertyTable.id, input.propertyId),
          eq(workspacePropertyTable.organizationId, this.ctx.organizationId),
        ),
      )

    return
  }

  /**
   * Delete a shared property everywhere: remove it from the catalog, detach it
   * from every page that uses it, and drop those pages' stored values.
   */
  async deleteCatalogProperty(input: { propertyId: string }): Promise<void> {
    await this.getCatalogProperty(input.propertyId)

    await this.db
      .delete(workspacePropertyTable)
      .where(
        and(
          eq(workspacePropertyTable.id, input.propertyId),
          eq(workspacePropertyTable.organizationId, this.ctx.organizationId),
        ),
      )

    const pages = await this.db.query.page.findMany({
      where: eq(pageTable.organizationId, this.ctx.organizationId),
    })

    const affected = pages.filter((page) =>
      normalizeAttachedIds(page.properties).includes(input.propertyId),
    )

    await Promise.all(
      affected.map((page) => {
        const values = {
          ...((page.propertyValues ?? {}) as Record<string, CellValue>),
        }
        delete values[input.propertyId]

        return this.db
          .update(pageTable)
          .set({
            properties: normalizeAttachedIds(page.properties).filter(
              (id) => id !== input.propertyId,
            ),
            propertyValues: values as JsonRecord,
            updatedAt: new Date(),
            lastEditedByUserId: this.ctx.userId,
          })
          .where(eq(pageTable.id, page.id))
      }),
    )
    await Promise.all(affected.map((page) => this.notifyPage(page.id)))

    return
  }

  async deletePageProperty(input: {
    pageId: string
    propertyId: string
  }): Promise<void> {
    // Detach from this page only — the shared definition stays in the catalog
    // for any other page that uses it.
    const page = await this.assertPageInOrg(input.pageId)
    const ids = await this.attachedIds(page)
    const values = {
      ...((page.propertyValues ?? {}) as Record<string, CellValue>),
    }
    delete values[input.propertyId]

    await this.db
      .update(pageTable)
      .set({
        properties: ids.filter((id) => id !== input.propertyId),
        propertyValues: values as JsonRecord,
        updatedAt: new Date(),
        lastEditedByUserId: this.ctx.userId,
      })
      .where(eq(pageTable.id, page.id))
    await this.notifyPage(page.id)

    return
  }

  async setPagePropertyValue(input: {
    pageId: string
    propertyId: string
    value: CellValue
  }): Promise<void> {
    const page = await this.assertPageInOrg(input.pageId)
    const values = {
      ...((page.propertyValues ?? {}) as Record<string, CellValue>),
      [input.propertyId]: input.value,
    }

    await this.db
      .update(pageTable)
      .set({
        propertyValues: values as JsonRecord,
        updatedAt: new Date(),
        lastEditedByUserId: this.ctx.userId,
      })
      .where(eq(pageTable.id, page.id))
    await this.notifyPage(page.id)

    return
  }

  async addPagePropertyOption(input: {
    pageId: string
    propertyId: string
    name: string
    optionId?: string
  }): Promise<{ optionId: string }> {
    const result = await this.addCatalogPropertyOption(input)
    await this.notifyPage(input.pageId)

    return result
  }

  /** Add a select option to a shared property (shared everywhere it's used). */
  async addCatalogPropertyOption(input: {
    propertyId: string
    name: string
    // Optional client-generated id so optimistic UI can know the id upfront.
    optionId?: string
  }): Promise<{ optionId: string }> {
    const row = await this.getCatalogProperty(input.propertyId)

    if (!OPTION_PROPERTY_TYPES.includes(row.type as PropertyType)) {
      throw new WorkspaceRepositoryError(
        'invalid_input',
        `Page property "${row.name}" (${row.id}) is a ${row.type} property; only select, multi_select and status properties have options.`,
      )
    }

    const options = row.options ?? []
    const option: PropertyOption = {
      id: input.optionId ?? newId('opt'),
      name: input.name.trim() || 'Option',
      color: nextOptionColor(options),
    }

    await this.writeCatalogOptions(input.propertyId, [...options, option])

    return { optionId: option.id }
  }

  async renamePagePropertyOption(input: {
    pageId: string
    propertyId: string
    optionId: string
    name: string
  }): Promise<void> {
    await this.renameCatalogPropertyOption(input)
    await this.notifyPage(input.pageId)

    return
  }

  /** Rename a shared select option (shared everywhere it's used). */
  async renameCatalogPropertyOption(input: {
    propertyId: string
    optionId: string
    name: string
  }): Promise<void> {
    const row = await this.getCatalogProperty(input.propertyId)
    const options = (row.options ?? []).map((option) =>
      option.id === input.optionId
        ? { ...option, name: input.name.trim() || 'Option' }
        : option,
    )

    if (!options.some((option) => option.id === input.optionId)) {
      throw new WorkspaceRepositoryError(
        'option_not_found',
        `Option "${input.optionId}" was not found on page property "${row.name}" (${row.id}).`,
      )
    }

    await this.writeCatalogOptions(input.propertyId, options)

    return
  }

  /** Delete a shared select option (removed everywhere it's used). */
  async deleteCatalogPropertyOption(input: {
    propertyId: string
    optionId: string
  }): Promise<void> {
    const row = await this.getCatalogProperty(input.propertyId)
    await this.writeCatalogOptions(
      input.propertyId,
      (row.options ?? []).filter((option) => option.id !== input.optionId),
    )

    return
  }

  async deletePagePropertyOption(input: {
    pageId: string
    propertyId: string
    optionId: string
  }): Promise<void> {
    await this.deleteCatalogPropertyOption(input)

    // Clear the removed option from this page's value.
    const page = await this.assertPageInOrg(input.pageId)
    const values = {
      ...((page.propertyValues ?? {}) as Record<string, CellValue>),
    }
    const current = values[input.propertyId]
    if (current === input.optionId) {
      values[input.propertyId] = null
    } else if (Array.isArray(current) && current.includes(input.optionId)) {
      values[input.propertyId] = current.filter((id) => id !== input.optionId)
    }

    await this.db
      .update(pageTable)
      .set({
        propertyValues: values as JsonRecord,
        updatedAt: new Date(),
        lastEditedByUserId: this.ctx.userId,
      })
      .where(eq(pageTable.id, page.id))
    await this.notifyPage(page.id)

    return
  }

  /** Load one catalog property, scoped to this workspace. */
  private async getCatalogProperty(
    propertyId: string,
  ): Promise<typeof workspacePropertyTable.$inferSelect> {
    const row = await this.db.query.workspaceProperty.findFirst({
      where: and(
        eq(workspacePropertyTable.id, propertyId),
        eq(workspacePropertyTable.organizationId, this.ctx.organizationId),
      ),
    })

    if (!row) {
      throw new WorkspaceRepositoryError(
        'property_not_found',
        `Page property "${propertyId}" was not found in the workspace property catalog. Database columns are managed with the *_database_* tools.`,
      )
    }

    return row
  }

  private async writeCatalogOptions(
    propertyId: string,
    options: NonNullable<
      (typeof workspacePropertyTable.$inferSelect)['options']
    >,
  ): Promise<void> {
    await this.db
      .update(workspacePropertyTable)
      .set({ options, updatedAt: new Date() })
      .where(
        and(
          eq(workspacePropertyTable.id, propertyId),
          eq(workspacePropertyTable.organizationId, this.ctx.organizationId),
        ),
      )
  }

  private async writeAttachedIds(pageId: string, ids: string[]): Promise<void> {
    await this.db
      .update(pageTable)
      .set({
        properties: ids,
        updatedAt: new Date(),
        lastEditedByUserId: this.ctx.userId,
      })
      .where(eq(pageTable.id, pageId))
    await this.notifyPage(pageId)
  }

  /** The catalog property ids attached to a page, backfilling legacy rows. */
  private async attachedIds(
    pageRow: typeof pageTable.$inferSelect,
  ): Promise<string[]> {
    const raw = (pageRow.properties ?? []) as unknown[]
    if (raw.some((entry) => entry !== null && typeof entry === 'object')) {
      await this.backfillLegacyProperties(pageRow, raw as DatabaseProperty[])
      return (raw as DatabaseProperty[]).map((property) => property.id)
    }
    return raw as string[]
  }

  /**
   * Resolve a page's attached property ids to their shared catalog definitions,
   * preserving the page's order and dropping ids no longer in the catalog.
   */
  private async resolveAttachedProperties(
    pageRow: typeof pageTable.$inferSelect,
  ): Promise<DatabaseProperty[]> {
    const ids = await this.attachedIds(pageRow)
    if (ids.length === 0) {
      return []
    }

    const rows = await this.db.query.workspaceProperty.findMany({
      where: and(
        eq(workspacePropertyTable.organizationId, this.ctx.organizationId),
        inArray(workspacePropertyTable.id, ids),
      ),
    })
    const byId = new Map(rows.map((row) => [row.id, catalogRowToProperty(row)]))

    return ids
      .map((id) => byId.get(id))
      .filter(
        (property): property is DatabaseProperty => property !== undefined,
      )
  }

  /**
   * One-time migration of a page that still stores full property definition
   * objects: seed each into the catalog (id preserved so existing values keep
   * working) and rewrite the page to store ids. Idempotent.
   */
  private async backfillLegacyProperties(
    pageRow: typeof pageTable.$inferSelect,
    legacy: DatabaseProperty[],
  ): Promise<void> {
    await Promise.all(
      legacy.map((property) =>
        this.db
          .insert(workspacePropertyTable)
          .values({
            id: property.id,
            organizationId: this.ctx.organizationId,
            name: property.name,
            type: property.type,
            options: property.options ?? [],
          })
          .onConflictDoNothing(),
      ),
    )

    await this.writeAttachedIds(
      pageRow.id,
      legacy.map((property) => property.id),
    )
  }

  // --- Blocks ------------------------------------------------------------

  async createBlock(input: {
    pageId: string
    type: WorkspaceBlockType
    afterBlockId?: string | null
    content?: string
    databaseTitle?: string
    initialView?: DatabaseViewType
  }): Promise<{ blockId: string; databaseId: string | null }> {
    const page = await this.assertPageInOrg(input.pageId)
    const position = await this.positionForNewBlock(
      page.id,
      input.afterBlockId ?? null,
    )
    const now = new Date()
    const blockId = newId('block')
    let databaseId: string | null = null

    if (input.type === 'database') {
      databaseId = await this.createDatabase(
        page.id,
        input.databaseTitle ?? 'Untitled',
        input.initialView ?? 'table',
      )
    }

    await this.db.insert(blockTable).values({
      id: blockId,
      pageId: page.id,
      type: input.type,
      content: input.content ?? '',
      properties: {} as JsonRecord,
      collectionId: databaseId,
      position,
      createdByUserId: this.ctx.userId,
      lastEditedByUserId: this.ctx.userId,
      createdAt: now,
      updatedAt: now,
    })

    await this.touchPage(page.id)

    return { blockId, databaseId }
  }

  async updateBlock(input: {
    pageId: string
    blockId: string
    content: string
    version: number
  }): Promise<WorkspaceBlockUpdate> {
    const page = await this.assertPageInOrg(input.pageId)
    const [block] = await this.db
      .select()
      .from(blockTable)
      .where(
        and(eq(blockTable.id, input.blockId), eq(blockTable.pageId, page.id)),
      )
      .limit(1)

    if (!block) {
      throw new WorkspaceRepositoryError(
        'block_not_found',
        `Block "${input.blockId}" was not found on page "${page.id}".`,
      )
    }

    if (input.version !== block.version) {
      throw new WorkspaceRepositoryError(
        'version_conflict',
        `Block "${block.id}" has changed since it was loaded (you sent version ${input.version}, current is ${block.version}). Re-read the page and retry.`,
      )
    }

    const nextVersion = block.version + 1
    const now = new Date()

    await this.db
      .update(blockTable)
      .set({
        content: input.content,
        version: nextVersion,
        updatedAt: now,
        lastEditedByUserId: this.ctx.userId,
      })
      .where(eq(blockTable.id, block.id))

    await this.touchPage(page.id)

    return {
      pageId: page.id,
      blockId: block.id,
      content: input.content,
      version: nextVersion,
    }
  }

  async setBlockChecked(input: {
    blockId: string
    checked: boolean
  }): Promise<void> {
    const block = await this.assertBlockInOrg(input.blockId)
    const properties = (block.properties ?? {}) as BlockProperties

    await this.db
      .update(blockTable)
      .set({
        properties: { ...properties, checked: input.checked } as JsonRecord,
        updatedAt: new Date(),
      })
      .where(eq(blockTable.id, block.id))
    await this.notifyPage(block.pageId)

    return
  }

  async deleteBlock(input: { blockId: string }): Promise<void> {
    const block = await this.assertBlockInOrg(input.blockId)

    if (block.type === 'database' && block.collectionId) {
      // Deleting the database cascades to its rows, views and this block.
      await this.db
        .delete(collectionTable)
        .where(eq(collectionTable.id, block.collectionId))
    } else {
      await this.db.delete(blockTable).where(eq(blockTable.id, block.id))
    }

    await this.deleteBlockMedia(block.type, block.content)
    await this.touchPage(block.pageId)

    return
  }

  /**
   * Reorder a block within its page. `afterBlockId` is the block the moved
   * block should sit immediately after; null moves it to the top. The new
   * fractional position is computed between that neighbour and the next,
   * excluding the block being moved.
   */
  async moveBlock(input: {
    blockId: string
    afterBlockId?: string | null
  }): Promise<void> {
    const block = await this.assertBlockInOrg(input.blockId)

    const siblings = (
      await this.db
        .select({ id: blockTable.id, position: blockTable.position })
        .from(blockTable)
        .where(eq(blockTable.pageId, block.pageId))
        .orderBy(asc(blockTable.position))
    ).filter((candidate) => candidate.id !== block.id)

    const afterId = input.afterBlockId ?? null
    let before: string | null
    let after: string | null

    if (afterId === null) {
      before = null
      after = siblings[0]?.position ?? null
    } else {
      const index = siblings.findIndex((candidate) => candidate.id === afterId)
      if (index === -1) {
        // Stale target (e.g. concurrently deleted) — append at the end.
        before = siblings[siblings.length - 1]?.position ?? null
        after = null
      } else {
        before = siblings[index].position
        after = siblings[index + 1]?.position ?? null
      }
    }

    await this.db
      .update(blockTable)
      .set({
        position: generateKeyBetween(before, after),
        updatedAt: new Date(),
        lastEditedByUserId: this.ctx.userId,
      })
      .where(eq(blockTable.id, block.id))

    await this.touchPage(block.pageId)
  }

  /**
   * Best-effort R2 cleanup after an image/video block is deleted, so the
   * uploaded file doesn't outlive the block that referenced it. Only our own
   * uploads (served from `/api/assets/<key>`) are removed — external image URLs
   * and YouTube/Vimeo embeds have no R2 object and are left alone. Never throws:
   * storage cleanup must not fail the block deletion.
   */
  private async deleteBlockMedia(type: string, content: string): Promise<void> {
    if (type !== 'image' && type !== 'video') {
      return
    }

    const url = content.trim()
    if (!url.startsWith('/api/assets/')) {
      return
    }

    // `/api/assets/<assetId>/<file>` → R2 key `assets/<assetId>/<file>`.
    const key = url.slice('/api/'.length)
    try {
      await this.assets?.delete(key)
    } catch {
      // Orphaned object is preferable to a failed delete; swallow.
    }
  }

  // --- Database ----------------------------------------------------------

  async renameDatabase(input: {
    databaseId: string
    title: string
  }): Promise<void> {
    const database = await this.assertDatabaseInOrg(input.databaseId)

    await this.db
      .update(collectionTable)
      .set({ title: input.title.trim() || 'Untitled', updatedAt: new Date() })
      .where(eq(collectionTable.id, database.id))
    await this.notifyPage(database.pageId)

    return
  }

  // --- Views -------------------------------------------------------------

  async addView(input: {
    databaseId: string
    type: DatabaseViewType
    name?: string
  }): Promise<{ viewId: string }> {
    const database = await this.assertDatabaseInOrg(input.databaseId)
    const properties = (database.schema ?? []) as DatabaseProperty[]
    const positions = (
      await this.db
        .select({ position: collectionViewTable.position })
        .from(collectionViewTable)
        .where(eq(collectionViewTable.collectionId, database.id))
    ).map((r) => r.position)

    const viewId = newId('view')

    await this.db.insert(collectionViewTable).values({
      id: viewId,
      collectionId: database.id,
      name: input.name?.trim() || VIEW_DEFAULT_NAMES[input.type],
      type: input.type,
      config: defaultViewConfig(input.type, properties),
      position: keyAtEnd(positions),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await this.notifyPage(database.pageId)

    return { viewId }
  }

  /** Change a view's layout in place, keeping its identity and config. */
  async setViewType(input: {
    viewId: string
    type: DatabaseViewType
  }): Promise<void> {
    const view = await this.assertViewInOrg(input.viewId)
    const database = await this.assertDatabaseInOrg(view.collectionId)
    const properties = (database.schema ?? []) as DatabaseProperty[]

    await this.db
      .update(collectionViewTable)
      .set({
        type: input.type,
        config: defaultViewConfig(
          input.type,
          properties,
          (view.config ?? {}) as CollectionViewConfig,
        ),
        updatedAt: new Date(),
      })
      .where(eq(collectionViewTable.id, view.id))
    await this.notifyPage(database.pageId)

    return
  }

  async setViewDateProperty(input: {
    viewId: string
    datePropertyId: string | null
  }): Promise<void> {
    return this.patchViewConfig(input.viewId, {
      datePropertyId: input.datePropertyId ?? undefined,
    })
  }

  async setViewSorts(input: {
    viewId: string
    sorts: Array<{ propertyId: string; direction: 'asc' | 'desc' }>
  }): Promise<void> {
    return this.patchViewConfig(input.viewId, {
      sorts: input.sorts.map((sort) => ({
        fieldId: sort.propertyId,
        direction: sort.direction,
      })),
    })
  }

  async setViewFilters(input: {
    viewId: string
    filters: Array<{ propertyId: string; value: string }>
  }): Promise<void> {
    return this.patchViewConfig(input.viewId, {
      filters: input.filters as unknown as JsonRecord[],
    })
  }

  async setViewProperties(input: {
    viewId: string
    visiblePropertyIds: string[] | null
  }): Promise<void> {
    return this.patchViewConfig(input.viewId, {
      visibleFieldIds: input.visiblePropertyIds ?? undefined,
    })
  }

  private async patchViewConfig(
    viewId: string,
    patch: Partial<CollectionViewConfig>,
  ): Promise<void> {
    const view = await this.assertViewInOrg(viewId)
    const config = (view.config ?? {}) as CollectionViewConfig

    await this.db
      .update(collectionViewTable)
      .set({ config: { ...config, ...patch }, updatedAt: new Date() })
      .where(eq(collectionViewTable.id, view.id))
    await this.notifyDatabase(view.collectionId)

    return
  }

  async renameView(input: { viewId: string; name: string }): Promise<void> {
    const view = await this.assertViewInOrg(input.viewId)

    await this.db
      .update(collectionViewTable)
      .set({ name: input.name.trim() || 'View', updatedAt: new Date() })
      .where(eq(collectionViewTable.id, view.id))
    await this.notifyDatabase(view.collectionId)

    return
  }

  async deleteView(input: { viewId: string }): Promise<void> {
    const view = await this.assertViewInOrg(input.viewId)
    const remaining = await this.db
      .select({ id: collectionViewTable.id })
      .from(collectionViewTable)
      .where(eq(collectionViewTable.collectionId, view.collectionId))

    if (remaining.length <= 1) {
      throw new WorkspaceRepositoryError(
        'invalid_input',
        'A database must keep at least one view.',
      )
    }

    await this.db
      .delete(collectionViewTable)
      .where(eq(collectionViewTable.id, view.id))
    await this.notifyDatabase(view.collectionId)

    return
  }

  async setViewGroupBy(input: {
    viewId: string
    groupByPropertyId: string | null
  }): Promise<void> {
    const view = await this.assertViewInOrg(input.viewId)
    const config = (view.config ?? {}) as CollectionViewConfig

    await this.db
      .update(collectionViewTable)
      .set({
        config: {
          ...config,
          groupByFieldId: input.groupByPropertyId ?? undefined,
        },
        updatedAt: new Date(),
      })
      .where(eq(collectionViewTable.id, view.id))
    await this.notifyDatabase(view.collectionId)

    return
  }

  // --- Properties --------------------------------------------------------

  async addProperty(input: {
    databaseId: string
    name: string
    type: Exclude<PropertyType, 'title'>
    options?: Array<string | { name: string; color?: string }>
  }): Promise<{ propertyId: string; options?: PropertyOption[] }> {
    const properties = await this.readProperties(input.databaseId)
    const property: DatabaseProperty = {
      id: newId('prop'),
      name: input.name.trim() || 'Property',
      type: input.type,
    }

    if (OPTION_PROPERTY_TYPES.includes(input.type)) {
      const options: PropertyOption[] = []
      for (const entry of input.options ?? []) {
        const seed = typeof entry === 'string' ? { name: entry } : entry
        options.push({
          id: newId('opt'),
          name: seed.name.trim() || 'Option',
          color: seed.color ?? nextOptionColor(options),
        })
      }
      property.options = options
    } else if (input.options?.length) {
      throw new WorkspaceRepositoryError(
        'invalid_input',
        `Only select, multi_select and status columns take options; "${input.type}" does not.`,
      )
    }

    await this.writeProperties(input.databaseId, [...properties, property])

    return property.options
      ? { propertyId: property.id, options: property.options }
      : { propertyId: property.id }
  }

  async updateProperty(input: {
    databaseId: string
    propertyId: string
    name?: string
    type?: Exclude<PropertyType, 'title'>
  }): Promise<void> {
    const properties = await this.readProperties(input.databaseId)
    const property = findColumn(properties, input.databaseId, input.propertyId)

    if (property.type === 'title' && input.type) {
      throw new WorkspaceRepositoryError(
        'invalid_input',
        'The title property type cannot be changed.',
      )
    }

    if (input.name !== undefined) {
      property.name = input.name.trim() || 'Property'
    }

    if (input.type !== undefined && input.type !== property.type) {
      property.type = input.type
      property.options = OPTION_PROPERTY_TYPES.includes(input.type)
        ? (property.options ?? [])
        : undefined
    }

    await this.writeProperties(input.databaseId, properties)

    return
  }

  async deleteProperty(input: {
    databaseId: string
    propertyId: string
  }): Promise<void> {
    const properties = await this.readProperties(input.databaseId)
    const property = properties.find((p) => p.id === input.propertyId)

    if (property?.type === 'title') {
      throw new WorkspaceRepositoryError(
        'invalid_input',
        'The title property cannot be deleted.',
      )
    }

    await this.writeProperties(
      input.databaseId,
      properties.filter((p) => p.id !== input.propertyId),
    )
    await this.stripValueFromRows(input.databaseId, input.propertyId)

    return
  }

  async addPropertyOption(input: {
    databaseId: string
    propertyId: string
    name: string
    // A palette hex; omitted picks the first colour no option uses yet.
    color?: string
  }): Promise<{ optionId: string; option: PropertyOption }> {
    const properties = await this.readProperties(input.databaseId)
    const property = findOptionColumn(
      properties,
      input.databaseId,
      input.propertyId,
    )

    const options = property.options ?? []
    const option: PropertyOption = {
      id: newId('opt'),
      name: input.name.trim() || 'Option',
      color: input.color ?? nextOptionColor(options),
    }
    property.options = [...options, option]

    await this.writeProperties(input.databaseId, properties)

    return { optionId: option.id, option }
  }

  /** Rename and/or recolour a database column option. */
  async updatePropertyOption(input: {
    databaseId: string
    propertyId: string
    optionId: string
    name?: string
    color?: string
  }): Promise<{ option: PropertyOption }> {
    const properties = await this.readProperties(input.databaseId)
    const property = findOptionColumn(
      properties,
      input.databaseId,
      input.propertyId,
    )
    const option = findOption(property, input.optionId)

    if (input.name !== undefined) {
      option.name = input.name.trim() || 'Option'
    }
    if (input.color !== undefined) {
      option.color = input.color
    }
    await this.writeProperties(input.databaseId, properties)

    return { option }
  }

  async renamePropertyOption(input: {
    databaseId: string
    propertyId: string
    optionId: string
    name: string
  }): Promise<void> {
    await this.updatePropertyOption(input)

    return
  }

  async deletePropertyOption(input: {
    databaseId: string
    propertyId: string
    optionId: string
  }): Promise<{ clearedRowCount: number }> {
    const properties = await this.readProperties(input.databaseId)
    const property = findOptionColumn(
      properties,
      input.databaseId,
      input.propertyId,
    )
    findOption(property, input.optionId)

    property.options = (property.options ?? []).filter(
      (o) => o.id !== input.optionId,
    )
    await this.writeProperties(input.databaseId, properties)

    // Clear the removed option from every row's value.
    const rows = await this.db.query.collectionRow.findMany({
      where: eq(collectionRowTable.collectionId, input.databaseId),
    })

    const results = await Promise.all(
      rows.map(async (row) => {
        const values = { ...row.values } as Record<string, CellValue>
        const current = values[input.propertyId]

        if (current === input.optionId) {
          values[input.propertyId] = null
        } else if (Array.isArray(current) && current.includes(input.optionId)) {
          values[input.propertyId] = current.filter(
            (id) => id !== input.optionId,
          )
        } else {
          return false
        }

        await this.db
          .update(collectionRowTable)
          .set({ values: values as JsonRecord, updatedAt: new Date() })
          .where(eq(collectionRowTable.id, row.id))
        return true
      }),
    )

    return { clearedRowCount: results.filter(Boolean).length }
  }

  // --- Rows --------------------------------------------------------------

  async addRow(input: {
    databaseId: string
    values?: Record<string, CellValue>
  }): Promise<{ rowId: string }> {
    await this.assertDatabaseInOrg(input.databaseId)

    const positions = (
      await this.db
        .select({ position: collectionRowTable.position })
        .from(collectionRowTable)
        .where(eq(collectionRowTable.collectionId, input.databaseId))
    ).map((r) => r.position)

    const rowId = newId('row')
    const now = new Date()

    await this.db.insert(collectionRowTable).values({
      id: rowId,
      collectionId: input.databaseId,
      values: (input.values ?? {}) as JsonRecord,
      position: keyAtEnd(positions),
      createdByUserId: this.ctx.userId,
      lastEditedByUserId: this.ctx.userId,
      createdAt: now,
      updatedAt: now,
    })
    await this.notifyDatabase(input.databaseId)

    return { rowId }
  }

  async updateRow(input: {
    rowId: string
    values: Record<string, CellValue>
  }): Promise<void> {
    const row = await this.assertRowInOrg(input.rowId)
    const merged = {
      ...((row.values ?? {}) as Record<string, CellValue>),
      ...input.values,
    }

    await this.db
      .update(collectionRowTable)
      .set({
        values: merged as JsonRecord,
        updatedAt: new Date(),
        lastEditedByUserId: this.ctx.userId,
      })
      .where(eq(collectionRowTable.id, row.id))
    await this.notifyDatabase(row.collectionId)

    return
  }

  async updateRowBody(input: { rowId: string; body: string }): Promise<void> {
    const row = await this.assertRowInOrg(input.rowId)
    const body = input.body.trim() ? input.body : null

    await this.db
      .update(collectionRowTable)
      .set({
        body,
        updatedAt: new Date(),
        lastEditedByUserId: this.ctx.userId,
      })
      .where(eq(collectionRowTable.id, row.id))
    await this.notifyDatabase(row.collectionId)

    return
  }

  async deleteRow(input: { rowId: string }): Promise<void> {
    const row = await this.assertRowInOrg(input.rowId)
    await this.db
      .delete(collectionRowTable)
      .where(eq(collectionRowTable.id, row.id))
    await this.notifyDatabase(row.collectionId)

    return
  }

  /**
   * Archive or unarchive rows. Archived rows keep all their data and can be
   * restored; views and MCP reads just hide them by default. Every id must
   * belong to this workspace — nothing is written if any is unknown.
   */
  async setRowsArchived(input: {
    rowIds: string[]
    archived: boolean
  }): Promise<{ rowIds: string[]; archived: boolean }> {
    const rowIds = [...new Set(input.rowIds)]
    // A join (row → database → org), so this stays on select().
    const found = await this.db
      .select({
        id: collectionRowTable.id,
        collectionId: collectionRowTable.collectionId,
      })
      .from(collectionRowTable)
      .innerJoin(
        collectionTable,
        eq(collectionRowTable.collectionId, collectionTable.id),
      )
      .where(
        and(
          inArray(collectionRowTable.id, rowIds),
          eq(collectionTable.organizationId, this.ctx.organizationId),
        ),
      )

    const missing = rowIds.filter((id) => !found.some((row) => row.id === id))
    if (missing.length > 0) {
      throw new WorkspaceRepositoryError(
        'row_not_found',
        `Row${missing.length > 1 ? 's' : ''} ${missing
          .map((id) => `"${id}"`)
          .join(
            ', ',
          )} ${missing.length > 1 ? 'were' : 'was'} not found in this workspace.`,
      )
    }

    const now = new Date()
    await this.db
      .update(collectionRowTable)
      .set({
        isArchived: input.archived,
        archivedAt: input.archived ? now : null,
        updatedAt: now,
        lastEditedByUserId: this.ctx.userId,
      })
      .where(inArray(collectionRowTable.id, rowIds))

    await Promise.all(
      [...new Set(found.map((row) => row.collectionId))].map((databaseId) =>
        this.notifyDatabase(databaseId),
      ),
    )

    return { rowIds, archived: input.archived }
  }

  // --- Assets ------------------------------------------------------------

  /**
   * Store an already-validated upload in R2 under `assets/<assetId>/<file>`
   * and record it in the asset table for this workspace. Returns the app path
   * (`/api/assets/…`) that image blocks and Markdown bodies reference.
   */
  async uploadAsset(input: {
    fileName: string
    mime: string
    bytes: Uint8Array
  }): Promise<{
    assetId: string
    path: string
    fileName: string
    mime: string
    sizeBytes: number
  }> {
    if (!this.assets) {
      throw new WorkspaceRepositoryError(
        'invalid_input',
        'Asset storage (R2) is not configured on this server.',
      )
    }

    const assetId = crypto.randomUUID()
    const key = buildR2AssetKey({ assetId, fileName: input.fileName })

    await this.assets.put(key, input.bytes, {
      httpMetadata: { contentType: input.mime },
    })
    await this.db.insert(assetTable).values({
      id: assetId,
      organizationId: this.ctx.organizationId,
      r2Key: key,
      mime: input.mime,
      sizeBytes: input.bytes.byteLength,
      uploadedByUserId: this.ctx.userId,
    })

    return {
      assetId,
      path: `/api/${key}`,
      fileName: key.slice(key.lastIndexOf('/') + 1),
      mime: input.mime,
      sizeBytes: input.bytes.byteLength,
    }
  }

  // --- Import / seed -----------------------------------------------------

  async importText(input: {
    title: string
    body: string
    source?: string
  }): Promise<WorkspacePageSummary> {
    const summary = await this.createPage({ title: input.title, icon: '📥' })

    await this.createBlock({
      pageId: summary.id,
      type: 'heading_1',
      content: input.title,
    })
    await this.createBlock({
      pageId: summary.id,
      type: 'quote',
      content: input.body,
    })

    return summary
  }

  async hasPages(): Promise<boolean> {
    const [row] = await this.db
      .select({ id: pageTable.id })
      .from(pageTable)
      .where(eq(pageTable.organizationId, this.ctx.organizationId))
      .limit(1)

    return Boolean(row)
  }

  /** Create a starter page for a brand-new, empty workspace. */
  async seedWelcomePage(): Promise<WorkspacePageSummary> {
    const summary = await this.createPage({
      title: 'Getting started',
      icon: '👋',
    })

    await this.createBlock({
      pageId: summary.id,
      type: 'paragraph',
      content:
        'This is your workspace. Use the + on any block to add text, headings, to-dos and databases. A database holds your data; add table or board views to see it different ways.',
    })
    await this.createBlock({
      pageId: summary.id,
      type: 'to_do',
      content: 'Add your first note',
    })

    const { databaseId } = await this.createBlock({
      pageId: summary.id,
      type: 'database',
      databaseTitle: 'Tasks',
    })

    if (databaseId) {
      const database = await this.assertDatabaseInOrg(databaseId)
      const properties = (database.schema ?? []) as DatabaseProperty[]
      const titleId = titlePropertyId(properties)
      const status = properties.find((p) => p.type === 'status')
      const todo = status?.options?.[0]?.id ?? null
      const doing = status?.options?.[1]?.id ?? null

      await this.addRow({
        databaseId,
        values: {
          [titleId]: 'Draft the plan',
          ...(status && todo ? { [status.id]: todo } : {}),
        },
      })
      await this.addRow({
        databaseId,
        values: {
          [titleId]: 'Build the workspace',
          ...(status && doing ? { [status.id]: doing } : {}),
        },
      })
      await this.addView({ databaseId, type: 'board' })
    }

    return summary
  }

  // --- Internal helpers --------------------------------------------------

  private async createDatabase(
    pageId: string,
    title: string,
    initialView: DatabaseViewType = 'table',
  ): Promise<string> {
    const databaseId = newId('database')
    const now = new Date()
    const properties: DatabaseProperty[] = [
      { id: newId('prop'), name: 'Name', type: 'title' },
      {
        id: newId('prop'),
        name: 'Status',
        type: 'status',
        options: [
          { id: newId('opt'), name: 'To do', color: pickColor(0) },
          { id: newId('opt'), name: 'In progress', color: pickColor(1) },
          { id: newId('opt'), name: 'Done', color: pickColor(2) },
        ],
      },
    ]

    // A calendar needs a date to place rows on, so seed one.
    if (initialView === 'calendar') {
      properties.push({ id: newId('prop'), name: 'Date', type: 'date' })
    }

    await this.db.insert(collectionTable).values({
      id: databaseId,
      organizationId: this.ctx.organizationId,
      pageId,
      title: title.trim() || 'Untitled',
      schema: properties as DbCollectionField[],
      createdAt: now,
      updatedAt: now,
    })

    // The database opens in the view the user picked (table / board / …).
    await this.db.insert(collectionViewTable).values({
      id: newId('view'),
      collectionId: databaseId,
      name: VIEW_DEFAULT_NAMES[initialView],
      type: initialView,
      config: defaultViewConfig(initialView, properties),
      position: keyAtEnd([]),
      createdAt: now,
      updatedAt: now,
    })

    return databaseId
  }

  private async readProperties(
    databaseId: string,
  ): Promise<DatabaseProperty[]> {
    const database = await this.assertDatabaseInOrg(databaseId)

    return ((database.schema ?? []) as DatabaseProperty[]).map((property) => ({
      ...property,
      options: property.options?.map((option) => ({ ...option })),
    }))
  }

  private async writeProperties(
    databaseId: string,
    properties: DatabaseProperty[],
  ): Promise<void> {
    await this.db
      .update(collectionTable)
      .set({ schema: properties as DbCollectionField[], updatedAt: new Date() })
      .where(eq(collectionTable.id, databaseId))
    await this.notifyDatabase(databaseId)
  }

  private async stripValueFromRows(
    databaseId: string,
    propertyId: string,
  ): Promise<void> {
    const rows = await this.db
      .select()
      .from(collectionRowTable)
      .where(eq(collectionRowTable.collectionId, databaseId))

    await Promise.all(
      rows.map((row) => {
        const values = { ...row.values } as Record<string, CellValue>

        if (!(propertyId in values)) {
          return Promise.resolve()
        }

        delete values[propertyId]

        return this.db
          .update(collectionRowTable)
          .set({ values: values as JsonRecord, updatedAt: new Date() })
          .where(eq(collectionRowTable.id, row.id))
      }),
    )
  }

  private async positionForNewBlock(
    pageId: string,
    afterBlockId: string | null,
  ): Promise<string> {
    const blocks = await this.db
      .select({ id: blockTable.id, position: blockTable.position })
      .from(blockTable)
      .where(eq(blockTable.pageId, pageId))
      .orderBy(asc(blockTable.position))

    if (!afterBlockId) {
      return keyAtEnd(blocks.map((b) => b.position))
    }

    const index = blocks.findIndex((b) => b.id === afterBlockId)

    if (index === -1) {
      return keyAtEnd(blocks.map((b) => b.position))
    }

    return generateKeyBetween(
      blocks[index].position,
      blocks[index + 1]?.position ?? null,
    )
  }

  private async touchPage(pageId: string): Promise<void> {
    await this.db
      .update(pageTable)
      .set({ updatedAt: new Date(), lastEditedByUserId: this.ctx.userId })
      .where(eq(pageTable.id, pageId))
    await this.notifyPage(pageId)
  }

  private async assertPageInOrg(pageId: string) {
    const [page] = await this.db
      .select()
      .from(pageTable)
      .where(
        and(
          eq(pageTable.id, pageId),
          eq(pageTable.organizationId, this.ctx.organizationId),
        ),
      )
      .limit(1)

    if (!page) {
      throw new WorkspaceRepositoryError(
        'page_not_found',
        `Page "${pageId}" was not found in this workspace.`,
      )
    }

    return page
  }

  private async assertBlockInOrg(blockId: string) {
    const [row] = await this.db
      .select({ block: blockTable })
      .from(blockTable)
      .innerJoin(pageTable, eq(blockTable.pageId, pageTable.id))
      .where(
        and(
          eq(blockTable.id, blockId),
          eq(pageTable.organizationId, this.ctx.organizationId),
        ),
      )
      .limit(1)

    if (!row) {
      throw new WorkspaceRepositoryError(
        'block_not_found',
        `Block "${blockId}" was not found in this workspace.`,
      )
    }

    return row.block
  }

  private async assertDatabaseInOrg(databaseId: string) {
    const [database] = await this.db
      .select()
      .from(collectionTable)
      .where(
        and(
          eq(collectionTable.id, databaseId),
          eq(collectionTable.organizationId, this.ctx.organizationId),
        ),
      )
      .limit(1)

    if (!database) {
      throw new WorkspaceRepositoryError(
        'database_not_found',
        `Database "${databaseId}" was not found in this workspace.`,
      )
    }

    return database
  }

  private async assertViewInOrg(viewId: string) {
    const [row] = await this.db
      .select({ view: collectionViewTable })
      .from(collectionViewTable)
      .innerJoin(
        collectionTable,
        eq(collectionViewTable.collectionId, collectionTable.id),
      )
      .where(
        and(
          eq(collectionViewTable.id, viewId),
          eq(collectionTable.organizationId, this.ctx.organizationId),
        ),
      )
      .limit(1)

    if (!row) {
      throw new WorkspaceRepositoryError(
        'view_not_found',
        `View "${viewId}" was not found in this workspace.`,
      )
    }

    return row.view
  }

  private async assertRowInOrg(rowId: string) {
    const [row] = await this.db
      .select({ row: collectionRowTable })
      .from(collectionRowTable)
      .innerJoin(
        collectionTable,
        eq(collectionRowTable.collectionId, collectionTable.id),
      )
      .where(
        and(
          eq(collectionRowTable.id, rowId),
          eq(collectionTable.organizationId, this.ctx.organizationId),
        ),
      )
      .limit(1)

    if (!row) {
      throw new WorkspaceRepositoryError(
        'row_not_found',
        `Row "${rowId}" was not found in this workspace.`,
      )
    }

    return row.row
  }
}

/** A database column by id, or a `property_not_found` error naming it. */
function findColumn(
  properties: DatabaseProperty[],
  databaseId: string,
  propertyId: string,
): DatabaseProperty {
  const property = properties.find((p) => p.id === propertyId)

  if (!property) {
    throw new WorkspaceRepositoryError(
      'property_not_found',
      `Column "${propertyId}" was not found on database "${databaseId}". Columns: ${properties
        .map((p) => `"${p.name}" (${p.id})`)
        .join(', ')}.`,
    )
  }

  return property
}

/** A select / multi_select / status column, or a clear error. */
function findOptionColumn(
  properties: DatabaseProperty[],
  databaseId: string,
  propertyId: string,
): DatabaseProperty {
  const property = findColumn(properties, databaseId, propertyId)

  if (!OPTION_PROPERTY_TYPES.includes(property.type)) {
    throw new WorkspaceRepositoryError(
      'invalid_input',
      `Column "${property.name}" (${property.id}) is a ${property.type} column; only select, multi_select and status columns have options.`,
    )
  }

  return property
}

function findOption(
  property: DatabaseProperty,
  optionId: string,
): PropertyOption {
  const option = property.options?.find((o) => o.id === optionId)

  if (!option) {
    throw new WorkspaceRepositoryError(
      'option_not_found',
      `Option "${optionId}" was not found on column "${property.name}" (${property.id}). Options: ${(
        property.options ?? []
      )
        .map((o) => `"${o.name}" (${o.id})`)
        .join(', ')}.`,
    )
  }

  return option
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k) ?? []
    list.push(item)
    map.set(k, list)
  }
  return map
}

function toDatabaseView(
  view: typeof collectionViewTable.$inferSelect,
  properties: DatabaseProperty[],
): DatabaseView {
  const config = (view.config ?? {}) as CollectionViewConfig
  const groupByPropertyId =
    view.type === 'board'
      ? (config.groupByFieldId ?? firstGroupableProperty(properties))
      : (config.groupByFieldId ?? null)
  const datePropertyId =
    view.type === 'calendar'
      ? (config.datePropertyId ?? firstDateProperty(properties))
      : (config.datePropertyId ?? null)

  return {
    id: view.id,
    name: view.name,
    type: view.type as DatabaseViewType,
    position: view.position,
    groupByPropertyId,
    datePropertyId,
    visiblePropertyIds: config.visibleFieldIds ?? null,
    sorts: (config.sorts ?? []).map((sort) => ({
      propertyId: sort.fieldId,
      direction: sort.direction,
    })),
    filters: (config.filters ?? []) as unknown as Array<{
      propertyId: string
      value: string
    }>,
  }
}

function toDatabaseRow(
  row: typeof collectionRowTable.$inferSelect,
): DatabaseRow {
  return {
    id: row.id,
    position: row.position,
    values: (row.values ?? {}) as Record<string, CellValue>,
    body: row.body ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    pageId: row.pageId ?? null,
    isArchived: Boolean(row.isArchived),
    archivedAt: row.archivedAt ? toIso(row.archivedAt) : null,
  }
}

function toPageSummary(
  page: typeof pageTable.$inferSelect,
): WorkspacePageSummary {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    icon: page.icon ?? DEFAULT_ICON,
    parentPageId: page.parentPageId ?? null,
    position: page.position,
    createdAt: toIso(page.createdAt),
    updatedAt: toIso(page.updatedAt),
  }
}

function toWorkspaceBlock(
  block: typeof blockTable.$inferSelect,
): WorkspaceBlock {
  const properties = (block.properties ?? {}) as BlockProperties

  return {
    id: block.id,
    type: block.type as WorkspaceBlockType,
    content: block.content,
    checked: Boolean(properties.checked),
    databaseId: block.collectionId ?? null,
    position: block.position,
    version: block.version,
  }
}

export function createWorkspaceRepository(
  db: AppDatabase,
  ctx: WorkspaceContext,
  notifier?: WorkspaceNotifier,
  assets?: R2Bucket,
): WorkspaceRepository {
  return new WorkspaceRepository(db, ctx, notifier, assets)
}
