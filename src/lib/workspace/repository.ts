import { createImportSlug } from './import'
import { currentUser, pages as seedPages } from './mock-data'
import type { WorkspacePage, WorkspacePageSummary } from './mock-data'
import {
  importPrivateChatSchema,
  type ImportPrivateChatInput,
  type UpdateBlockInput,
} from './schemas'

type WorkspaceRepositoryErrorCode =
  | 'page_not_found'
  | 'block_not_found'
  | 'version_conflict'

export class WorkspaceRepositoryError extends Error {
  constructor(
    readonly code: WorkspaceRepositoryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceRepositoryError'
  }
}

export type WorkspaceBlockUpdate = {
  ok: true
  pageId: string
  blockId: string
  content: string
  version: number
}

export type WorkspaceRepository = {
  listPages: () => Promise<WorkspacePageSummary[]>
  getPage: (slug: string) => Promise<WorkspacePage | undefined>
  updateBlock: (input: UpdateBlockInput) => Promise<WorkspaceBlockUpdate>
  importPrivateChat: (
    input: ImportPrivateChatInput,
  ) => Promise<WorkspacePageSummary>
}

type WorkspaceState = {
  pages: WorkspacePage[]
  blockVersions: Map<string, number>
}

export function createSeedWorkspaceRepository(
  pages: WorkspacePage[] = seedPages,
): WorkspaceRepository {
  const state: WorkspaceState = {
    pages: clone(pages),
    blockVersions: new Map(),
  }

  for (const page of state.pages) {
    for (const block of page.blocks) {
      state.blockVersions.set(block.id, 1)
    }
  }

  return {
    async listPages() {
      return state.pages.map(toPageSummary)
    },
    async getPage(slug) {
      const page = state.pages.find((candidate) => candidate.slug === slug)

      return page ? clone(page) : undefined
    },
    async updateBlock(input) {
      const page = state.pages.find(
        (candidate) => candidate.id === input.pageId,
      )

      if (!page) {
        throw new WorkspaceRepositoryError(
          'page_not_found',
          'Workspace page was not found.',
        )
      }

      const block = page.blocks.find(
        (candidate) => candidate.id === input.blockId,
      )

      if (!block) {
        throw new WorkspaceRepositoryError(
          'block_not_found',
          'Workspace block was not found.',
        )
      }

      const currentVersion = state.blockVersions.get(block.id) ?? 1

      if (input.version !== currentVersion) {
        throw new WorkspaceRepositoryError(
          'version_conflict',
          'Workspace block has changed since it was loaded.',
        )
      }

      block.content = input.content
      const nextVersion = currentVersion + 1
      state.blockVersions.set(block.id, nextVersion)
      page.updatedAt = new Date().toISOString()

      return {
        ok: true,
        pageId: page.id,
        blockId: block.id,
        content: block.content,
        version: nextVersion,
      }
    },
    async importPrivateChat(input) {
      const data = importPrivateChatSchema.parse(input)
      const slug = createImportSlug(
        data.title,
        new Set(state.pages.map((page) => page.slug)),
      )
      const now = new Date().toISOString()
      const pageId = `page_import_${crypto.randomUUID()}`
      const transcriptBlockId = `block_import_transcript_${crypto.randomUUID()}`
      const importedPage: WorkspacePage = {
        id: pageId,
        slug,
        title: data.title,
        icon: 'I',
        updatedAt: now,
        owner: currentUser,
        collaborators: [currentUser],
        share: {
          publicEnabled: false,
          includeChildren: false,
          tokenPreview: 'pub_disabled',
        },
        blocks: [
          {
            id: `block_import_title_${crypto.randomUUID()}`,
            type: 'heading_1',
            content: data.title,
          },
          {
            id: `block_import_notice_${crypto.randomUUID()}`,
            type: 'callout',
            content:
              'Imported privately. Public links are disabled until explicitly enabled.',
          },
          {
            id: transcriptBlockId,
            type: 'quote',
            content: data.transcript,
            properties: {
              source: data.source ?? 'Private chat import',
            },
          },
        ],
        collections: [],
        comments: [],
      }

      state.pages.unshift(importedPage)

      for (const block of importedPage.blocks) {
        state.blockVersions.set(block.id, 1)
      }

      return toPageSummary(importedPage)
    },
  }
}

export const workspaceRepository = createSeedWorkspaceRepository()

function toPageSummary(page: WorkspacePage): WorkspacePageSummary {
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    icon: page.icon,
    parentPageId: page.parentPageId,
    updatedAt: page.updatedAt,
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
