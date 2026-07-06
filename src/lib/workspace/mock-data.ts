import type { CollectionView } from './schemas'

export const DEFAULT_PAGE_SLUG = 'private-workspace'

export type JsonPrimitive = string | number | boolean | null

export type WorkspaceUser = {
  id: string
  name: string
  email: string
  initials: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
}

export type WorkspacePageSummary = {
  id: string
  slug: string
  title: string
  icon: string
  parentPageId?: string
  updatedAt: string
}

export type WorkspaceBlock = {
  id: string
  type:
    | 'paragraph'
    | 'heading_1'
    | 'heading_2'
    | 'to_do'
    | 'quote'
    | 'callout'
    | 'database'
  content: string
  checked?: boolean
  collectionId?: string
  properties?: Record<string, JsonPrimitive | JsonPrimitive[]>
}

export type WorkspaceField = {
  id: string
  name: string
  type: 'text' | 'select' | 'date' | 'person' | 'checkbox'
  options?: Array<{ id: string; name: string; color: string }>
}

export type WorkspaceCollectionRow = {
  id: string
  title: string
  position: string
  values: Record<string, string | boolean | string[]>
}

export type WorkspaceCollection = {
  id: string
  title: string
  fields: WorkspaceField[]
  rows: WorkspaceCollectionRow[]
  views: Array<{ id: CollectionView; name: string }>
}

export type WorkspaceComment = {
  id: string
  author: string
  body: string
  target: string
  resolved: boolean
}

export type WorkspacePage = WorkspacePageSummary & {
  owner: WorkspaceUser
  collaborators: WorkspaceUser[]
  blocks: WorkspaceBlock[]
  collections: WorkspaceCollection[]
  comments: WorkspaceComment[]
  share: {
    publicEnabled: boolean
    includeChildren: boolean
    tokenPreview: string
  }
}

export const currentUser: WorkspaceUser = {
  id: 'user_david',
  name: 'David McDonald',
  email: 'contactdavidmcdonald@gmail.com',
  initials: 'DM',
  role: 'owner',
}

const bossUser: WorkspaceUser = {
  id: 'user_boss',
  name: 'Boss',
  email: 'variables@example.com',
  initials: 'B',
  role: 'admin',
}

export const variableChecklist = [
  { key: 'CLOUDFLARE_ACCOUNT_ID', status: 'Boss' },
  { key: 'APP_DOMAIN', status: 'Boss' },
  { key: 'CLOUDFLARE_API_TOKEN', status: 'Secret' },
  { key: 'R2_ACCESS_KEY_ID', status: 'Secret' },
  { key: 'R2_SECRET_ACCESS_KEY', status: 'Secret' },
  { key: 'BETTER_AUTH_SECRET', status: 'Generated' },
  { key: 'GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID', status: 'Optional' },
]

export const pages: WorkspacePage[] = [
  {
    id: 'page_private_workspace',
    slug: DEFAULT_PAGE_SLUG,
    title: 'Private workspace',
    icon: 'P',
    updatedAt: '2026-07-06T16:45:00+10:00',
    owner: currentUser,
    collaborators: [currentUser, bossUser],
    share: {
      publicEnabled: false,
      includeChildren: false,
      tokenPreview: 'pub_live_link_disabled',
    },
    blocks: [
      {
        id: 'block_intro',
        type: 'heading_1',
        content: 'Private workspace',
      },
      {
        id: 'block_summary',
        type: 'paragraph',
        content:
          'A self-hosted place for private notes, messy drafts, tables, comments, files, and MCP access without paying per invited member.',
      },
      {
        id: 'block_scope',
        type: 'callout',
        content:
          'Deployment values stay outside source. The app reads Cloudflare, R2, OAuth, and auth secrets from repo variables or Worker bindings.',
      },
      {
        id: 'block_reference',
        type: 'quote',
        content:
          'Reference import: a private chat about housing options, a possible move, and a 20-month planning window. Keep imported chats private by default.',
      },
      {
        id: 'block_tasks_title',
        type: 'heading_2',
        content: 'Build track',
      },
      {
        id: 'block_task_schema',
        type: 'to_do',
        checked: true,
        content:
          'Create D1 schema for pages, blocks, comments, assets, public links, and collections.',
      },
      {
        id: 'block_task_auth',
        type: 'to_do',
        checked: true,
        content:
          'Wire better-auth with email/password, organizations, optional OAuth, API keys, and MCP auth.',
      },
      {
        id: 'block_task_editor',
        type: 'to_do',
        checked: false,
        content:
          'Replace mock document reads with server functions and TanStack Query backed by D1.',
      },
      {
        id: 'block_database',
        type: 'database',
        content: 'Workspace build board',
        collectionId: 'collection_build',
      },
    ],
    collections: [
      {
        id: 'collection_build',
        title: 'Workspace build board',
        views: [
          { id: 'table', name: 'Table' },
          { id: 'kanban', name: 'Kanban' },
          { id: 'list', name: 'List' },
          { id: 'gallery', name: 'Gallery' },
          { id: 'calendar', name: 'Calendar' },
        ],
        fields: [
          { id: 'status', name: 'Status', type: 'select' },
          { id: 'owner', name: 'Owner', type: 'person' },
          { id: 'due', name: 'Due', type: 'date' },
          { id: 'sensitive', name: 'Private', type: 'checkbox' },
        ],
        rows: [
          {
            id: 'row_schema',
            title: 'Data model and migrations',
            position: 'a0',
            values: {
              status: 'Done',
              owner: 'David',
              due: '2026-07-06',
              sensitive: false,
            },
          },
          {
            id: 'row_editor',
            title: 'Block editor vertical slice',
            position: 'b0',
            values: {
              status: 'In progress',
              owner: 'David',
              due: '2026-07-07',
              sensitive: false,
            },
          },
          {
            id: 'row_import',
            title: 'Private chat import flow',
            position: 'c0',
            values: {
              status: 'Next',
              owner: 'Boss',
              due: '2026-07-09',
              sensitive: true,
            },
          },
          {
            id: 'row_mcp',
            title: 'Remote MCP tools',
            position: 'd0',
            values: {
              status: 'Planned',
              owner: 'David',
              due: '2026-07-12',
              sensitive: false,
            },
          },
        ],
      },
    ],
    comments: [
      {
        id: 'comment_variables',
        author: 'Boss',
        body: 'I will supply production variables and OAuth credentials.',
        target: 'Deployment',
        resolved: false,
      },
      {
        id: 'comment_privacy',
        author: 'David',
        body: 'Imported chats should default to private pages with public links disabled.',
        target: 'Reference import',
        resolved: true,
      },
    ],
  },
  {
    id: 'page_deployment',
    slug: 'deployment-handoff',
    title: 'Deployment handoff',
    icon: 'D',
    updatedAt: '2026-07-06T16:35:00+10:00',
    owner: currentUser,
    collaborators: [currentUser, bossUser],
    share: {
      publicEnabled: false,
      includeChildren: false,
      tokenPreview: 'pub_disabled',
    },
    blocks: [
      {
        id: 'block_deploy_heading',
        type: 'heading_1',
        content: 'Deployment handoff',
      },
      {
        id: 'block_deploy_copy',
        type: 'paragraph',
        content:
          'The repo is prepared for Cloudflare Workers, D1, R2, Durable Objects, Better Auth, Drizzle, and Pulumi. Production values are supplied outside source.',
      },
      {
        id: 'block_deploy_todo',
        type: 'to_do',
        checked: false,
        content: 'Set GitHub Actions variables and secrets, then push to main.',
      },
    ],
    collections: [],
    comments: [],
  },
]

export function listPages(): WorkspacePageSummary[] {
  return pages.map((page) => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    icon: page.icon,
    parentPageId: page.parentPageId,
    updatedAt: page.updatedAt,
  }))
}

export function getPage(slug: string): WorkspacePage | undefined {
  return pages.find((page) => page.slug === slug)
}
