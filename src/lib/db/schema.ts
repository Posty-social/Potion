import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core'

export * from './auth.schema'
import { organization, user } from './auth.schema'

export type BlockType =
  | 'paragraph'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'bulleted_list'
  | 'numbered_list'
  | 'to_do'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'code'
  | 'divider'
  | 'image'
  | 'file'
  | 'bookmark'
  | 'page_link'
  | 'column_list'
  | 'column'
  | 'database'

export type CollectionFieldType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'checkbox'
  | 'person'
  | 'url'
  | 'email'
  | 'files'
  | 'relation'
  | 'rollup'

export type CollectionViewType =
  | 'table'
  | 'board'
  | 'list'
  | 'gallery'
  | 'calendar'

export type JsonRecord = Record<string, unknown>

export type CollectionField = {
  id: string
  name: string
  type: CollectionFieldType
  options?: Array<{ id: string; name: string; color?: string }>
}

export type CollectionViewConfig = {
  groupByFieldId?: string
  datePropertyId?: string
  groupOrder?: string[]
  visibleFieldIds?: string[]
  filters?: JsonRecord[]
  sorts?: Array<{ fieldId: string; direction: 'asc' | 'desc' }>
}

const timestamp = (name: string) =>
  integer(name, { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)

const nullableTimestamp = (name: string) =>
  integer(name, { mode: 'timestamp_ms' })

const jsonText = <T>(name: string) => text(name, { mode: 'json' }).$type<T>()

export const asset = sqliteTable(
  'asset',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    r2Key: text('r2_key').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    uploadedByUserId: text('uploaded_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    index('asset_org_id_idx').on(table.organizationId),
    uniqueIndex('asset_r2_key_idx').on(table.r2Key),
  ],
)

export const page = sqliteTable(
  'page',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    parentPageId: text('parent_page_id').references(
      (): AnySQLiteColumn => page.id,
      { onDelete: 'cascade' },
    ),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    icon: text('icon'),
    coverAssetId: text('cover_asset_id').references(() => asset.id, {
      onDelete: 'set null',
    }),
    // Notion-style page properties. The property *definitions* (name, type,
    // options) live in the shared `workspace_property` catalog so pages reuse
    // each other's properties and select options; this column stores the
    // ordered list of attached catalog property ids. (Legacy rows may hold full
    // definition objects — the repository backfills those into the catalog on
    // read.) Values are keyed by property id.
    properties: jsonText<string[]>('properties')
      .notNull()
      .default(sql`'[]'`),
    propertyValues: jsonText<JsonRecord>('property_values')
      .notNull()
      .default(sql`'{}'`),
    position: text('position').notNull(),
    isArchived: integer('is_archived', { mode: 'boolean' })
      .notNull()
      .default(false),
    archivedAt: nullableTimestamp('archived_at'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lastEditedByUserId: text('last_edited_by_user_id').references(
      () => user.id,
      {
        onDelete: 'set null',
      },
    ),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    index('page_org_parent_position_idx').on(
      table.organizationId,
      table.parentPageId,
      table.position,
    ),
    uniqueIndex('page_org_slug_idx').on(table.organizationId, table.slug),
  ],
)

// Workspace-wide catalog of Notion-style property definitions shared across
// pages. A page attaches a property by id (see `page.properties`); editing a
// property's name/type/options here is reflected on every page that uses it.
export const workspaceProperty = sqliteTable(
  'workspace_property',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').notNull(),
    options: jsonText<NonNullable<CollectionField['options']>>('options')
      .notNull()
      .default(sql`'[]'`),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [index('workspace_property_org_id_idx').on(table.organizationId)],
)

export const collection = sqliteTable(
  'collection',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    pageId: text('page_id').references(() => page.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    schema: jsonText<CollectionField[]>('schema')
      .notNull()
      .default(sql`'[]'`),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    index('collection_org_id_idx').on(table.organizationId),
    index('collection_page_id_idx').on(table.pageId),
  ],
)

export const block = sqliteTable(
  'block',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => page.id, { onDelete: 'cascade' }),
    parentBlockId: text('parent_block_id').references(
      (): AnySQLiteColumn => block.id,
      { onDelete: 'cascade' },
    ),
    type: text('type').$type<BlockType>().notNull(),
    content: text('content').notNull().default(''),
    properties: jsonText<JsonRecord>('properties')
      .notNull()
      .default(sql`'{}'`),
    collectionId: text('collection_id').references(() => collection.id, {
      onDelete: 'cascade',
    }),
    position: text('position').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lastEditedByUserId: text('last_edited_by_user_id').references(
      () => user.id,
      {
        onDelete: 'set null',
      },
    ),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    index('block_page_parent_position_idx').on(
      table.pageId,
      table.parentBlockId,
      table.position,
    ),
    index('block_collection_id_idx').on(table.collectionId),
  ],
)

export const collectionRow = sqliteTable(
  'collection_row',
  {
    id: text('id').primaryKey(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collection.id, { onDelete: 'cascade' }),
    values: jsonText<JsonRecord>('values')
      .notNull()
      .default(sql`'{}'`),
    // Markdown body for the row's "page" — shown below its properties when the
    // row is opened in the side peek. Null until the user writes something.
    body: text('body'),
    position: text('position').notNull(),
    pageId: text('page_id').references(() => page.id, { onDelete: 'set null' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lastEditedByUserId: text('last_edited_by_user_id').references(
      () => user.id,
      {
        onDelete: 'set null',
      },
    ),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    index('collection_row_collection_position_idx').on(
      table.collectionId,
      table.position,
    ),
  ],
)

export const collectionView = sqliteTable(
  'collection_view',
  {
    id: text('id').primaryKey(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collection.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type').$type<CollectionViewType>().notNull(),
    config: jsonText<CollectionViewConfig>('config')
      .notNull()
      .default(sql`'{}'`),
    position: text('position').notNull(),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    index('collection_view_collection_position_idx').on(
      table.collectionId,
      table.position,
    ),
  ],
)

export const comment = sqliteTable(
  'comment',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    pageId: text('page_id')
      .notNull()
      .references(() => page.id, { onDelete: 'cascade' }),
    blockId: text('block_id').references(() => block.id, {
      onDelete: 'cascade',
    }),
    parentCommentId: text('parent_comment_id').references(
      (): AnySQLiteColumn => comment.id,
      { onDelete: 'cascade' },
    ),
    authorUserId: text('author_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    resolvedAt: nullableTimestamp('resolved_at'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    index('comment_page_block_idx').on(table.pageId, table.blockId),
    index('comment_org_id_idx').on(table.organizationId),
  ],
)

export const pagePermission = sqliteTable(
  'page_permission',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => page.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type', {
      enum: ['user', 'organization', 'role'],
    }).notNull(),
    subjectId: text('subject_id').notNull(),
    access: text('access', { enum: ['read', 'write', 'full'] }).notNull(),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    uniqueIndex('page_permission_subject_idx').on(
      table.pageId,
      table.subjectType,
      table.subjectId,
    ),
    index('page_permission_org_id_idx').on(table.organizationId),
  ],
)

export const publicLink = sqliteTable(
  'public_link',
  {
    id: text('id').primaryKey(),
    pageId: text('page_id')
      .notNull()
      .references(() => page.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    includeChildPages: integer('include_child_pages', { mode: 'boolean' })
      .notNull()
      .default(false),
    expiresAt: nullableTimestamp('expires_at'),
    revokedAt: nullableTimestamp('revoked_at'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at'),
  },
  (table) => [
    uniqueIndex('public_link_token_idx').on(table.token),
    index('public_link_page_id_idx').on(table.pageId),
    index('public_link_org_id_idx').on(table.organizationId),
  ],
)
