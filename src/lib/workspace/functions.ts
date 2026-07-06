import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'

import { workspaceRepository } from './repository'
import { getPageSchema, updateBlockSchema } from './schemas'

export const listWorkspacePages = createServerFn({ method: 'GET' }).handler(
  async () => workspaceRepository.listPages(),
)

export const getWorkspacePage = createServerFn({ method: 'GET' })
  .validator(getPageSchema)
  .handler(async ({ data }) => {
    const page = await workspaceRepository.getPage(data.slug)

    if (!page) {
      throw new Error('Page not found')
    }

    return page
  })

export const updateWorkspaceBlock = createServerFn({ method: 'POST' })
  .validator(updateBlockSchema)
  .handler(async ({ data }) => workspaceRepository.updateBlock(data))

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
