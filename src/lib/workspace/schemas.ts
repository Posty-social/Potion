import { z } from 'zod'

export const collectionViewSchema = z
  .enum(['table', 'kanban', 'calendar', 'gallery', 'list'])
  .catch('table')

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

export type PageSearch = z.infer<typeof pageSearchSchema>
export type CollectionView = z.infer<typeof collectionViewSchema>
export type UpdateBlockInput = z.infer<typeof updateBlockSchema>
