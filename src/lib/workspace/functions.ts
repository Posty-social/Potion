import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import { db } from '#/lib/db/connection'
import { createPageDocNotifier } from '#/lib/realtime/notify.server'

import { requireWorkspaceAccess } from './access'
import { resolveWorkspaceAccess } from './access.server'
import {
  createWorkspaceRepository,
  type WorkspaceRepository,
} from './repository'
import {
  addCatalogPropertyOptionSchema,
  addPagePropertyOptionSchema,
  addPagePropertySchema,
  attachPagePropertySchema,
  addPropertyOptionSchema,
  addPropertySchema,
  deleteCatalogPropertyOptionSchema,
  deleteCatalogPropertySchema,
  renameCatalogPropertyOptionSchema,
  updateCatalogPropertySchema,
  addRowSchema,
  addViewSchema,
  createBlockSchema,
  createPageSchema,
  deleteBlockSchema,
  deletePagePropertyOptionSchema,
  deletePagePropertySchema,
  deletePageSchema,
  deletePropertyOptionSchema,
  deletePropertySchema,
  deleteRowSchema,
  deleteViewSchema,
  getPageSchema,
  importTextSchema,
  renameDatabaseSchema,
  renamePagePropertyOptionSchema,
  renamePageSchema,
  renamePropertyOptionSchema,
  renameViewSchema,
  setBlockCheckedSchema,
  setPageIconSchema,
  setPagePropertyValueSchema,
  setViewDatePropertySchema,
  setViewFiltersSchema,
  setViewGroupBySchema,
  setViewPropertiesSchema,
  setViewSortsSchema,
  setViewTypeSchema,
  updateBlockSchema,
  updatePagePropertySchema,
  updatePropertySchema,
  updateRowBodySchema,
  updateRowSchema,
} from './schemas'

async function requireRepository(): Promise<WorkspaceRepository> {
  const access = await resolveWorkspaceAccess(getRequestHeaders())
  const { organizationId, user } = requireWorkspaceAccess(access)

  return createWorkspaceRepository(
    db,
    { organizationId, userId: user.id },
    createPageDocNotifier(),
  )
}

// --- Queries -------------------------------------------------------------

export const listWorkspacePages = createServerFn({ method: 'GET' }).handler(
  async () => (await requireRepository()).listPages(),
)

export const listWorkspaceProperties = createServerFn({
  method: 'GET',
}).handler(async () => (await requireRepository()).listWorkspaceProperties())

export const listWorkspaceMembers = createServerFn({ method: 'GET' }).handler(
  async () => (await requireRepository()).listMembers(),
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

// --- Page property mutations ---------------------------------------------

export const addWorkspacePageProperty = createServerFn({ method: 'POST' })
  .validator(addPagePropertySchema)
  .handler(async ({ data }) =>
    (await requireRepository()).addPageProperty(data),
  )

export const attachWorkspacePageProperty = createServerFn({ method: 'POST' })
  .validator(attachPagePropertySchema)
  .handler(async ({ data }) =>
    (await requireRepository()).attachPageProperty(data),
  )

export const updateWorkspacePageProperty = createServerFn({ method: 'POST' })
  .validator(updatePagePropertySchema)
  .handler(async ({ data }) =>
    (await requireRepository()).updatePageProperty(data),
  )

export const deleteWorkspacePageProperty = createServerFn({ method: 'POST' })
  .validator(deletePagePropertySchema)
  .handler(async ({ data }) =>
    (await requireRepository()).deletePageProperty(data),
  )

export const setWorkspacePagePropertyValue = createServerFn({ method: 'POST' })
  .validator(setPagePropertyValueSchema)
  .handler(async ({ data }) =>
    (await requireRepository()).setPagePropertyValue(data),
  )

export const addWorkspacePagePropertyOption = createServerFn({ method: 'POST' })
  .validator(addPagePropertyOptionSchema)
  .handler(async ({ data }) =>
    (await requireRepository()).addPagePropertyOption(data),
  )

export const renameWorkspacePagePropertyOption = createServerFn({
  method: 'POST',
})
  .validator(renamePagePropertyOptionSchema)
  .handler(async ({ data }) =>
    (await requireRepository()).renamePagePropertyOption(data),
  )

export const deleteWorkspacePagePropertyOption = createServerFn({
  method: 'POST',
})
  .validator(deletePagePropertyOptionSchema)
  .handler(async ({ data }) =>
    (await requireRepository()).deletePagePropertyOption(data),
  )

// --- Workspace property catalog (shared definitions, managed in settings) --

export const updateWorkspaceCatalogProperty = createServerFn({ method: 'POST' })
  .validator(updateCatalogPropertySchema)
  .handler(async ({ data }) =>
    (await requireRepository()).updateCatalogProperty(data),
  )

export const deleteWorkspaceCatalogProperty = createServerFn({ method: 'POST' })
  .validator(deleteCatalogPropertySchema)
  .handler(async ({ data }) =>
    (await requireRepository()).deleteCatalogProperty(data),
  )

export const addWorkspaceCatalogPropertyOption = createServerFn({
  method: 'POST',
})
  .validator(addCatalogPropertyOptionSchema)
  .handler(async ({ data }) =>
    (await requireRepository()).addCatalogPropertyOption(data),
  )

export const renameWorkspaceCatalogPropertyOption = createServerFn({
  method: 'POST',
})
  .validator(renameCatalogPropertyOptionSchema)
  .handler(async ({ data }) =>
    (await requireRepository()).renameCatalogPropertyOption(data),
  )

export const deleteWorkspaceCatalogPropertyOption = createServerFn({
  method: 'POST',
})
  .validator(deleteCatalogPropertyOptionSchema)
  .handler(async ({ data }) =>
    (await requireRepository()).deleteCatalogPropertyOption(data),
  )

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

export const updateWorkspaceRowBody = createServerFn({ method: 'POST' })
  .validator(updateRowBodySchema)
  .handler(async ({ data }) => (await requireRepository()).updateRowBody(data))

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

/** The workspace-wide catalog of shared property definitions (for the picker). */
export const workspacePropertiesQuery = () =>
  queryOptions({
    queryKey: ['workspace', 'properties'],
    queryFn: () => listWorkspaceProperties(),
  })

/** Workspace members, for `person` property pickers. */
export const workspaceMembersQuery = () =>
  queryOptions({
    queryKey: ['workspace', 'members'],
    queryFn: () => listWorkspaceMembers(),
  })
