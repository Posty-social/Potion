import { afterEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceRepositoryError } from '#/lib/workspace/repository'
import {
  nextOptionColor,
  type DatabaseProperty,
  type DatabaseRow,
  type WorkspaceDatabase,
  type WorkspacePage,
  type WorkspacePageSummary,
} from '#/lib/workspace/types'

import { resolveMcpHttpRequest, type McpRepository } from './tools'

function makeRow(
  id: string,
  values: DatabaseRow['values'],
  overrides: Partial<DatabaseRow> = {},
): DatabaseRow {
  return {
    id,
    position: id,
    values,
    body: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    pageId: null,
    isArchived: false,
    archivedAt: null,
    ...overrides,
  }
}

/** A "Posty Bugs" board: title, status, tags, owner, due date and PR links. */
function makeBoard(): WorkspaceDatabase {
  return {
    id: 'database_bugs',
    blockId: 'block_bugs',
    title: 'Posty Bugs',
    titlePropertyId: 'prop_title',
    properties: [
      { id: 'prop_title', name: 'Name', type: 'title' },
      {
        id: 'prop_status',
        name: 'Status',
        type: 'status',
        options: [
          { id: 'opt_todo', name: 'To do', color: '#dce8f2' },
          { id: 'opt_done', name: 'Done', color: '#dcebdd' },
        ],
      },
      { id: 'prop_tags', name: 'Tags', type: 'multi_select', options: [] },
      { id: 'prop_owner', name: 'Owner', type: 'person' },
      { id: 'prop_due', name: 'Due', type: 'date' },
      { id: 'prop_prs', name: 'PRs', type: 'url' },
      { id: 'prop_notes', name: 'Notes', type: 'text' },
    ],
    rows: [
      makeRow(
        'row_login',
        { prop_title: 'Login fails', prop_status: 'opt_todo' },
        { body: 'Steps to reproduce…' },
      ),
      makeRow(
        'row_old',
        { prop_title: 'Old crash', prop_status: 'opt_done' },
        { isArchived: true, archivedAt: new Date(0).toISOString() },
      ),
    ],
    views: [],
  }
}

const MEMBERS = [
  {
    userId: 'user_ada',
    name: 'Ada Lovelace',
    email: 'ada@posty.social',
    role: 'owner',
  },
  {
    userId: 'user_alan',
    name: 'Alan Turing',
    email: 'alan@posty.social',
    role: 'member',
  },
]

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

type FakeRepository = McpRepository & {
  pages: WorkspacePage[]
  board: WorkspaceDatabase
  uploads: Array<{ fileName: string; mime: string; bytes: Uint8Array }>
}

/** In-memory repository double implementing just what the MCP tools use. */
function createFakeRepository(): FakeRepository {
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
  pages[0].databases.push(makeBoard())
  const board = pages[0].databases[0]
  const uploads: FakeRepository['uploads'] = []
  const findRow = (rowId: string) => {
    const row = board.rows.find((candidate) => candidate.id === rowId)
    if (!row) {
      throw new WorkspaceRepositoryError(
        'row_not_found',
        `Row "${rowId}" was not found in this workspace.`,
      )
    }
    return row
  }
  const findBoard = (databaseId: string) => {
    if (databaseId !== board.id) {
      throw new WorkspaceRepositoryError(
        'database_not_found',
        `Database "${databaseId}" was not found in this workspace.`,
      )
    }
    return board
  }
  const findOptionProperty = (databaseId: string, propertyId: string) => {
    const property = findBoard(databaseId).properties.find(
      (candidate) => candidate.id === propertyId,
    )
    if (!property?.options) {
      throw new WorkspaceRepositoryError(
        'property_not_found',
        `Column "${propertyId}" was not found on database "${databaseId}".`,
      )
    }
    return property as DatabaseProperty & {
      options: NonNullable<DatabaseProperty['options']>
    }
  }
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
    board,
    uploads,
    async listMembers() {
      return MEMBERS
    },
    async getDatabaseSchema(databaseId) {
      const database = findBoard(databaseId)
      return {
        id: database.id,
        title: database.title,
        titlePropertyId: database.titlePropertyId,
        properties: database.properties,
      }
    },
    async getRow(rowId) {
      return { ...findRow(rowId), databaseId: board.id }
    },
    async setRowsArchived(input) {
      input.rowIds.forEach(findRow)
      for (const rowId of input.rowIds) {
        const row = findRow(rowId)
        row.isArchived = input.archived
        row.archivedAt = input.archived ? new Date().toISOString() : null
      }
      return input
    },
    async addPropertyOption(input) {
      const property = findOptionProperty(input.databaseId, input.propertyId)
      const option = {
        id: `opt_${property.options.length + 10}`,
        name: input.name,
        color: input.color ?? nextOptionColor(property.options),
      }
      property.options.push(option)
      return { optionId: option.id, option }
    },
    async updatePropertyOption(input) {
      const property = findOptionProperty(input.databaseId, input.propertyId)
      const option = property.options.find((o) => o.id === input.optionId)
      if (!option) {
        throw new WorkspaceRepositoryError(
          'option_not_found',
          `Option "${input.optionId}" was not found on column "${property.name}" (${property.id}).`,
        )
      }
      option.name = input.name ?? option.name
      option.color = input.color ?? option.color
      return { option }
    },
    async deletePropertyOption(input) {
      const property = findOptionProperty(input.databaseId, input.propertyId)
      property.options = property.options.filter((o) => o.id !== input.optionId)
      return { clearedRowCount: 0 }
    },
    async uploadAsset(input) {
      uploads.push(input)
      const path = `/api/assets/asset_1/${input.fileName}`
      return {
        assetId: 'asset_1',
        path,
        fileName: input.fileName,
        mime: input.mime,
        sizeBytes: input.bytes.byteLength,
      }
    },
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
    async getPageById(pageId) {
      return pages.find((page) => page.id === pageId) ?? null
    },
    // In-memory stand-ins for the SQL-paged repository reads.
    async getDatabaseRowsPage(databaseId, options) {
      const database = findBoard(databaseId)
      const visible = options.includeArchived
        ? database.rows
        : database.rows.filter((row) => !row.isArchived)
      const archivedCount = database.rows.filter((row) => row.isArchived).length
      return {
        database: {
          ...database,
          rows: visible
            .slice(options.offset, options.offset + options.limit)
            .map((row) =>
              Object.assign({}, row, {
                body: options.includeBodies ? row.body : null,
                hasBody: Boolean(row.body?.trim()),
              }),
            ),
        },
        total: visible.length,
        archivedCount,
      }
    },
    async getPageForAgent(slug, rowPreviewLimit) {
      const page = pages.find((candidate) => candidate.slug === slug)
      if (!page) {
        return null
      }
      const databases = await Promise.all(
        page.databases.map(async (database) => {
          const result = await this.getDatabaseRowsPage(database.id, {
            includeArchived: false,
            includeBodies: false,
            limit: rowPreviewLimit,
            offset: 0,
          })
          return {
            ...result.database,
            rowCount: result.total,
            archivedRowCount: result.archivedCount,
            rowsTruncated: result.total > result.database.rows.length,
          }
        }),
      )
      return { ...page, databases }
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
      return
    },
    async deletePage() {
      return
    },
    async createBlock() {
      return { blockId: 'block_new', databaseId: null }
    },
    async setBlockChecked() {
      return
    },
    async deleteBlock() {
      return
    },
    async addRow(input) {
      findBoard(input.databaseId)
      board.rows.push(makeRow('row_new', input.values ?? {}))
      return { rowId: 'row_new' }
    },
    async updateRow(input) {
      const row = findRow(input.rowId)
      row.values = { ...row.values, ...input.values }
      return
    },
    async updateRowBody(input) {
      findRow(input.rowId).body = input.body
      return
    },
    async deleteRow() {
      return
    },
    async addProperty() {
      return { propertyId: 'prop_new' }
    },
    async updateProperty() {
      return
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
      return
    },
    async updatePageProperty(input) {
      const property = catalog.find((p) => p.id === input.propertyId)
      if (property && input.name !== undefined) {
        property.name = input.name
      }
      return
    },
    async deletePageProperty(input) {
      const page = pages.find((candidate) => candidate.id === input.pageId)
      if (page) {
        page.properties = page.properties.filter(
          (p) => p.id !== input.propertyId,
        )
        delete page.propertyValues[input.propertyId]
      }
      return
    },
    async setPagePropertyValue(input) {
      const page = pages.find((candidate) => candidate.id === input.pageId)
      if (page) {
        page.propertyValues[input.propertyId] = input.value
      }
      return
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
      return
    },
    async deletePagePropertyOption(input) {
      const property = catalog.find((p) => p.id === input.propertyId)
      if (property?.options) {
        property.options = property.options.filter(
          (o) => o.id !== input.optionId,
        )
      }
      return
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
            update: { content: 'Updated by MCP', version: 2 },
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
        'update_row_body',
        'delete_row',
        'add_database_property',
        'update_database_property',
      ]),
    )
    expect(
      tools.find((tool) => tool.name === 'delete_page')?.annotations
        ?.destructiveHint,
    ).toBe(true)
  })

  it('adds and updates database columns', async () => {
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

    const added = (await call(30, 'add_database_property', {
      databaseId: 'database_tasks',
      name: 'Linked page',
      type: 'page',
    })) as { body: { result: { structuredContent: { propertyId: string } } } }
    expect(added.body.result.structuredContent.propertyId).toBe('prop_new')

    // Mutations with nothing useful to return resolve to an empty result
    // (no content / no structuredContent), not a filler { ok: true }.
    const updated = (await call(31, 'update_database_property', {
      databaseId: 'database_tasks',
      propertyId: 'prop_new',
      name: 'Page',
    })) as { body: { error?: unknown; result?: { content: unknown[] } } }
    expect(updated.body.error).toBeUndefined()
    expect(updated.body.result?.content).toEqual([])

    // Unknown property types are rejected before reaching the repository.
    const rejected = (await call(32, 'add_database_property', {
      databaseId: 'database_tasks',
      name: 'Bad',
      type: 'title',
    })) as { body: { error?: unknown } }
    expect(rejected.body.error).toBeDefined()
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

// --- Board management tools ----------------------------------------------

type RpcBody = {
  result?: { structuredContent: Record<string, unknown>; content: unknown[] }
  error?: { code: number; message: string; data?: unknown }
}

function boardHarness() {
  const repository = createFakeRepository()
  let id = 100
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await resolveMcpHttpRequest(
      {
        jsonrpc: '2.0',
        id: id++,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      { repository },
    )
    return { status: response.status, ...(response.body as RpcBody) }
  }
  return { repository, call }
}

// A 1×1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('MCP board tools', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('advertises every new tool', async () => {
    const result = await resolveMcpHttpRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { repository: null },
    )
    const names = (
      result.body as { result: { tools: Array<{ name: string }> } }
    ).result.tools.map((tool) => tool.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'upload_asset',
        'add_database_option',
        'update_database_option',
        'remove_database_option',
        'list_members',
        'archive_row',
        'unarchive_row',
        'read_row',
      ]),
    )
  })

  describe('upload_asset', () => {
    it('stores base64 image data and returns the asset path and markdown', async () => {
      const { repository, call } = boardHarness()

      const result = await call('upload_asset', {
        data: `data:image/png;base64,${PNG_BASE64}`,
        fileName: 'Login bug (1).png',
        mime: 'image/png',
      })

      expect(result.error).toBeUndefined()
      expect(repository.uploads).toHaveLength(1)
      expect(repository.uploads[0]).toMatchObject({
        mime: 'image/png',
        fileName: 'Login-bug-1.png',
      })
      expect(result.result?.structuredContent).toMatchObject({
        path: '/api/assets/asset_1/Login-bug-1.png',
        markdown: '![Login-bug-1](/api/assets/asset_1/Login-bug-1.png)',
      })
    })

    it('fetches an https URL server-side', async () => {
      const { repository, call } = boardHarness()
      const bytes = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0))
      const fetchMock = vi.fn(async () => new Response(bytes))
      vi.stubGlobal('fetch', fetchMock)

      const result = await call('upload_asset', {
        url: 'https://example.com/shots/crash.png',
      })

      expect(result.error).toBeUndefined()
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(repository.uploads[0].fileName).toBe('crash.png')
    })

    it('rejects non-images, SVG, http URLs and missing input', async () => {
      const { repository, call } = boardHarness()

      const html = await call('upload_asset', {
        data: btoa('<html>not an image</html>'),
        fileName: 'x.png',
      })
      expect(html.error?.message).toMatch(/not a supported image/)

      const pdf = await call('upload_asset', {
        data: PNG_BASE64,
        mime: 'application/pdf',
      })
      expect(pdf.error?.message).toMatch(/Only images/)

      const svg = await call('upload_asset', {
        data: btoa('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        mime: 'image/svg+xml',
      })
      expect(svg.error?.message).toMatch(/SVG is not accepted/)

      const http = await call('upload_asset', {
        url: 'http://example.com/a.png',
      })
      expect(http.error?.message).toMatch(/https/)

      const neither = await call('upload_asset', { fileName: 'a.png' })
      expect(neither.error?.message).toMatch(/exactly one of `data`/)

      expect(repository.uploads).toHaveLength(0)
    })

    it('rejects oversized base64 before decoding it', async () => {
      const { repository, call } = boardHarness()
      const atobSpy = vi.spyOn(globalThis, 'atob')

      const result = await call('upload_asset', {
        data: 'A'.repeat(Math.ceil((10 * 1024 * 1024) / 3) * 4 + 4),
      })

      expect(result.error?.message).toMatch(/too large/)
      expect(atobSpy).not.toHaveBeenCalled()
      expect(repository.uploads).toHaveLength(0)
      atobSpy.mockRestore()
    })

    it('follows https redirects but refuses a hop to http', async () => {
      const { repository, call } = boardHarness()
      const bytes = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0))
      const fetchMock = vi.fn(async (url: string) =>
        url.endsWith('/to-http')
          ? new Response(null, {
              status: 302,
              headers: { location: 'http://example.com/a.png' },
            })
          : url.endsWith('/to-https')
            ? new Response(null, {
                status: 301,
                headers: { location: '/real/shot.png' },
              })
            : new Response(bytes),
      )
      vi.stubGlobal('fetch', fetchMock)

      const insecure = await call('upload_asset', {
        url: 'https://example.com/to-http',
      })
      expect(insecure.error?.message).toMatch(/must be an https URL/)
      expect(repository.uploads).toHaveLength(0)

      const secure = await call('upload_asset', {
        url: 'https://example.com/to-https',
      })
      expect(secure.error).toBeUndefined()
      expect(fetchMock).toHaveBeenLastCalledWith(
        'https://example.com/real/shot.png',
        expect.objectContaining({ redirect: 'manual' }),
      )
      expect(repository.uploads).toHaveLength(1)
    })

    it('rejects images over the size limit', async () => {
      const { call } = boardHarness()
      const big = new Uint8Array(10 * 1024 * 1024 + 1)
      big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(big)),
      )

      const result = await call('upload_asset', {
        url: 'https://example.com/huge.png',
      })
      expect(result.error?.message).toMatch(/too large/)
    })
  })

  describe('database options', () => {
    it('adds an option with an automatic colour, or a named palette colour', async () => {
      const { repository, call } = boardHarness()

      const auto = await call('add_database_option', {
        databaseId: 'database_bugs',
        propertyId: 'prop_status',
        name: 'In review',
      })
      // Blue and green are taken, so the next unused palette colour is chosen.
      expect(auto.result?.structuredContent).toMatchObject({
        option: { name: 'In review', color: '#f1dfbd' },
      })

      const named = await call('add_database_option', {
        databaseId: 'database_bugs',
        propertyId: 'prop_tags',
        name: 'UI',
        color: 'Purple',
      })
      expect(named.result?.structuredContent).toMatchObject({
        option: { color: '#eadff0' },
      })
      expect(
        repository.board.properties.find((p) => p.id === 'prop_tags')?.options,
      ).toHaveLength(1)
    })

    it('rejects colours outside the palette with the valid choices', async () => {
      const { call } = boardHarness()

      const result = await call('add_database_option', {
        databaseId: 'database_bugs',
        propertyId: 'prop_status',
        name: 'Blocked',
        color: 'chartreuse',
      })
      expect(result.status).toBe(400)
      expect(result.error?.message).toMatch(/Unknown colour "chartreuse"/)
      expect(result.error?.message).toMatch(/blue, green, yellow/)
    })

    it('renames and recolours an option', async () => {
      const { repository, call } = boardHarness()

      const result = await call('update_database_option', {
        databaseId: 'database_bugs',
        propertyId: 'prop_status',
        optionId: 'opt_done',
        name: 'Shipped',
        color: 'teal',
      })
      expect(result.error).toBeUndefined()
      expect(
        repository.board.properties
          .find((p) => p.id === 'prop_status')
          ?.options?.find((o) => o.id === 'opt_done'),
      ).toEqual({ id: 'opt_done', name: 'Shipped', color: '#d9eeec' })

      const empty = await call('update_database_option', {
        databaseId: 'database_bugs',
        propertyId: 'prop_status',
        optionId: 'opt_done',
      })
      expect(empty.error?.message).toMatch(/new name, a colour, or both/)
    })

    it('names the missing option id in the error', async () => {
      const { call } = boardHarness()

      const result = await call('update_database_option', {
        databaseId: 'database_bugs',
        propertyId: 'prop_status',
        optionId: 'opt_nope',
        name: 'x',
      })
      expect(result.status).toBe(404)
      expect(result.error?.message).toContain('Option "opt_nope"')
    })

    it('removes an option', async () => {
      const { repository, call } = boardHarness()

      const result = await call('remove_database_option', {
        databaseId: 'database_bugs',
        propertyId: 'prop_status',
        optionId: 'opt_todo',
      })
      expect(result.error).toBeUndefined()
      expect(
        repository.board.properties
          .find((p) => p.id === 'prop_status')
          ?.options?.map((o) => o.id),
      ).toEqual(['opt_done'])
    })
  })

  it('lists members with id, name, email and role', async () => {
    const { call } = boardHarness()

    const result = await call('list_members')
    expect(result.result?.structuredContent).toEqual({ members: MEMBERS })
  })

  describe('archiving', () => {
    it('archives and unarchives rows by id or ids', async () => {
      const { repository, call } = boardHarness()

      const archived = await call('archive_row', { rowId: 'row_login' })
      expect(archived.result?.structuredContent).toEqual({
        rowIds: ['row_login'],
        archived: true,
      })
      expect(repository.board.rows[0].isArchived).toBe(true)

      await call('unarchive_row', { rowIds: ['row_login', 'row_old'] })
      expect(repository.board.rows.every((row) => !row.isArchived)).toBe(true)
    })

    it('requires a row id and reports unknown ones', async () => {
      const { call } = boardHarness()

      const missing = await call('archive_row', {})
      expect(missing.error?.message).toMatch(/rowId or rowIds/)

      const unknown = await call('archive_row', { rowId: 'row_ghost' })
      expect(unknown.status).toBe(404)
      expect(unknown.error?.message).toContain('Row "row_ghost"')
    })

    it('read_database hides archived rows and says how many', async () => {
      const { call } = boardHarness()

      const result = await call('read_database', {
        databaseId: 'database_bugs',
      })
      const content = result.result?.structuredContent as {
        database: { rows: Array<{ id: string }> }
        archivedRowsHidden: number
        note: string
      }
      expect(content.database.rows.map((row) => row.id)).toEqual(['row_login'])
      expect(content.archivedRowsHidden).toBe(1)
      expect(content.note).toMatch(/1 archived row is hidden/)

      const all = await call('read_database', {
        databaseId: 'database_bugs',
        includeArchived: true,
      })
      const allContent = all.result?.structuredContent as {
        database: { rows: Array<{ id: string; isArchived: boolean }> }
        archivedRowsHidden: number
      }
      expect(allContent.database.rows.map((row) => row.id)).toEqual([
        'row_login',
        'row_old',
      ])
      expect(allContent.archivedRowsHidden).toBe(0)
    })
  })

  describe('read sizes', () => {
    it('read_database pages rows and leaves bodies out by default', async () => {
      const { repository, call } = boardHarness()
      for (let index = 0; index < 150; index++) {
        repository.board.rows.push(
          makeRow(
            `row_${index}`,
            { prop_title: `Card ${index}` },
            {
              body: 'x'.repeat(5000),
            },
          ),
        )
      }

      const first = await call('read_database', {
        databaseId: 'database_bugs',
        limit: 100,
      })
      const content = first.result?.structuredContent as {
        database: { rows: Array<{ body?: string; hasBody: boolean }> }
        paging: { total: number; returned: number; nextOffset: number | null }
      }
      expect(content.paging).toMatchObject({
        total: 151,
        returned: 100,
        nextOffset: 100,
      })
      expect(content.database.rows[0]).not.toHaveProperty('body')
      expect(content.database.rows[0].hasBody).toBe(true)
      expect(JSON.stringify(content).length).toBeLessThan(50_000)

      const last = await call('read_database', {
        databaseId: 'database_bugs',
        offset: 100,
        includeBodies: true,
      })
      const lastContent = last.result?.structuredContent as {
        database: { rows: Array<{ body: string }> }
        paging: { returned: number; nextOffset: number | null }
      }
      expect(lastContent.paging).toMatchObject({
        returned: 51,
        nextOffset: null,
      })
      expect(lastContent.database.rows[0].body).toHaveLength(5000)
    })

    it('read_page inlines a light preview of each database', async () => {
      const { repository, call } = boardHarness()
      for (let index = 0; index < 80; index++) {
        repository.board.rows.push(
          makeRow(`row_${index}`, {}, { body: 'y'.repeat(5000) }),
        )
      }

      const result = await call('read_page', { slug: 'private-workspace' })
      const content = result.result?.structuredContent as {
        page: {
          databases: Array<{
            rows: Array<Record<string, unknown>>
            rowCount: number
            archivedRowCount: number
            rowsTruncated: boolean
          }>
        }
      }
      const database = content.page.databases[0]
      expect(database.rows).toHaveLength(50)
      expect(database.rows[0]).not.toHaveProperty('body')
      expect(database).toMatchObject({
        rowCount: 81,
        archivedRowCount: 1,
        rowsTruncated: true,
      })
    })

    it('read_row returns one row with its body', async () => {
      const { call } = boardHarness()

      const result = await call('read_row', { rowId: 'row_login' })
      expect(result.result?.structuredContent).toMatchObject({
        row: {
          id: 'row_login',
          body: 'Steps to reproduce…',
          databaseId: 'database_bugs',
        },
      })
    })
  })

  describe('row values', () => {
    it('resolves column names, option names, members, dates and links', async () => {
      const { repository, call } = boardHarness()

      const result = await call('add_row', {
        databaseId: 'database_bugs',
        values: {
          Name: 'Upload button broken',
          status: 'done',
          Tags: [],
          Owner: ['ada@posty.social', 'Alan Turing'],
          Due: '2026-11-03T15:00:00Z',
          PRs: [
            'https://github.com/posty/app/pull/12',
            'https://github.com/posty/app/pull/14',
          ],
        },
        body: '![shot](/api/assets/asset_1/shot.png)',
      })

      expect(result.error).toBeUndefined()
      const row = repository.board.rows.at(-1)
      expect(row?.values).toEqual({
        prop_title: 'Upload button broken',
        prop_status: 'opt_done',
        prop_tags: null,
        prop_owner: ['user_ada', 'user_alan'],
        prop_due: '2026-11-03',
        prop_prs:
          'https://github.com/posty/app/pull/12\nhttps://github.com/posty/app/pull/14',
      })
      expect(row?.body).toBe('![shot](/api/assets/asset_1/shot.png)')
    })

    it('accepts newline-separated links and clears dates with null', async () => {
      const { repository, call } = boardHarness()

      await call('update_row', {
        rowId: 'row_login',
        values: {
          prop_prs:
            'https://github.com/posty/app/pull/1\n\nhttps://github.com/posty/app/pull/2',
          prop_due: '2026-12-01',
        },
      })
      expect(repository.board.rows[0].values.prop_prs).toBe(
        'https://github.com/posty/app/pull/1\nhttps://github.com/posty/app/pull/2',
      )
      expect(repository.board.rows[0].values.prop_due).toBe('2026-12-01')

      await call('update_row', {
        rowId: 'row_login',
        values: { prop_due: null },
      })
      expect(repository.board.rows[0].values.prop_due).toBeNull()
    })

    it('rejects a select value that matches no option, listing the options', async () => {
      const { repository, call } = boardHarness()

      const result = await call('update_row', {
        rowId: 'row_login',
        values: { prop_status: 'Blocked' },
      })

      expect(result.status).toBe(400)
      expect(result.error?.message).toContain('has no option "Blocked"')
      expect(result.error?.message).toContain('"To do", "Done"')
      expect(result.error?.message).toContain('add_database_option')
      expect(repository.board.rows[0].values.prop_status).toBe('opt_todo')
    })

    it('rejects unknown columns, bad dates, bad links and unknown people', async () => {
      const { call } = boardHarness()
      const update = (values: Record<string, unknown>) =>
        call('update_row', { rowId: 'row_login', values })

      expect((await update({ Priority: 'high' })).error?.message).toContain(
        'has no column "Priority"',
      )
      expect((await update({ Due: 'next tuesday' })).error?.message).toMatch(
        /ISO date/,
      )
      expect((await update({ Due: '2026-02-30' })).error?.message).toMatch(
        /ISO date/,
      )
      expect(
        (await update({ PRs: 'javascript:alert(1)' })).error?.message,
      ).toMatch(/only accepts http\(s\) URLs/)
      expect((await update({ Owner: 'grace@x.y' })).error?.message).toMatch(
        /no workspace member matches "grace@x.y"/,
      )
    })

    it('names the missing row id', async () => {
      const { call } = boardHarness()

      const result = await call('update_row', {
        rowId: 'row_ghost',
        values: { Name: 'x' },
      })
      expect(result.status).toBe(404)
      expect(result.error?.message).toBe(
        'Row "row_ghost" was not found in this workspace.',
      )
    })
  })

  it('set_page_property resolves option names and rejects unknown ones', async () => {
    const { repository, call } = boardHarness()
    const added = await call('add_page_property', {
      pageId: 'page_private-workspace',
      name: 'Priority',
      type: 'select',
    })
    const { propertyId } = (added.result?.structuredContent ?? {}) as {
      propertyId: string
    }
    await call('add_property_option', {
      pageId: 'page_private-workspace',
      propertyId,
      name: 'High',
    })

    await call('set_page_property', {
      pageId: 'page_private-workspace',
      propertyId,
      value: 'high',
    })
    expect(repository.pages[0].propertyValues[propertyId]).toBe('opt_1')

    const unknown = await call('set_page_property', {
      pageId: 'page_private-workspace',
      propertyId,
      value: 'Urgent',
    })
    expect(unknown.error?.message).toContain('has no option "Urgent"')
    expect(unknown.error?.message).toContain('add_property_option')

    const detached = await call('set_page_property', {
      pageId: 'page_deployment-handoff',
      propertyId,
      value: 'High',
    })
    expect(detached.status).toBe(404)
    expect(detached.error?.message).toContain('is not attached to page')
  })

  it('spells out invalid input in the error message', async () => {
    const { call } = boardHarness()

    const result = await call('read_database', {})
    expect(result.error?.message).toMatch(
      /^Invalid MCP tool input: databaseId:/,
    )
  })

  it('reports unknown tool names clearly', async () => {
    const { call } = boardHarness()

    const result = await call('archive_card', {})
    expect(result.error?.message).toBe(
      'Unknown tool "archive_card". Call tools/list for the available tools.',
    )
  })

  it('points page-option tools at the database-option tools', async () => {
    const result = await resolveMcpHttpRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { repository: null },
    )
    const tools = (
      result.body as {
        result: { tools: Array<{ name: string; description: string }> }
      }
    ).result.tools
    const descriptionOf = (name: string) =>
      tools.find((tool) => tool.name === name)?.description

    expect(descriptionOf('add_property_option')).toContain(
      'add_database_option',
    )
    expect(descriptionOf('rename_property_option')).toContain(
      'update_database_option',
    )
    expect(descriptionOf('remove_property_option')).toContain(
      'remove_database_option',
    )
  })
})
