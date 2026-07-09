import { and, asc, eq, inArray, isNull, like, or } from 'drizzle-orm'

import type { AppDatabase } from '#/lib/db/connection'
import {
  block as blockTable,
  collection as collectionTable,
  collectionRow as collectionRowTable,
  collectionView as collectionViewTable,
  page as pageTable,
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
  type CellValue,
  type DatabaseProperty,
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

export type WorkspaceBlockUpdate = {
  ok: true
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
  ) {}

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

  private async assemblePage(
    pageRow: typeof pageTable.$inferSelect,
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

    const databases = await this.loadDatabases(databaseIds, blocks)
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
          rows: (rowsByDb.get(collection.id) ?? []).map((row) => ({
            id: row.id,
            position: row.position,
            values: (row.values ?? {}) as Record<string, CellValue>,
            body: row.body ?? null,
            createdAt: toIso(row.createdAt),
            updatedAt: toIso(row.updatedAt),
            pageId: row.pageId ?? null,
          })),
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

    return { ...toPageSummary(page), title, updatedAt: now.toISOString() }
  }

  async setPageIcon(input: {
    pageId: string
    icon: string
  }): Promise<{ ok: true }> {
    const page = await this.assertPageInOrg(input.pageId)

    await this.db
      .update(pageTable)
      .set({ icon: input.icon, updatedAt: new Date() })
      .where(eq(pageTable.id, page.id))

    return { ok: true }
  }

  async deletePage(input: { pageId: string }): Promise<{ ok: true }> {
    const page = await this.assertPageInOrg(input.pageId)
    await this.db.delete(pageTable).where(eq(pageTable.id, page.id))

    return { ok: true }
  }

  // --- Page properties ---------------------------------------------------
  // Notion-style properties shown at the top of a page. Property *definitions*
  // (name, type, options) live in the shared `workspace_property` catalog so
  // pages reuse each other's properties and select options; a page's
  // `properties` column stores the ordered ids of the catalog properties it has
  // attached, and `propertyValues` holds this page's values keyed by that id.
  // Editing a definition (rename/retype/options) is therefore shared across
  // every page that attaches it; deleting a property only *detaches* it here.

  /** Every shared property definition in the workspace, for the picker. */
  async listWorkspaceProperties(): Promise<DatabaseProperty[]> {
    const rows = await this.db
      .select()
      .from(workspacePropertyTable)
      .where(eq(workspacePropertyTable.organizationId, this.ctx.organizationId))
      .orderBy(asc(workspacePropertyTable.name))

    return rows.map(catalogRowToProperty)
  }

  async addPageProperty(input: {
    pageId: string
    name: string
    type: Exclude<PropertyType, 'title'>
  }): Promise<{ propertyId: string }> {
    const page = await this.assertPageInOrg(input.pageId)
    const propertyId = newId('prop')

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
  }): Promise<{ ok: true }> {
    const page = await this.assertPageInOrg(input.pageId)
    await this.getCatalogProperty(input.propertyId)

    const ids = await this.attachedIds(page)
    if (!ids.includes(input.propertyId)) {
      await this.writeAttachedIds(page.id, [...ids, input.propertyId])
    }

    return { ok: true }
  }

  async updatePageProperty(input: {
    pageId: string
    propertyId: string
    name?: string
    type?: Exclude<PropertyType, 'title'>
  }): Promise<{ ok: true }> {
    await this.assertPageInOrg(input.pageId)
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

    return { ok: true }
  }

  async deletePageProperty(input: {
    pageId: string
    propertyId: string
  }): Promise<{ ok: true }> {
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

    return { ok: true }
  }

  async setPagePropertyValue(input: {
    pageId: string
    propertyId: string
    value: CellValue
  }): Promise<{ ok: true }> {
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

    return { ok: true }
  }

  async addPagePropertyOption(input: {
    pageId: string
    propertyId: string
    name: string
  }): Promise<{ optionId: string }> {
    const row = await this.getCatalogProperty(input.propertyId)

    if (!OPTION_PROPERTY_TYPES.includes(row.type as PropertyType)) {
      throw new WorkspaceRepositoryError(
        'property_not_found',
        'Option property not found.',
      )
    }

    const options = row.options ?? []
    const option: PropertyOption = {
      id: newId('opt'),
      name: input.name.trim() || 'Option',
      color: pickColor(options.length),
    }

    await this.writeCatalogOptions(input.propertyId, [...options, option])

    return { optionId: option.id }
  }

  async renamePagePropertyOption(input: {
    pageId: string
    propertyId: string
    optionId: string
    name: string
  }): Promise<{ ok: true }> {
    const row = await this.getCatalogProperty(input.propertyId)
    const options = (row.options ?? []).map((option) =>
      option.id === input.optionId
        ? { ...option, name: input.name.trim() || 'Option' }
        : option,
    )

    if (!options.some((option) => option.id === input.optionId)) {
      throw new WorkspaceRepositoryError(
        'property_not_found',
        'Option not found.',
      )
    }

    await this.writeCatalogOptions(input.propertyId, options)

    return { ok: true }
  }

  async deletePagePropertyOption(input: {
    pageId: string
    propertyId: string
    optionId: string
  }): Promise<{ ok: true }> {
    const row = await this.getCatalogProperty(input.propertyId)
    await this.writeCatalogOptions(
      input.propertyId,
      (row.options ?? []).filter((option) => option.id !== input.optionId),
    )

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

    return { ok: true }
  }

  /** Load one catalog property, scoped to this workspace. */
  private async getCatalogProperty(
    propertyId: string,
  ): Promise<typeof workspacePropertyTable.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(workspacePropertyTable)
      .where(
        and(
          eq(workspacePropertyTable.id, propertyId),
          eq(workspacePropertyTable.organizationId, this.ctx.organizationId),
        ),
      )
      .limit(1)

    if (!row) {
      throw new WorkspaceRepositoryError(
        'property_not_found',
        'Property not found.',
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

    const rows = await this.db
      .select()
      .from(workspacePropertyTable)
      .where(
        and(
          eq(workspacePropertyTable.organizationId, this.ctx.organizationId),
          inArray(workspacePropertyTable.id, ids),
        ),
      )
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
        'Workspace block was not found.',
      )
    }

    if (input.version !== block.version) {
      throw new WorkspaceRepositoryError(
        'version_conflict',
        'Workspace block has changed since it was loaded.',
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
      ok: true,
      pageId: page.id,
      blockId: block.id,
      content: input.content,
      version: nextVersion,
    }
  }

  async setBlockChecked(input: {
    blockId: string
    checked: boolean
  }): Promise<{ ok: true }> {
    const block = await this.assertBlockInOrg(input.blockId)
    const properties = (block.properties ?? {}) as BlockProperties

    await this.db
      .update(blockTable)
      .set({
        properties: { ...properties, checked: input.checked } as JsonRecord,
        updatedAt: new Date(),
      })
      .where(eq(blockTable.id, block.id))

    return { ok: true }
  }

  async deleteBlock(input: { blockId: string }): Promise<{ ok: true }> {
    const block = await this.assertBlockInOrg(input.blockId)

    if (block.type === 'database' && block.collectionId) {
      // Deleting the database cascades to its rows, views and this block.
      await this.db
        .delete(collectionTable)
        .where(eq(collectionTable.id, block.collectionId))
    } else {
      await this.db.delete(blockTable).where(eq(blockTable.id, block.id))
    }

    await this.touchPage(block.pageId)

    return { ok: true }
  }

  // --- Database ----------------------------------------------------------

  async renameDatabase(input: {
    databaseId: string
    title: string
  }): Promise<{ ok: true }> {
    const database = await this.assertDatabaseInOrg(input.databaseId)

    await this.db
      .update(collectionTable)
      .set({ title: input.title.trim() || 'Untitled', updatedAt: new Date() })
      .where(eq(collectionTable.id, database.id))

    return { ok: true }
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

    return { viewId }
  }

  /** Change a view's layout in place, keeping its identity and config. */
  async setViewType(input: {
    viewId: string
    type: DatabaseViewType
  }): Promise<{ ok: true }> {
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

    return { ok: true }
  }

  async setViewDateProperty(input: {
    viewId: string
    datePropertyId: string | null
  }): Promise<{ ok: true }> {
    return this.patchViewConfig(input.viewId, {
      datePropertyId: input.datePropertyId ?? undefined,
    })
  }

  async setViewSorts(input: {
    viewId: string
    sorts: Array<{ propertyId: string; direction: 'asc' | 'desc' }>
  }): Promise<{ ok: true }> {
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
  }): Promise<{ ok: true }> {
    return this.patchViewConfig(input.viewId, {
      filters: input.filters as unknown as JsonRecord[],
    })
  }

  async setViewProperties(input: {
    viewId: string
    visiblePropertyIds: string[] | null
  }): Promise<{ ok: true }> {
    return this.patchViewConfig(input.viewId, {
      visibleFieldIds: input.visiblePropertyIds ?? undefined,
    })
  }

  private async patchViewConfig(
    viewId: string,
    patch: Partial<CollectionViewConfig>,
  ): Promise<{ ok: true }> {
    const view = await this.assertViewInOrg(viewId)
    const config = (view.config ?? {}) as CollectionViewConfig

    await this.db
      .update(collectionViewTable)
      .set({ config: { ...config, ...patch }, updatedAt: new Date() })
      .where(eq(collectionViewTable.id, view.id))

    return { ok: true }
  }

  async renameView(input: {
    viewId: string
    name: string
  }): Promise<{ ok: true }> {
    const view = await this.assertViewInOrg(input.viewId)

    await this.db
      .update(collectionViewTable)
      .set({ name: input.name.trim() || 'View', updatedAt: new Date() })
      .where(eq(collectionViewTable.id, view.id))

    return { ok: true }
  }

  async deleteView(input: { viewId: string }): Promise<{ ok: true }> {
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

    return { ok: true }
  }

  async setViewGroupBy(input: {
    viewId: string
    groupByPropertyId: string | null
  }): Promise<{ ok: true }> {
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

    return { ok: true }
  }

  // --- Properties --------------------------------------------------------

  async addProperty(input: {
    databaseId: string
    name: string
    type: Exclude<PropertyType, 'title'>
  }): Promise<{ propertyId: string }> {
    const properties = await this.readProperties(input.databaseId)
    const property: DatabaseProperty = {
      id: newId('prop'),
      name: input.name.trim() || 'Property',
      type: input.type,
    }

    if (OPTION_PROPERTY_TYPES.includes(input.type)) {
      property.options = []
    }

    await this.writeProperties(input.databaseId, [...properties, property])

    return { propertyId: property.id }
  }

  async updateProperty(input: {
    databaseId: string
    propertyId: string
    name?: string
    type?: Exclude<PropertyType, 'title'>
  }): Promise<{ ok: true }> {
    const properties = await this.readProperties(input.databaseId)
    const property = properties.find((p) => p.id === input.propertyId)

    if (!property) {
      throw new WorkspaceRepositoryError(
        'property_not_found',
        'Property not found.',
      )
    }

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

    return { ok: true }
  }

  async deleteProperty(input: {
    databaseId: string
    propertyId: string
  }): Promise<{ ok: true }> {
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

    return { ok: true }
  }

  async addPropertyOption(input: {
    databaseId: string
    propertyId: string
    name: string
  }): Promise<{ optionId: string }> {
    const properties = await this.readProperties(input.databaseId)
    const property = properties.find((p) => p.id === input.propertyId)

    if (!property || !OPTION_PROPERTY_TYPES.includes(property.type)) {
      throw new WorkspaceRepositoryError(
        'property_not_found',
        'Option property not found.',
      )
    }

    const options = property.options ?? []
    const option: PropertyOption = {
      id: newId('opt'),
      name: input.name.trim() || 'Option',
      color: pickColor(options.length),
    }
    property.options = [...options, option]

    await this.writeProperties(input.databaseId, properties)

    return { optionId: option.id }
  }

  async renamePropertyOption(input: {
    databaseId: string
    propertyId: string
    optionId: string
    name: string
  }): Promise<{ ok: true }> {
    const properties = await this.readProperties(input.databaseId)
    const option = properties
      .find((p) => p.id === input.propertyId)
      ?.options?.find((o) => o.id === input.optionId)

    if (!option) {
      throw new WorkspaceRepositoryError(
        'property_not_found',
        'Option not found.',
      )
    }

    option.name = input.name.trim() || 'Option'
    await this.writeProperties(input.databaseId, properties)

    return { ok: true }
  }

  async deletePropertyOption(input: {
    databaseId: string
    propertyId: string
    optionId: string
  }): Promise<{ ok: true }> {
    const properties = await this.readProperties(input.databaseId)
    const property = properties.find((p) => p.id === input.propertyId)

    if (!property?.options) {
      throw new WorkspaceRepositoryError(
        'property_not_found',
        'Option not found.',
      )
    }

    property.options = property.options.filter((o) => o.id !== input.optionId)
    await this.writeProperties(input.databaseId, properties)

    // Clear the removed option from every row's value.
    const rows = await this.db
      .select()
      .from(collectionRowTable)
      .where(eq(collectionRowTable.collectionId, input.databaseId))

    await Promise.all(
      rows.map((row) => {
        const values = { ...row.values } as Record<string, CellValue>
        const current = values[input.propertyId]
        let changed = false

        if (current === input.optionId) {
          values[input.propertyId] = null
          changed = true
        } else if (Array.isArray(current) && current.includes(input.optionId)) {
          values[input.propertyId] = current.filter(
            (id) => id !== input.optionId,
          )
          changed = true
        }

        return changed
          ? this.db
              .update(collectionRowTable)
              .set({ values: values as JsonRecord, updatedAt: new Date() })
              .where(eq(collectionRowTable.id, row.id))
          : Promise.resolve()
      }),
    )

    return { ok: true }
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

    return { rowId }
  }

  async updateRow(input: {
    rowId: string
    values: Record<string, CellValue>
  }): Promise<{ ok: true }> {
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

    return { ok: true }
  }

  async updateRowBody(input: {
    rowId: string
    body: string
  }): Promise<{ ok: true }> {
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

    return { ok: true }
  }

  async deleteRow(input: { rowId: string }): Promise<{ ok: true }> {
    const row = await this.assertRowInOrg(input.rowId)
    await this.db
      .delete(collectionRowTable)
      .where(eq(collectionRowTable.id, row.id))

    return { ok: true }
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
        'Workspace page was not found.',
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
        'Workspace block was not found.',
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
        'Database was not found.',
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
      throw new WorkspaceRepositoryError('view_not_found', 'View not found.')
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
      throw new WorkspaceRepositoryError('row_not_found', 'Row not found.')
    }

    return row.row
  }
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
): WorkspaceRepository {
  return new WorkspaceRepository(db, ctx)
}
