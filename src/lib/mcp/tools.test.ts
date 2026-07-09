import { describe, expect, it } from 'vitest'

import type {
  DatabaseProperty,
  WorkspacePage,
  WorkspacePageSummary,
} from '#/lib/workspace/types'

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
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    blocks: overrides.blocks ?? [],
    databases: [],
    ancestors: [],
    childPages: [],
    properties: overrides.properties ?? [],
    propertyValues: overrides.propertyValues ?? {},
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
  const catalog: DatabaseProperty[] = []

  const toSummary = (page: WorkspacePage): WorkspacePageSummary => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    icon: page.icon,
    parentPageId: page.parentPageId,
    position: page.position,
    createdAt: page.createdAt,
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
    // Page properties. The catalog holds shared definitions; a page's
    // `properties` array holds the SAME object references, so mutating a
    // definition's options is reflected on every page that uses it (mirroring
    // the real workspace_property catalog).
    async listWorkspaceProperties() {
      return catalog
    },
    async addPageProperty(input) {
      const property: DatabaseProperty = {
        id: `prop_${catalog.length + 1}`,
        name: input.name,
        type: input.type,
        options: [],
      }
      catalog.push(property)
      pages.find((page) => page.id === input.pageId)?.properties.push(property)
      return { propertyId: property.id }
    },
    async attachPageProperty(input) {
      const property = catalog.find((p) => p.id === input.propertyId)
      const page = pages.find((candidate) => candidate.id === input.pageId)
      if (
        property &&
        page &&
        !page.properties.some((p) => p.id === property.id)
      ) {
        page.properties.push(property)
      }
      return { ok: true as const }
    },
    async updatePageProperty(input) {
      const property = catalog.find((p) => p.id === input.propertyId)
      if (property && input.name !== undefined) {
        property.name = input.name
      }
      return { ok: true as const }
    },
    async deletePageProperty(input) {
      const page = pages.find((candidate) => candidate.id === input.pageId)
      if (page) {
        page.properties = page.properties.filter(
          (p) => p.id !== input.propertyId,
        )
        delete page.propertyValues[input.propertyId]
      }
      return { ok: true as const }
    },
    async setPagePropertyValue(input) {
      const page = pages.find((candidate) => candidate.id === input.pageId)
      if (page) {
        page.propertyValues[input.propertyId] = input.value
      }
      return { ok: true as const }
    },
    async addPagePropertyOption(input) {
      const property = catalog.find((p) => p.id === input.propertyId)
      const optionId = `opt_${(property?.options?.length ?? 0) + 1}`
      property?.options?.push({ id: optionId, name: input.name, color: '#fff' })
      return { optionId }
    },
    async renamePagePropertyOption(input) {
      const option = catalog
        .find((p) => p.id === input.propertyId)
        ?.options?.find((o) => o.id === input.optionId)
      if (option) {
        option.name = input.name
      }
      return { ok: true as const }
    },
    async deletePagePropertyOption(input) {
      const property = catalog.find((p) => p.id === input.propertyId)
      if (property?.options) {
        property.options = property.options.filter(
          (o) => o.id !== input.optionId,
        )
      }
      return { ok: true as const }
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

  it('shares page property definitions across pages via the catalog', async () => {
    const repository = createFakeRepository()
    const context = { repository }
    const call = (id: number, name: string, args: Record<string, unknown>) =>
      resolveMcpHttpRequest(
        {
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: args },
        },
        context,
      )

    // Create a shared multi_select property on page A.
    const added = (await call(20, 'add_page_property', {
      pageId: 'page_private-workspace',
      name: 'Tags',
      type: 'multi_select',
    })) as { body: { result: { structuredContent: { propertyId: string } } } }
    const propertyId = added.body.result.structuredContent.propertyId

    // Attach the same property to page B and add an option through page B.
    await call(21, 'attach_page_property', {
      pageId: 'page_deployment-handoff',
      propertyId,
    })
    const optioned = (await call(22, 'add_property_option', {
      pageId: 'page_deployment-handoff',
      propertyId,
      name: 'urgent',
    })) as { body: { result: { structuredContent: { optionId: string } } } }
    const optionId = optioned.body.result.structuredContent.optionId

    // The catalog lists the shared property...
    const listed = (await call(23, 'list_workspace_properties', {})) as {
      body: {
        result: { structuredContent: { properties: DatabaseProperty[] } }
      }
    }
    expect(listed.body.result.structuredContent.properties).toHaveLength(1)

    // ...and page A (which never touched the option) sees it, proving sharing.
    const pageA = repository.pages.find(
      (p) => p.id === 'page_private-workspace',
    )
    const shared = pageA?.properties.find((p) => p.id === propertyId)
    expect(shared?.options?.map((o) => o.id)).toContain(optionId)

    // Setting and removing a value on page A works too.
    await call(24, 'set_page_property', {
      pageId: 'page_private-workspace',
      propertyId,
      value: [optionId],
    })
    expect(pageA?.propertyValues[propertyId]).toEqual([optionId])
    await call(25, 'remove_page_property', {
      pageId: 'page_private-workspace',
      propertyId,
    })
    expect(pageA?.properties.some((p) => p.id === propertyId)).toBe(false)
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
