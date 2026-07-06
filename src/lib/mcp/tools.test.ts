import { describe, expect, it } from 'vitest'

import type { WorkspaceAccess } from '#/lib/workspace/access'
import { createSeedWorkspaceRepository } from '#/lib/workspace/repository'

import { resolveMcpHttpRequest } from './tools'

const openAccess: WorkspaceAccess = {
  authRequired: false,
  user: null,
}

const deniedAccess: WorkspaceAccess = {
  authRequired: true,
  user: null,
}

describe('MCP workspace tools', () => {
  it('lists tools with an MCP JSON-RPC request', async () => {
    const result = await resolveMcpHttpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      },
      {
        access: openAccess,
        repository: createSeedWorkspaceRepository(),
      },
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

  it('searches pages through the repository when access is open', async () => {
    const result = await resolveMcpHttpRequest(
      {
        tool: 'search_pages',
        input: { query: 'deploy' },
      },
      {
        access: openAccess,
        repository: createSeedWorkspaceRepository(),
      },
    )

    expect(result).toMatchObject({
      status: 200,
      body: {
        structuredContent: {
          pages: [
            expect.objectContaining({
              slug: 'deployment-handoff',
            }),
          ],
        },
      },
    })
  })

  it('updates blocks through version-checked repository writes', async () => {
    const repository = createSeedWorkspaceRepository()
    const result = await resolveMcpHttpRequest(
      {
        tool: 'update_block',
        input: {
          pageId: 'page_private_workspace',
          blockId: 'block_summary',
          content: 'Updated by MCP',
          version: 1,
        },
      },
      {
        access: openAccess,
        repository,
      },
    )

    expect(result).toMatchObject({
      status: 200,
      body: {
        structuredContent: {
          update: {
            ok: true,
            content: 'Updated by MCP',
            version: 2,
          },
        },
      },
    })
    await expect(
      repository.getPage('private-workspace'),
    ).resolves.toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({
          id: 'block_summary',
          content: 'Updated by MCP',
        }),
      ]),
    })
  })

  it('denies tools when workspace auth is required and no user is present', async () => {
    const result = await resolveMcpHttpRequest(
      {
        tool: 'search_pages',
      },
      {
        access: deniedAccess,
        repository: createSeedWorkspaceRepository(),
      },
    )

    expect(result).toMatchObject({
      status: 401,
      body: {
        error: 'unauthenticated',
      },
    })
  })
})
