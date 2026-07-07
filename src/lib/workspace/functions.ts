import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { db } from '#/lib/db/connection'

import { requireWorkspaceAccess } from './access'
import { resolveWorkspaceAccess } from './access.server'
import {
  createWorkspaceRepository,
  type WorkspaceRepository,
} from './repository'
import {
  addPropertyOptionSchema,
  addPropertySchema,
  addRowSchema,
  addViewSchema,
  createBlockSchema,
  createPageSchema,
  deleteBlockSchema,
  deletePageSchema,
  deletePropertyOptionSchema,
  deletePropertySchema,
  deleteRowSchema,
  deleteViewSchema,
  getPageSchema,
  importTextSchema,
  renameDatabaseSchema,
  renamePageSchema,
  renamePropertyOptionSchema,
  renameViewSchema,
  setBlockCheckedSchema,
  setPageIconSchema,
  setViewDatePropertySchema,
  setViewFiltersSchema,
  setViewGroupBySchema,
  setViewPropertiesSchema,
  setViewSortsSchema,
  setViewTypeSchema,
  updateBlockSchema,
  updatePropertySchema,
  updateRowSchema,
} from './schemas'

async function requireRepository(): Promise<WorkspaceRepository> {
  const access = await resolveWorkspaceAccess(getRequestHeaders())
  const { organizationId, user } = requireWorkspaceAccess(access)

  return createWorkspaceRepository(db, { organizationId, userId: user.id })
}

// --- Queries -------------------------------------------------------------

export const listWorkspacePages = createServerFn({ method: 'GET' }).handler(
  async () => (await requireRepository()).listPages(),
)

export const getWorkspacePage = createServerFn({ method: 'GET' })
  .validator(getPageSchema)
  .handler(async ({ data }) => (await requireRepository()).getPage(data.slug))

export const ensureWorkspaceSeed = createServerFn({ method: 'GET' }).handler(
  async () => {
    const repository = await requireRepository()

    if (await repository.hasPages()) {
      const pages = await repository.listPages()

      return { slug: pages[0]?.slug ?? null }
    }

    const summary = await repository.seedWelcomePage()

    return { slug: summary.slug }
  },
)

// --- Page mutations ------------------------------------------------------

export const createWorkspacePage = createServerFn({ method: 'POST' })
  .validator(createPageSchema)
  .handler(async ({ data }) => (await requireRepository()).createPage(data))

export const renameWorkspacePage = createServerFn({ method: 'POST' })
  .validator(renamePageSchema)
  .handler(async ({ data }) => (await requireRepository()).renamePage(data))

export const setWorkspacePageIcon = createServerFn({ method: 'POST' })
  .validator(setPageIconSchema)
  .handler(async ({ data }) => (await requireRepository()).setPageIcon(data))

export const deleteWorkspacePage = createServerFn({ method: 'POST' })
  .validator(deletePageSchema)
  .handler(async ({ data }) => (await requireRepository()).deletePage(data))

// --- Block mutations -----------------------------------------------------

export const createWorkspaceBlock = createServerFn({ method: 'POST' })
  .validator(createBlockSchema)
  .handler(async ({ data }) => (await requireRepository()).createBlock(data))

export const updateWorkspaceBlock = createServerFn({ method: 'POST' })
  .validator(updateBlockSchema)
  .handler(async ({ data }) => (await requireRepository()).updateBlock(data))

export const setWorkspaceBlockChecked = createServerFn({ method: 'POST' })
  .validator(setBlockCheckedSchema)
  .handler(async ({ data }) =>
    (await requireRepository()).setBlockChecked(data),
  )

export const deleteWorkspaceBlock = createServerFn({ method: 'POST' })
  .validator(deleteBlockSchema)
  .handler(async ({ data }) => (await requireRepository()).deleteBlock(data))

// --- Database mutations --------------------------------------------------

export const renameWorkspaceDatabase = createServerFn({ method: 'POST' })
  .validator(renameDatabaseSchema)
  .handler(async ({ data }) => (await requireRepository()).renameDatabase(data))

// Views
export const addWorkspaceView = createServerFn({ method: 'POST' })
  .validator(addViewSchema)
  .handler(async ({ data }) => (await requireRepository()).addView(data))

export const renameWorkspaceView = createServerFn({ method: 'POST' })
  .validator(renameViewSchema)
  .handler(async ({ data }) => (await requireRepository()).renameView(data))

export const deleteWorkspaceView = createServerFn({ method: 'POST' })
  .validator(deleteViewSchema)
  .handler(async ({ data }) => (await requireRepository()).deleteView(data))

export const setWorkspaceViewType = createServerFn({ method: 'POST' })
  .validator(setViewTypeSchema)
  .handler(async ({ data }) => (await requireRepository()).setViewType(data))

export const setWorkspaceViewGroupBy = createServerFn({ method: 'POST' })
  .validator(setViewGroupBySchema)
  .handler(async ({ data }) => (await requireRepository()).setViewGroupBy(data))

export const setWorkspaceViewDateProperty = createServerFn({ method: 'POST' })
  .validator(setViewDatePropertySchema)
  .handler(async ({ data }) =>
    (await requireRepository()).setViewDateProperty(data),
  )

export const setWorkspaceViewSorts = createServerFn({ method: 'POST' })
  .validator(setViewSortsSchema)
  .handler(async ({ data }) => (await requireRepository()).setViewSorts(data))

export const setWorkspaceViewFilters = createServerFn({ method: 'POST' })
  .validator(setViewFiltersSchema)
  .handler(async ({ data }) => (await requireRepository()).setViewFilters(data))

export const setWorkspaceViewProperties = createServerFn({ method: 'POST' })
  .validator(setViewPropertiesSchema)
  .handler(async ({ data }) =>
    (await requireRepository()).setViewProperties(data),
  )

// Properties
export const addWorkspaceProperty = createServerFn({ method: 'POST' })
  .validator(addPropertySchema)
  .handler(async ({ data }) => (await requireRepository()).addProperty(data))

export const updateWorkspaceProperty = createServerFn({ method: 'POST' })
  .validator(updatePropertySchema)
  .handler(async ({ data }) => (await requireRepository()).updateProperty(data))

export const deleteWorkspaceProperty = createServerFn({ method: 'POST' })
  .validator(deletePropertySchema)
  .handler(async ({ data }) => (await requireRepository()).deleteProperty(data))

export const addWorkspacePropertyOption = createServerFn({ method: 'POST' })
  .validator(addPropertyOptionSchema)
  .handler(async ({ data }) =>
    (await requireRepository()).addPropertyOption(data),
  )

export const renameWorkspacePropertyOption = createServerFn({ method: 'POST' })
  .validator(renamePropertyOptionSchema)
  .handler(async ({ data }) =>
    (await requireRepository()).renamePropertyOption(data),
  )

export const deleteWorkspacePropertyOption = createServerFn({ method: 'POST' })
  .validator(deletePropertyOptionSchema)
  .handler(async ({ data }) =>
    (await requireRepository()).deletePropertyOption(data),
  )

// Rows
export const addWorkspaceRow = createServerFn({ method: 'POST' })
  .validator(addRowSchema)
  .handler(async ({ data }) => (await requireRepository()).addRow(data))

export const updateWorkspaceRow = createServerFn({ method: 'POST' })
  .validator(updateRowSchema)
  .handler(async ({ data }) => (await requireRepository()).updateRow(data))

export const deleteWorkspaceRow = createServerFn({ method: 'POST' })
  .validator(deleteRowSchema)
  .handler(async ({ data }) => (await requireRepository()).deleteRow(data))

// --- Import --------------------------------------------------------------

export const importWorkspaceText = createServerFn({ method: 'POST' })
  .validator(importTextSchema)
  .handler(async ({ data }) => (await requireRepository()).importText(data))

// --- Query options -------------------------------------------------------

export const workspacePagesQuery = () =>
  queryOptions({
    queryKey: ['workspace', 'pages'],
    queryFn: () => listWorkspacePages(),
  })

export const workspacePageQuery = (slug: string) =>
  queryOptions({
    queryKey: ['workspace', 'page', slug],
    queryFn: () => getWorkspacePage({ data: { slug } }),
  })
