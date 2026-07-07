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
    async getPage(slug) {
      return pages.find((page) => page.slug === slug) ?? null
    },
    async createPage(input) {
      const page = makePage({
        slug: input.title.toLowerCase().replace(/\s+/g, '-'),
        title: input.title,
      })
      pages.push(page)
      return toSummary(page)
    },
    async createBlock() {
      return { blockId: 'block_new', databaseId: null }
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
