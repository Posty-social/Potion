import { describe, expect, it } from 'vitest'

import type { WorkspacePage, WorkspacePageSummary } from '#/lib/workspace/types'

import { resolveMcpHttpRequest, type McpRepository } from './tools'

function makePage(
  overrides: Partial<WorkspacePage> & { slug: string; title: string },
): WorkspacePage {
  return {
    id: `page_${overrides.slug}`,
    slug: overrides.slug,
    title: overrides.title,
    icon: '📄',
    parentPageId: null,
    position: 'a0',
    updatedAt: new Date(0).toISOString(),
    blocks: overrides.blocks ?? [],
    databases: [],
    ancestors: [],
    childPages: [],
  }
}

/** In-memory repository double implementing just what the MCP tools use. */
function createFakeRepository(): McpRepository & { pages: WorkspacePage[] } {
  const pages: WorkspacePage[] = [
    makePage({
      slug: 'private-workspace',
      title: 'Private workspace',
      blocks: [
        {
          id: 'block_summary',
          type: 'paragraph',
          content: 'Original',
          checked: false,
          databaseId: null,
          position: 'a0',
          version: 1,
        },
      ],
    }),
    makePage({ slug: 'deployment-handoff', title: 'Deployment handoff' }),
  ]

  const toSummary = (page: WorkspacePage): WorkspacePageSummary => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    icon: page.icon,
    parentPageId: page.parentPageId,
    position: page.position,
    updatedAt: page.updatedAt,
  })

  return {
    pages,
    async listPages() {
      return pages.map(toSummary)
    },
    async searchPages(query, limit) {
      const q = query.toLowerCase()
      return pages
        .filter((page) =>
          `${page.title} ${page.slug}`.toLowerCase().includes(q),
        )
        .slice(0, limit)
        .map(toSummary)
    },
    async getPage(slug) {
      return pages.find((page) => page.slug === slug) ?? null
    },
    async getDatabaseById() {
      return null
    },
    async createPage(input) {
      const page = makePage({
        slug: input.title.toLowerCase().replace(/\s+/g, '-'),
        title: input.title,
      })
      pages.push(page)
      return toSummary(page)
    },
    async renamePage(input) {
      const page = pages.find((candidate) => candidate.id === input.pageId)
      if (page) {
        page.title = input.title
      }
      return toSummary(page ?? pages[0])
    },
    async setPageIcon() {
      return { ok: true as const }
    },
    async deletePage() {
      return { ok: true as const }
    },
    async createBlock() {
      return { blockId: 'block_new', databaseId: null }
    },
    async setBlockChecked() {
      return { ok: true as const }
    },
    async deleteBlock() {
      return { ok: true as const }
    },
    async addRow() {
      return { rowId: 'row_new' }
    },
    async updateRow() {
      return { ok: true as const }
    },
    async deleteRow() {
      return { ok: true as const }
    },
    async updateBlock(input) {
      const page = pages.find((candidate) => candidate.id === input.pageId)
      const block = page?.blocks.find(
        (candidate) => candidate.id === input.blockId,
      )
      if (!block) {
        throw new Error('block not found')
      }
      block.content = input.content
      block.version = input.version + 1
      return {
        ok: true,
        pageId: input.pageId,
        blockId: input.blockId,
        content: input.content,
        version: input.version + 1,
      }
    },
    async importText(input) {
      const page = makePage({
        slug: input.title.toLowerCase().replace(/\s+/g, '-'),
        title: input.title,
      })
      pages.push(page)
      return toSummary(page)
    },
  }
}

describe('MCP workspace tools', () => {
  it('lists tools with a JSON-RPC request (no auth required)', async () => {
    const result = await resolveMcpHttpRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { repository: null },
    )

    expect(result).toMatchObject({
      status: 200,
      body: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: expect.arrayContaining([
            expect.objectContaining({ name: 'search_pages' }),
            expect.objectContaining({ name: 'update_block' }),
          ]),
        },
      },
    })
  })

  it('responds to initialize with server info', async () => {
    const result = await resolveMcpHttpRequest(
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { repository: null },
    )

    expect(result).toMatchObject({
      status: 200,
      body: { result: { serverInfo: { name: 'Potion MCP' } } },
    })
  })

  it('searches pages through the repository', async () => {
    const result = await resolveMcpHttpRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'search_pages', arguments: { query: 'deploy' } },
      },
      { repository: createFakeRepository() },
    )

    expect(result).toMatchObject({
      status: 200,
      body: {
        result: {
          structuredContent: {
            pages: [expect.objectContaining({ slug: 'deployment-handoff' })],
          },
        },
      },
    })
  })

  it('updates blocks through version-checked writes', async () => {
    const result = await resolveMcpHttpRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'update_block',
          arguments: {
            pageId: 'page_private-workspace',
            blockId: 'block_summary',
            content: 'Updated by MCP',
            version: 1,
          },
        },
      },
      { repository: createFakeRepository() },
    )

    expect(result).toMatchObject({
      status: 200,
      body: {
        result: {
          structuredContent: {
            update: { ok: true, content: 'Updated by MCP', version: 2 },
          },
        },
      },
    })
  })

  it('denies tool calls when the request is unauthenticated', async () => {
    const result = await resolveMcpHttpRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'search_pages' },
      },
      { repository: null },
    )

    expect(result.status).toBe(401)
  })

  it('lists workspaces through the gateway and routes workspaceId to it', async () => {
    const defaultRepository = createFakeRepository()
    const targeted = createFakeRepository()

    const result = await resolveMcpHttpRequest(
      {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'list_workspaces' },
      },
      {
        repository: defaultRepository,
        workspaces: {
          list: async () => [
            {
              id: 'ws_default',
              name: 'Default',
              slug: 'default',
              role: 'owner',
              isDefault: true,
            },
            {
              id: 'ws_other',
              name: 'Other',
              slug: 'other',
              role: 'member',
              isDefault: false,
            },
          ],
          repositoryFor: async (workspaceId) => {
            expect(workspaceId).toBe('ws_other')
            return targeted
          },
        },
      },
    )

    expect(result).toMatchObject({
      status: 200,
      body: {
        result: {
          structuredContent: {
            workspaces: expect.arrayContaining([
              expect.objectContaining({ id: 'ws_other', isDefault: false }),
            ]),
          },
        },
      },
    })

    // A tool call carrying workspaceId is routed through the gateway to the
    // targeted repository, not the default one.
    await resolveMcpHttpRequest(
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'create_page',
          arguments: { title: 'In other', workspaceId: 'ws_other' },
        },
      },
      {
        repository: defaultRepository,
        workspaces: {
          list: async () => [],
          repositoryFor: async (workspaceId) => {
            expect(workspaceId).toBe('ws_other')
            return targeted
          },
        },
      },
    )

    expect(targeted.pages.some((page) => page.title === 'In other')).toBe(true)
    expect(
      defaultRepository.pages.some((page) => page.title === 'In other'),
    ).toBe(false)
  })

  it('exposes the full tool set with annotations', async () => {
    const result = await resolveMcpHttpRequest(
      { jsonrpc: '2.0', id: 9, method: 'tools/list' },
      { repository: null },
    )

    const tools = (
      result.body as {
        result: {
          tools: Array<{
            name: string
            annotations?: { destructiveHint?: boolean }
          }>
        }
      }
    ).result.tools
    const names = tools.map((tool) => tool.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'read_database',
        'rename_page',
        'delete_page',
        'toggle_todo',
        'delete_block',
        'add_row',
        'update_row',
        'delete_row',
      ]),
    )
    expect(
      tools.find((tool) => tool.name === 'delete_page')?.annotations
        ?.destructiveHint,
    ).toBe(true)
  })

  it('lists and reads pages as resources', async () => {
    const repository = createFakeRepository()

    const list = await resolveMcpHttpRequest(
      { jsonrpc: '2.0', id: 10, method: 'resources/list' },
      { repository },
    )

    expect(list).toMatchObject({
      status: 200,
      body: {
        result: {
          resources: expect.arrayContaining([
            expect.objectContaining({
              uri: 'potion://page/deployment-handoff',
            }),
          ]),
        },
      },
    })

    const read = await resolveMcpHttpRequest(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'resources/read',
        params: { uri: 'potion://page/deployment-handoff' },
      },
      { repository },
    )

    expect(read).toMatchObject({
      status: 200,
      body: {
        result: {
          contents: [
            expect.objectContaining({
              uri: 'potion://page/deployment-handoff',
            }),
          ],
        },
      },
    })
  })

  it('supports the legacy { tool, input } shape', async () => {
    const result = await resolveMcpHttpRequest(
      { tool: 'search_pages', input: {} },
      { repository: createFakeRepository() },
    )

    expect(result).toMatchObject({
      status: 200,
      body: { structuredContent: { pages: expect.any(Array) } },
    })
  })
})
