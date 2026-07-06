import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'

import { getPage as getMockPage, listPages as listMockPages } from './mock-data'
import { getPageSchema, updateBlockSchema } from './schemas'

export const listWorkspacePages = createServerFn({ method: 'GET' }).handler(
  async () => listMockPages(),
)

export const getWorkspacePage = createServerFn({ method: 'GET' })
  .validator(getPageSchema)
  .handler(async ({ data }) => {
    const page = getMockPage(data.slug)

    if (!page) {
      throw new Error('Page not found')
    }

    return page
  })

export const updateWorkspaceBlock = createServerFn({ method: 'POST' })
  .validator(updateBlockSchema)
  .handler(async ({ data }) => ({
    ok: true,
    blockId: data.blockId,
    pageId: data.pageId,
    content: data.content,
    version: data.version + 1,
  }))

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
