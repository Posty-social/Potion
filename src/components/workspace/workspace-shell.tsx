import { Link, useNavigate } from '@tanstack/react-router'
import {
  CalendarIcon,
  ChevronRightIcon,
  FileTextIcon,
  GalleryVerticalEndIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  KanbanSquareIcon,
  ListChecksIcon,
  ListIcon,
  LogOutIcon,
  UserRoundIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  QuoteIcon,
  SearchIcon,
  SparklesIcon,
  Table2Icon,
  TextIcon,
  Trash2Icon,
} from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { authClient } from '#/lib/auth-client'
import { cn } from '#/lib/utils'
import { renderInline } from '#/lib/workspace/markdown'
import { initialsFor } from '#/lib/workspace/types'
import type {
  DatabaseViewType,
  WorkspaceBlock,
  WorkspaceBlockType,
  WorkspaceDatabase,
  WorkspacePage,
  WorkspacePageSummary,
} from '#/lib/workspace/types'

import { DatabaseElement } from './database-element'
import { PageProperties } from './page-properties'
import { usePageRealtime, type PageDocViewer } from './use-page-realtime'
import {
  useWorkspaceMutations,
  type WorkspaceMutations,
} from './use-workspace-mutations'
import { WorkspaceSwitcher } from './workspace-switcher'

type WorkspaceShellProps = {
  page: WorkspacePage
  pages: WorkspacePageSummary[]
}

export function WorkspaceShell({ page, pages }: WorkspaceShellProps) {
  const mutations = useWorkspaceMutations()
  const navigate = useNavigate()
  // Live updates + who else is viewing: connected to the page's Durable Object.
  const viewers = usePageRealtime(page.id)

  const createTopLevelPage = async () => {
    const summary = await mutations.createPage({ title: 'Untitled' })
    await navigate({
      to: '/p/$pageSlug',
      params: { pageSlug: summary.slug },
    })
  }

  const createSubPage = async (parentPageId: string) => {
    const summary = await mutations.createPage({
      title: 'Untitled',
      parentPageId,
    })
    await navigate({
      to: '/p/$pageSlug',
      params: { pageSlug: summary.slug },
    })
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Sidebar
        pages={pages}
        activeSlug={page.slug}
        onNewPage={createTopLevelPage}
        onNewSubPage={createSubPage}
      />

      <main className="min-w-0 border-l border-[var(--workspace-line)] bg-[var(--workspace-paper)]">
        <PageHeader
          page={page}
          viewers={viewers}
          onNewSubPage={() => createSubPage(page.id)}
          onDelete={async () => {
            await mutations.deletePage({ pageId: page.id })
            await navigate({ to: '/' })
          }}
        />

        <div className="h-[calc(100vh-3.5rem)] overflow-y-auto">
          <div className="mx-auto flex w-full flex-col gap-1 px-6 py-8 md:px-16 lg:px-24">
            <PageTitle page={page} mutations={mutations} />
            <PageProperties page={page} mutations={mutations} />
            <BlockEditor page={page} mutations={mutations} />
            <ChildPages
              page={page}
              onNewSubPage={() => createSubPage(page.id)}
            />
          </div>
        </div>
      </main>
    </div>
  )
}

// --- Sidebar -------------------------------------------------------------

function Sidebar({
  pages,
  activeSlug,
  onNewPage,
  onNewSubPage,
}: {
  pages: WorkspacePageSummary[]
  activeSlug: string
  onNewPage: () => void
  onNewSubPage: (parentPageId: string) => void
}) {
  const { data: session } = authClient.useSession()
  const [query, setQuery] = useState('')
  // The session store is client-only; gate user-dependent rendering behind a
  // mount flag so SSR and first client render match (avoids hydration errors).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, WorkspacePageSummary[]>()
    for (const page of pages) {
      const key = page.parentPageId
      const list = map.get(key) ?? []
      list.push(page)
      map.set(key, list)
    }
    return map
  }, [pages])

  const filtered = query.trim()
    ? pages.filter((page) =>
        page.title.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : null

  const user = mounted ? session?.user : undefined

  return (
    <aside className="hidden min-h-screen flex-col bg-[var(--workspace-side)] lg:flex">
      <WorkspaceSwitcher />

      <div className="px-3 pb-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--workspace-ink-soft)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 pl-8"
            placeholder="Search pages"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-1">
        {filtered ? (
          <div className="flex flex-col gap-0.5">
            {filtered.map((page) => (
              <Link
                key={page.id}
                to="/p/$pageSlug"
                params={{ pageSlug: page.slug }}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--workspace-ink-soft)] no-underline hover:bg-[var(--workspace-hover)]',
                  page.slug === activeSlug &&
                    'bg-[var(--workspace-hover)] font-semibold text-[var(--workspace-ink)]',
                )}
              >
                <span>{page.icon}</span>
                <span className="truncate">{page.title || 'Untitled'}</span>
              </Link>
            ))}
            {filtered.length === 0 ? (
              <p className="px-2 py-2 text-xs text-[var(--workspace-ink-soft)]">
                No pages match “{query}”.
              </p>
            ) : null}
          </div>
        ) : (
          <PageTree
            parentId={null}
            childrenByParent={childrenByParent}
            activeSlug={activeSlug}
            onNewSubPage={onNewSubPage}
            depth={0}
          />
        )}
      </nav>

      <div className="px-2 py-2">
        <Button
          variant="ghost"
          className="w-full justify-start text-[var(--workspace-ink-soft)]"
          onClick={onNewPage}
        >
          <PlusIcon className="size-4" />
          New page
        </Button>
      </div>

      <div className="border-t border-[var(--workspace-line)] p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--workspace-hover)]"
            >
              {user ? (
                <>
                  <Avatar className="size-7 rounded-md">
                    <AvatarImage
                      src={`/api/users/${user.id}/avatar`}
                      alt={user.name ?? 'Profile picture'}
                    />
                    <AvatarFallback className="rounded-md bg-[var(--accent-teal)] text-xs text-white">
                      {initialsFor(user.name ?? '', user.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {user.name || 'Account'}
                    </p>
                    <p className="truncate text-xs text-[var(--workspace-ink-soft)]">
                      {user.email}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <span className="size-7 shrink-0 animate-pulse rounded-md bg-[var(--workspace-hover)]" />
                  <span className="h-3.5 w-28 animate-pulse rounded bg-[var(--workspace-hover)]" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="truncate font-normal text-[var(--workspace-ink-soft)]">
              {user?.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings/account" className="no-underline">
                <UserRoundIcon className="size-4" />
                Account settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                await authClient.signOut()
                window.location.assign('/login')
              }}
            >
              <LogOutIcon className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  )
}

function PageTree({
  parentId,
  childrenByParent,
  activeSlug,
  onNewSubPage,
  depth,
}: {
  parentId: string | null
  childrenByParent: Map<string | null, WorkspacePageSummary[]>
  activeSlug: string
  onNewSubPage: (parentPageId: string) => void
  depth: number
}) {
  const children = childrenByParent.get(parentId) ?? []

  if (children.length === 0 && depth === 0) {
    return (
      <p className="px-2 py-2 text-xs text-[var(--workspace-ink-soft)]">
        No pages yet.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      {children.map((page) => (
        <PageTreeNode
          key={page.id}
          page={page}
          childrenByParent={childrenByParent}
          activeSlug={activeSlug}
          onNewSubPage={onNewSubPage}
          depth={depth}
        />
      ))}
    </div>
  )
}

function PageTreeNode({
  page,
  childrenByParent,
  activeSlug,
  onNewSubPage,
  depth,
}: {
  page: WorkspacePageSummary
  childrenByParent: Map<string | null, WorkspacePageSummary[]>
  activeSlug: string
  onNewSubPage: (parentPageId: string) => void
  depth: number
}) {
  const children = childrenByParent.get(page.id) ?? []
  const hasChildren = children.length > 0
  const [expanded, setExpanded] = useState(true)

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md pr-1 hover:bg-[var(--workspace-hover)]',
          page.slug === activeSlug && 'bg-[var(--workspace-hover)]',
        )}
        style={{ paddingLeft: depth * 12 }}
      >
        <button
          type="button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={() => setExpanded((value) => !value)}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded text-[var(--workspace-ink-soft)]',
            !hasChildren && 'invisible',
          )}
        >
          <ChevronRightIcon
            className={cn(
              'size-3.5 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        </button>
        <Link
          to="/p/$pageSlug"
          params={{ pageSlug: page.slug }}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-sm text-[var(--workspace-ink-soft)] no-underline',
            page.slug === activeSlug &&
              'font-semibold text-[var(--workspace-ink)]',
          )}
        >
          <span className="shrink-0">{page.icon}</span>
          <span className="truncate">{page.title || 'Untitled'}</span>
        </Link>
        <button
          type="button"
          aria-label="Add sub-page"
          onClick={() => {
            setExpanded(true)
            onNewSubPage(page.id)
          }}
          className="shrink-0 text-[var(--workspace-ink-soft)] opacity-0 group-hover:opacity-100 hover:text-[var(--workspace-ink)]"
        >
          <PlusIcon className="size-4" />
        </button>
      </div>
      {hasChildren && expanded ? (
        <PageTree
          parentId={page.id}
          childrenByParent={childrenByParent}
          activeSlug={activeSlug}
          onNewSubPage={onNewSubPage}
          depth={depth + 1}
        />
      ) : null}
    </div>
  )
}

// --- Header --------------------------------------------------------------

function PageHeader({
  page,
  viewers,
  onNewSubPage,
  onDelete,
}: {
  page: WorkspacePage
  viewers: PageDocViewer[]
  onNewSubPage: () => void
  onDelete: () => void
}) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-[var(--workspace-line)] bg-[var(--workspace-paper-glass)] px-4 backdrop-blur md:px-6">
      <nav className="flex min-w-0 items-center gap-1 text-sm">
        {page.ancestors.map((ancestor) => (
          <span key={ancestor.id} className="flex items-center gap-1">
            <Link
              to="/p/$pageSlug"
              params={{ pageSlug: ancestor.slug }}
              className="flex items-center gap-1 truncate text-[var(--workspace-ink-soft)] no-underline hover:text-[var(--workspace-ink)]"
            >
              <span>{ancestor.icon}</span>
              <span className="max-w-32 truncate">
                {ancestor.title || 'Untitled'}
              </span>
            </Link>
            <ChevronRightIcon className="size-3.5 shrink-0 text-[var(--workspace-ink-soft)]" />
          </span>
        ))}
        <span className="flex min-w-0 items-center gap-1 font-semibold">
          <span>{page.icon}</span>
          <span className="truncate">{page.title || 'Untitled'}</span>
        </span>
      </nav>

      <div className="flex items-center gap-2">
        <PresenceAvatars viewers={viewers} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Page actions">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onNewSubPage}>
              <PlusIcon className="size-4" />
              Add sub-page
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete}>
              <Trash2Icon className="size-4" />
              Delete page
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

/** Who else is viewing this page right now (other users and your other tabs). */
function PresenceAvatars({ viewers }: { viewers: PageDocViewer[] }) {
  if (viewers.length === 0) {
    return null
  }

  const shown = viewers.slice(0, 4)
  const overflow = viewers.length - shown.length

  return (
    <div
      className="flex items-center -space-x-1.5"
      aria-label={`Also viewing: ${viewers.map((viewer) => viewer.name).join(', ')}`}
    >
      {shown.map((viewer) => (
        <Avatar
          key={viewer.clientId}
          title={viewer.name}
          className="size-6 rounded-full ring-2 ring-[var(--workspace-paper)]"
        >
          <AvatarFallback className="rounded-full bg-[var(--accent-teal)] text-[10px] text-white">
            {initialsFor(viewer.name, viewer.name)}
          </AvatarFallback>
        </Avatar>
      ))}
      {overflow > 0 ? (
        <span className="z-10 flex size-6 items-center justify-center rounded-full bg-[var(--workspace-hover)] text-[10px] font-semibold text-[var(--workspace-ink-soft)] ring-2 ring-[var(--workspace-paper)]">
          +{overflow}
        </span>
      ) : null}
    </div>
  )
}

// --- Page body -----------------------------------------------------------

function PageTitle({
  page,
  mutations,
}: {
  page: WorkspacePage
  mutations: WorkspaceMutations
}) {
  return (
    <input
      key={`page-title:${page.id}:${page.title}`}
      defaultValue={page.title}
      placeholder="Untitled"
      onBlur={(event) => {
        const value = event.target.value.trim()
        if (value && value !== page.title) {
          void mutations.renamePage({ pageId: page.id, title: value })
        }
      }}
      className="display-title mb-2 w-full bg-transparent text-4xl font-bold outline-none placeholder:text-[var(--workspace-line)]"
      aria-label="Page title"
    />
  )
}

function BlockEditor({
  page,
  mutations,
}: {
  page: WorkspacePage
  mutations: WorkspaceMutations
}) {
  const databaseByBlock = useMemo(
    () => new Map(page.databases.map((d) => [d.blockId, d])),
    [page.databases],
  )

  // Which block to move the caret into after it's created (e.g. after Enter).
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null)

  const addBlock = (kind: AddBlockKind, afterBlockId?: string) =>
    mutations.createBlock({
      pageId: page.id,
      type: kind.type,
      afterBlockId,
      initialView: kind.view,
    })

  // Enter inside a block: insert a fresh paragraph right after it and focus it.
  const addParagraphAfter = async (afterBlockId: string) => {
    const { blockId } = await mutations.createBlock({
      pageId: page.id,
      type: 'paragraph',
      afterBlockId,
    })
    setFocusBlockId(blockId)
  }

  // Typing in the trailing area: append a paragraph at the end. No afterBlockId
  // so the server appends using a fresh end position (safe for rapid Enters).
  const createAtEnd = (content: string) =>
    mutations.createBlock({
      pageId: page.id,
      type: 'paragraph',
      content: content || undefined,
    })

  return (
    <div className="flex flex-col">
      {page.blocks.map((block) => (
        <BlockRow
          key={block.id}
          onAdd={(kind) => addBlock(kind, block.id)}
          onDelete={() => mutations.deleteBlock({ blockId: block.id })}
        >
          <BlockView
            page={page}
            block={block}
            mutations={mutations}
            database={
              block.databaseId ? (databaseByBlock.get(block.id) ?? null) : null
            }
            focusOnMount={block.id === focusBlockId}
            onFocused={() => setFocusBlockId(null)}
            onEnter={() => void addParagraphAfter(block.id)}
          />
        </BlockRow>
      ))}

      <AddBlockMenu
        trigger={
          <button
            type="button"
            className="mt-1 flex w-fit items-center gap-1.5 rounded-md px-1 py-1.5 text-sm text-[var(--workspace-ink-soft)] hover:bg-[var(--workspace-hover)]"
          >
            <PlusIcon className="size-4" />
            Add a block
          </button>
        }
        onSelect={(kind) => addBlock(kind)}
      />

      {/* Notion-style: click into the empty space and just type — a paragraph
          is created for you. Enter starts another. No need to add a block. */}
      <TrailingType hasBlocks={page.blocks.length > 0} onCreate={createAtEnd} />
    </div>
  )
}

/**
 * The always-present editable area below the page's blocks. Typing here (or
 * pressing Enter) materialises a paragraph block, so you never have to reach
 * for the "Add a block" menu. It fills the space below the content so clicking
 * anywhere in the empty page lands the caret here.
 */
function TrailingType({
  hasBlocks,
  onCreate,
}: {
  hasBlocks: boolean
  onCreate: (content: string) => Promise<unknown>
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const flush = (keepFocus: boolean) => {
    const el = ref.current
    if (!el) {
      return
    }
    const value = el.value
    el.value = ''
    void onCreate(value)
    if (keepFocus) {
      el.focus()
    }
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      placeholder={
        hasBlocks ? '' : 'Write something, or press Enter to start a block…'
      }
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          flush(true)
        }
      }}
      onBlur={(event) => {
        if (event.target.value.trim() !== '') {
          flush(false)
        }
      }}
      className="mt-1 min-h-[38vh] w-full resize-none bg-transparent leading-7 outline-none placeholder:text-[var(--workspace-line)]"
      aria-label="Type to add content"
    />
  )
}

type AddBlockKind = { type: WorkspaceBlockType; view?: DatabaseViewType }

function BlockRow({
  children,
  onAdd,
  onDelete,
}: {
  children: ReactNode
  onAdd: (kind: AddBlockKind) => void
  onDelete: () => void
}) {
  return (
    <div className="group relative flex items-start gap-1">
      <div className="flex w-10 shrink-0 items-center justify-end gap-0.5 pt-1.5 opacity-0 group-hover:opacity-100">
        <AddBlockMenu
          trigger={
            <button
              type="button"
              aria-label="Add block below"
              className="flex size-5 items-center justify-center rounded text-[var(--workspace-ink-soft)] hover:bg-[var(--workspace-hover)]"
            >
              <PlusIcon className="size-4" />
            </button>
          }
          onSelect={onAdd}
        />
        <button
          type="button"
          aria-label="Delete block"
          onClick={onDelete}
          className="flex size-5 items-center justify-center rounded text-[var(--workspace-ink-soft)] hover:bg-[var(--workspace-hover)] hover:text-[var(--accent-rust)]"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
      <div className="min-w-0 flex-1 py-0.5">{children}</div>
    </div>
  )
}

type AddMenuItem = {
  label: string
  icon: typeof TextIcon
  kind: AddBlockKind
}

const BASIC_ITEMS: AddMenuItem[] = [
  { label: 'Text', icon: TextIcon, kind: { type: 'paragraph' } },
  { label: 'Heading 1', icon: Heading1Icon, kind: { type: 'heading_1' } },
  { label: 'Heading 2', icon: Heading2Icon, kind: { type: 'heading_2' } },
  { label: 'Heading 3', icon: Heading3Icon, kind: { type: 'heading_3' } },
  { label: 'To-do', icon: ListChecksIcon, kind: { type: 'to_do' } },
  { label: 'Quote', icon: QuoteIcon, kind: { type: 'quote' } },
  { label: 'Callout', icon: SparklesIcon, kind: { type: 'callout' } },
  { label: 'Divider', icon: MinusIcon, kind: { type: 'divider' } },
]

// Each database "view type" creates a database (the storage) opening in that
// view. The data lives in the database abstraction; the view is how you see it.
const DATABASE_ITEMS: AddMenuItem[] = [
  {
    label: 'Table',
    icon: Table2Icon,
    kind: { type: 'database', view: 'table' },
  },
  {
    label: 'Board',
    icon: KanbanSquareIcon,
    kind: { type: 'database', view: 'board' },
  },
  { label: 'List', icon: ListIcon, kind: { type: 'database', view: 'list' } },
  {
    label: 'Gallery',
    icon: GalleryVerticalEndIcon,
    kind: { type: 'database', view: 'gallery' },
  },
  {
    label: 'Calendar',
    icon: CalendarIcon,
    kind: { type: 'database', view: 'calendar' },
  },
]

function AddBlockMenu({
  trigger,
  onSelect,
}: {
  trigger: ReactNode
  onSelect: (kind: AddBlockKind) => void
}) {
  const renderItem = (item: AddMenuItem) => {
    const Icon = item.icon
    return (
      <DropdownMenuItem key={item.label} onClick={() => onSelect(item.kind)}>
        <Icon className="size-4" />
        {item.label}
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel>Basic blocks</DropdownMenuLabel>
        {BASIC_ITEMS.map(renderItem)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Database</DropdownMenuLabel>
        {DATABASE_ITEMS.map(renderItem)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BlockView({
  page,
  block,
  database,
  mutations,
  focusOnMount,
  onFocused,
  onEnter,
}: {
  page: WorkspacePage
  block: WorkspaceBlock
  database: WorkspaceDatabase | null
  mutations: WorkspaceMutations
  focusOnMount?: boolean
  onFocused?: () => void
  onEnter?: () => void
}) {
  if (block.type === 'divider') {
    return <hr className="my-2 border-[var(--workspace-line)]" />
  }

  if (block.type === 'database') {
    if (!database) {
      return null
    }
    return <DatabaseElement database={database} mutations={mutations} />
  }

  if (block.type === 'to_do') {
    return (
      <div className="flex items-start gap-2">
        <Checkbox
          className="mt-1.5"
          checked={block.checked}
          onCheckedChange={(checked) =>
            mutations.setBlockChecked({
              blockId: block.id,
              checked: checked === true,
            })
          }
          aria-label="Toggle to-do"
        />
        <BlockTextInput
          page={page}
          block={block}
          mutations={mutations}
          focusOnMount={focusOnMount}
          onFocused={onFocused}
          onEnter={onEnter}
          className={cn(
            'text-base',
            block.checked && 'text-[var(--workspace-ink-soft)] line-through',
          )}
          placeholder="To-do"
        />
      </div>
    )
  }

  if (block.type === 'callout') {
    return (
      <div className="flex gap-2 rounded-lg border border-[var(--callout-line)] bg-[var(--callout-bg)] p-3">
        <SparklesIcon className="mt-1 size-5 shrink-0 text-[var(--accent-brass)]" />
        <BlockTextInput
          page={page}
          block={block}
          mutations={mutations}
          focusOnMount={focusOnMount}
          onFocused={onFocused}
          onEnter={onEnter}
          className="text-base leading-7"
          placeholder="Callout"
        />
      </div>
    )
  }

  if (block.type === 'quote') {
    return (
      <div className="border-l-4 border-[var(--accent-plum)] pl-3">
        <BlockTextInput
          page={page}
          block={block}
          mutations={mutations}
          focusOnMount={focusOnMount}
          onFocused={onFocused}
          onEnter={onEnter}
          className="text-base leading-7 text-[var(--workspace-ink-soft)] italic"
          placeholder="Quote"
        />
      </div>
    )
  }

  const headingClass =
    block.type === 'heading_1'
      ? 'display-title text-3xl font-bold'
      : block.type === 'heading_2'
        ? 'text-2xl font-bold'
        : block.type === 'heading_3'
          ? 'text-xl font-bold'
          : 'text-base leading-7'

  return (
    <BlockTextInput
      page={page}
      block={block}
      mutations={mutations}
      focusOnMount={focusOnMount}
      onFocused={onFocused}
      onEnter={onEnter}
      className={headingClass}
      placeholder={block.type.startsWith('heading') ? 'Heading' : 'Type here…'}
    />
  )
}

function BlockTextInput({
  page,
  block,
  mutations,
  className,
  placeholder,
  focusOnMount,
  onFocused,
  onEnter,
}: {
  page: WorkspacePage
  block: WorkspaceBlock
  mutations: WorkspaceMutations
  className?: string
  placeholder?: string
  focusOnMount?: boolean
  onFocused?: () => void
  onEnter?: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [editing, setEditing] = useState(false)

  const resize = () => {
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }

  useLayoutEffect(resize, [])

  // On entering edit mode, focus the textarea and drop the caret at the end.
  useEffect(() => {
    const el = ref.current
    if (editing && el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      resize()
    }
  }, [editing])

  // A freshly created block (e.g. via Enter) asks to receive the caret.
  useEffect(() => {
    const el = ref.current
    if (focusOnMount && el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      resize()
      onFocused?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOnMount])

  // Rendered (read) mode: show formatted Markdown until the user clicks in.
  // Empty blocks skip this so the placeholder + caret are immediately usable.
  if (!editing && block.content.trim() !== '') {
    // The click target is a real, full-size overlay button. It can't wrap the
    // content directly because the rendered Markdown may contain links, which
    // are illegal descendants of a <button>.
    return (
      <div className="relative">
        <div className={cn('whitespace-pre-wrap break-words', className)}>
          {renderInline(block.content)}
        </div>
        <button
          type="button"
          aria-label="Edit text"
          onClick={() => setEditing(true)}
          className="absolute inset-0 size-full cursor-text"
        />
      </div>
    )
  }

  return (
    <textarea
      ref={ref}
      key={`${block.id}:${block.version}`}
      defaultValue={block.content}
      placeholder={placeholder}
      rows={1}
      onInput={resize}
      onKeyDown={(event) => {
        // Enter starts a new block (Shift+Enter inserts a newline). The edited
        // content is committed by the blur that follows the focus move.
        if (event.key === 'Enter' && !event.shiftKey && onEnter) {
          event.preventDefault()
          onEnter()
        }
      }}
      onBlur={(event) => {
        const value = event.target.value
        setEditing(false)
        if (value !== block.content) {
          void mutations
            .updateBlock({
              pageId: page.id,
              blockId: block.id,
              content: value,
              version: block.version,
            })
            .catch(() => mutations.invalidate())
        }
      }}
      className={cn(
        'w-full resize-none bg-transparent outline-none placeholder:text-[var(--workspace-line)]',
        className,
      )}
    />
  )
}

function ChildPages({
  page,
  onNewSubPage,
}: {
  page: WorkspacePage
  onNewSubPage: () => void
}) {
  return (
    <div className="mt-8 border-t border-[var(--workspace-line)] pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold tracking-wide text-[var(--workspace-ink-soft)] uppercase">
          Sub-pages
        </h2>
        <button
          type="button"
          onClick={onNewSubPage}
          className="flex items-center gap-1 text-xs font-medium text-[var(--workspace-ink-soft)] hover:text-[var(--workspace-ink)]"
        >
          <PlusIcon className="size-3.5" />
          Add
        </button>
      </div>
      {page.childPages.length === 0 ? (
        <p className="text-sm text-[var(--workspace-ink-soft)]">
          No sub-pages yet.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {page.childPages.map((child) => (
            <Link
              key={child.id}
              to="/p/$pageSlug"
              params={{ pageSlug: child.slug }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm no-underline hover:bg-[var(--workspace-hover)]"
            >
              <FileTextIcon className="size-4 text-[var(--workspace-ink-soft)]" />
              <span className="truncate">{child.title || 'Untitled'}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
