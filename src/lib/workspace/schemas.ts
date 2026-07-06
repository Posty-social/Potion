import { z } from 'zod'

import { sanitizeImportedText } from './import'

export const collectionViewSchema = z
  .enum(['table', 'kanban', 'calendar', 'gallery', 'list'])
  .catch('table')

const importedTextSchema = (maxLength: number) =>
  z
    .string()
    .transform((value) => sanitizeImportedText(value))
    .pipe(z.string().min(1).max(maxLength))

export const pageSearchSchema = z.object({
  view: collectionViewSchema,
  groupBy: z.string().optional(),
  filter: z.string().optional(),
  sort: z.string().optional(),
})

export const getPageSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})

export const updateBlockSchema = z.object({
  pageId: z.string().min(1),
  blockId: z.string().min(1),
  content: z.string().max(20_000),
  version: z.number().int().min(1),
})

export const importPrivateChatSchema = z.object({
  title: importedTextSchema(120),
  transcript: importedTextSchema(100_000),
  source: importedTextSchema(120).optional(),
})

export type PageSearch = z.infer<typeof pageSearchSchema>
export type CollectionView = z.infer<typeof collectionViewSchema>
export type UpdateBlockInput = z.infer<typeof updateBlockSchema>
export type ImportPrivateChatInput = z.infer<typeof importPrivateChatSchema>
