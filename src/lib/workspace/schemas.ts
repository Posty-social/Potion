import { z } from 'zod'

import { sanitizeImportedText } from './import'

const importedTextSchema = (maxLength: number) =>
  z
    .string()
    .transform((value) => sanitizeImportedText(value))
    .pipe(z.string().min(1).max(maxLength))

const id = z.string().min(1).max(120)

export const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const blockTypeSchema = z.enum([
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'to_do',
  'quote',
  'callout',
  'divider',
  'database',
])

// `title` is created implicitly with each database and can't be added/removed.
export const propertyTypeSchema = z.enum([
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'person',
  'checkbox',
  'url',
  'email',
  'phone',
  'created_time',
  'last_edited_time',
])

export const viewTypeSchema = z.enum([
  'table',
  'board',
  'list',
  'gallery',
  'calendar',
])

export const sortDirectionSchema = z.enum(['asc', 'desc'])

export const cellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
])

export const cellValuesSchema = z.record(z.string(), cellValueSchema)

// --- Page ----------------------------------------------------------------

export const getPageSchema = z.object({ slug: slugSchema })

export const createPageSchema = z.object({
  title: z.string().min(1).max(120),
  parentPageId: id.optional(),
})

export const renamePageSchema = z.object({
  pageId: id,
  title: z.string().min(1).max(120),
})
export const setPageIconSchema = z.object({
  pageId: id,
  icon: z.string().min(1).max(16),
})
export const deletePageSchema = z.object({ pageId: id })

// --- Blocks --------------------------------------------------------------

export const createBlockSchema = z.object({
  pageId: id,
  type: blockTypeSchema,
  afterBlockId: id.optional(),
  content: z.string().max(20_000).optional(),
  databaseTitle: z.string().min(1).max(120).optional(),
  // For database blocks: which view the new database opens in.
  initialView: viewTypeSchema.optional(),
})

export const updateBlockSchema = z.object({
  pageId: z.string().min(1),
  blockId: z.string().min(1),
  content: z.string().max(20_000),
  version: z.number().int().min(1),
})

export const setBlockCheckedSchema = z.object({
  blockId: id,
  checked: z.boolean(),
})
export const deleteBlockSchema = z.object({ blockId: id })

// --- Database ------------------------------------------------------------

export const renameDatabaseSchema = z.object({
  databaseId: id,
  title: z.string().min(1).max(120),
})

// Views
export const addViewSchema = z.object({
  databaseId: id,
  type: viewTypeSchema,
  name: z.string().min(1).max(80).optional(),
})
export const renameViewSchema = z.object({
  viewId: id,
  name: z.string().min(1).max(80),
})
export const deleteViewSchema = z.object({ viewId: id })
export const setViewTypeSchema = z.object({ viewId: id, type: viewTypeSchema })
export const setViewGroupBySchema = z.object({
  viewId: id,
  groupByPropertyId: id.nullable(),
})
export const setViewDatePropertySchema = z.object({
  viewId: id,
  datePropertyId: id.nullable(),
})
export const setViewSortsSchema = z.object({
  viewId: id,
  sorts: z.array(z.object({ propertyId: id, direction: sortDirectionSchema })),
})
export const setViewFiltersSchema = z.object({
  viewId: id,
  filters: z.array(z.object({ propertyId: id, value: z.string().max(200) })),
})
export const setViewPropertiesSchema = z.object({
  viewId: id,
  visiblePropertyIds: z.array(id).nullable(),
})

// Properties
export const addPropertySchema = z.object({
  databaseId: id,
  name: z.string().min(1).max(80),
  type: propertyTypeSchema,
})
export const updatePropertySchema = z.object({
  databaseId: id,
  propertyId: id,
  name: z.string().min(1).max(80).optional(),
  type: propertyTypeSchema.optional(),
})
export const deletePropertySchema = z.object({ databaseId: id, propertyId: id })

// Property options (select / multi_select / status)
export const addPropertyOptionSchema = z.object({
  databaseId: id,
  propertyId: id,
  name: z.string().min(1).max(80),
})
export const renamePropertyOptionSchema = z.object({
  databaseId: id,
  propertyId: id,
  optionId: id,
  name: z.string().min(1).max(80),
})
export const deletePropertyOptionSchema = z.object({
  databaseId: id,
  propertyId: id,
  optionId: id,
})

// Rows
export const addRowSchema = z.object({
  databaseId: id,
  values: cellValuesSchema.optional(),
})
export const updateRowSchema = z.object({ rowId: id, values: cellValuesSchema })
export const updateRowBodySchema = z.object({
  rowId: id,
  body: z.string().max(100_000),
})
export const deleteRowSchema = z.object({ rowId: id })

// --- Page properties -----------------------------------------------------

export const addPagePropertySchema = z.object({
  pageId: id,
  name: z.string().min(1).max(80),
  type: propertyTypeSchema,
  // Client-generated id (optional) so optimistic UI knows the id upfront.
  propertyId: id.optional(),
})
export const updatePagePropertySchema = z.object({
  pageId: id,
  propertyId: id,
  name: z.string().min(1).max(80).optional(),
  type: propertyTypeSchema.optional(),
})
export const attachPagePropertySchema = z.object({ pageId: id, propertyId: id })
export const deletePagePropertySchema = z.object({ pageId: id, propertyId: id })
export const setPagePropertyValueSchema = z.object({
  pageId: id,
  propertyId: id,
  value: cellValueSchema,
})
export const addPagePropertyOptionSchema = z.object({
  pageId: id,
  propertyId: id,
  name: z.string().min(1).max(80),
  // Client-generated id (optional) so optimistic UI knows the id upfront.
  optionId: id.optional(),
})
export const renamePagePropertyOptionSchema = z.object({
  pageId: id,
  propertyId: id,
  optionId: id,
  name: z.string().min(1).max(80),
})
export const deletePagePropertyOptionSchema = z.object({
  pageId: id,
  propertyId: id,
  optionId: id,
})

// --- Workspace property catalog (shared definitions, no page context) ------

export const updateCatalogPropertySchema = z.object({
  propertyId: id,
  name: z.string().min(1).max(80).optional(),
  type: propertyTypeSchema.optional(),
})
export const deleteCatalogPropertySchema = z.object({ propertyId: id })
export const addCatalogPropertyOptionSchema = z.object({
  propertyId: id,
  name: z.string().min(1).max(80),
  optionId: id.optional(),
})
export const renameCatalogPropertyOptionSchema = z.object({
  propertyId: id,
  optionId: id,
  name: z.string().min(1).max(80),
})
export const deleteCatalogPropertyOptionSchema = z.object({
  propertyId: id,
  optionId: id,
})

// --- Import --------------------------------------------------------------

export const importTextSchema = z.object({
  title: importedTextSchema(120),
  body: importedTextSchema(100_000),
  source: importedTextSchema(120).optional(),
})

export type CreatePageInput = z.infer<typeof createPageSchema>
export type CreateBlockInput = z.infer<typeof createBlockSchema>
export type UpdateBlockInput = z.infer<typeof updateBlockSchema>
export type ImportTextInput = z.infer<typeof importTextSchema>
