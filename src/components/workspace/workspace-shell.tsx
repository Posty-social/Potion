import { Link } from '@tanstack/react-router'
import {
  ArchiveIcon,
  CalendarDaysIcon,
  CheckIcon,
  ChevronRightIcon,
  CloudIcon,
  DatabaseIcon,
  FileTextIcon,
  GlobeIcon,
  KeyRoundIcon,
  LinkIcon,
  ListFilterIcon,
  LockIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PanelRightIcon,
  PlusIcon,
  SearchIcon,
  Share2Icon,
  ShieldCheckIcon,
  SparklesIcon,
  Table2Icon,
  UsersIcon,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Separator } from '#/components/ui/separator'
import { Textarea } from '#/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'
import {
  currentUser,
  variableChecklist,
  type WorkspaceBlock,
  type WorkspaceCollection,
  type WorkspaceCollectionRow,
  type WorkspacePage,
  type WorkspacePageSummary,
} from '#/lib/workspace/mock-data'
import type { CollectionView, PageSearch } from '#/lib/workspace/schemas'

type WorkspaceShellProps = {
  page: WorkspacePage
  pages: WorkspacePageSummary[]
  search: PageSearch
}

const statusOrder = ['Done', 'In progress', 'Next', 'Planned']
const statusFilterOptions = ['All', ...statusOrder]

const statusStyles: Record<string, string> = {
  Done: 'bg-[var(--status-done-bg)] text-[var(--status-done)]',
  'In progress': 'bg-[var(--status-progress-bg)] text-[var(--status-progress)]',
  Next: 'bg-[var(--status-next-bg)] text-[var(--status-next)]',
  Planned: 'bg-[var(--status-planned-bg)] text-[var(--status-planned)]',
}

export function WorkspaceShell({ page, pages, search }: WorkspaceShellProps) {
  const [checkedBlocks, setCheckedBlocks] = useState(() =>
    Object.fromEntries(
      page.blocks
        .filter((block) => block.type === 'to_do')
        .map((block) => [block.id, Boolean(block.checked)]),
    ),
  )
  const [draftBlocks, setDraftBlocks] = useState(() =>
    Object.fromEntries(page.blocks.map((block) => [block.id, block.content])),
  )
  const [privacyLocked, setPrivacyLocked] = useState(!page.share.publicEnabled)
  const [includeChildren, setIncludeChildren] = useState(
    page.share.includeChildren,
  )
  const [selectedStatus, setSelectedStatus] = useState('All')

  const activeCollection = page.collections[0]
  const completedCount = page.blocks.filter(
    (block) => block.type === 'to_do' && checkedBlocks[block.id],
  ).length
  const totalTasks = page.blocks.filter(
    (block) => block.type === 'to_do',
  ).length

  return (
    <div className="min-h-screen bg-[var(--workspace-bg)] text-[var(--workspace-ink)]">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_380px]">
        <WorkspaceSidebar pages={pages} activeSlug={page.slug} />

        <main className="min-w-0 border-x border-[var(--workspace-line)] bg-[var(--workspace-paper)]">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--workspace-line)] bg-[var(--workspace-paper-glass)] px-4 backdrop-blur md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Badge variant="secondary" className="shrink-0 rounded-md">
                {page.icon}
              </Badge>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{page.title}</p>
                <p className="text-muted-foreground truncate text-xs">
                  Edited {formatDate(page.updatedAt)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Open filters">
                    <ListFilterIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Filters</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Share page">
                    <Share2Icon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Share</TooltipContent>
              </Tooltip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Page actions">
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem>
                      <ArchiveIcon data-icon="inline-start" />
                      Archive page
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <LinkIcon data-icon="inline-start" />
                      Copy internal link
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <div className="h-[calc(100vh-4rem)] overflow-y-auto">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-7 px-4 py-7 md:px-8">
              <section className="workspace-cover overflow-hidden rounded-lg border border-[var(--workspace-line)]">
                <div className="flex min-h-36 items-end justify-between gap-4 p-5 md:min-h-44 md:p-7">
                  <div className="flex flex-col gap-2">
                    <Badge className="w-fit rounded-md bg-[var(--accent-brass)] text-[var(--accent-brass-ink)]">
                      Self-hosted
                    </Badge>
                    <h1 className="display-title max-w-2xl text-4xl leading-tight font-bold text-[var(--workspace-ink)] md:text-6xl">
                      {page.title}
                    </h1>
                  </div>
                  <div className="hidden items-center gap-2 rounded-md bg-white/70 px-3 py-2 text-xs font-semibold text-[var(--workspace-ink-soft)] shadow-sm md:flex">
                    <ShieldCheckIcon data-icon="inline-start" />
                    Private by default
                  </div>
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-3">
                <MetricPill
                  label="Tasks"
                  value={`${completedCount}/${totalTasks}`}
                />
                <MetricPill
                  label="Members"
                  value={`${page.collaborators.length}`}
                />
                <MetricPill
                  label="Public link"
                  value={privacyLocked ? 'Off' : 'On'}
                />
              </section>

              <section className="flex flex-col gap-3">
                {page.blocks.map((block) =>
                  block.type === 'database' && activeCollection ? (
                    <CollectionBlock
                      key={block.id}
                      pageSlug={page.slug}
                      collection={activeCollection}
                      view={search.view}
                      selectedStatus={selectedStatus}
                      onStatusChange={setSelectedStatus}
                    />
                  ) : (
                    <EditableBlock
                      key={block.id}
                      block={block}
                      checked={Boolean(checkedBlocks[block.id])}
                      content={draftBlocks[block.id] ?? block.content}
                      onCheckedChange={(checked) =>
                        setCheckedBlocks((previous) => ({
                          ...previous,
                          [block.id]: checked,
                        }))
                      }
                      onContentChange={(content) =>
                        setDraftBlocks((previous) => ({
                          ...previous,
                          [block.id]: content,
                        }))
                      }
                    />
                  ),
                )}
              </section>
            </div>
          </div>
        </main>

        <WorkspaceInspector
          page={page}
          privacyLocked={privacyLocked}
          includeChildren={includeChildren}
          onPrivacyLockedChange={setPrivacyLocked}
          onIncludeChildrenChange={setIncludeChildren}
        />
      </div>
    </div>
  )
}

function WorkspaceSidebar({
  pages,
  activeSlug,
}: {
  pages: WorkspacePageSummary[]
  activeSlug: string
}) {
  return (
    <aside className="hidden min-h-screen bg-[var(--workspace-side)] lg:block">
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center justify-between border-b border-[var(--workspace-line)] px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="size-9 rounded-md">
              <AvatarFallback className="rounded-md bg-[var(--accent-plum)] text-white">
                {currentUser.initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">David McDonald</p>
              <p className="text-muted-foreground truncate text-xs">
                contactdavidmcdonald@gmail.com
              </p>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Collapse sidebar"
              >
                <PanelRightIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Collapse</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex flex-col gap-4 p-4">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input className="h-9 pl-9" placeholder="Search pages" />
          </div>

          <nav className="flex flex-col gap-1">
            {pages.map((page) => (
              <Link
                key={page.id}
                to="/pages/$pageSlug"
                params={{ pageSlug: page.slug }}
                search={(previous) => ({
                  ...previous,
                  view: previous.view ?? 'table',
                })}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-[var(--workspace-ink-soft)] no-underline hover:bg-[var(--workspace-hover)] hover:text-[var(--workspace-ink)]',
                  page.slug === activeSlug &&
                    'bg-[var(--workspace-hover)] font-semibold text-[var(--workspace-ink)]',
                )}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white text-xs font-bold shadow-sm">
                  {page.icon}
                </span>
                <span className="truncate">{page.title}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-auto flex flex-col gap-3 border-t border-[var(--workspace-line)] p-4">
          <Button className="justify-start" variant="outline">
            <PlusIcon data-icon="inline-start" />
            New page
          </Button>
          <div className="rounded-lg border border-[var(--workspace-line)] bg-white/70 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CloudIcon data-icon="inline-start" />
              Cloudflare ready
            </div>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              Vars stay in GitHub Actions and Worker bindings.
            </p>
          </div>
        </div>
      </div>
    </aside>
  )
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-20 flex-col justify-between rounded-lg border border-[var(--workspace-line)] bg-white px-4 py-3 shadow-sm">
      <span className="text-muted-foreground text-xs font-semibold uppercase">
        {label}
      </span>
      <span className="text-2xl font-bold">{value}</span>
    </div>
  )
}

function EditableBlock({
  block,
  checked,
  content,
  onCheckedChange,
  onContentChange,
}: {
  block: WorkspaceBlock
  checked: boolean
  content: string
  onCheckedChange: (checked: boolean) => void
  onContentChange: (content: string) => void
}) {
  if (block.type === 'heading_1') {
    return (
      <h2 className="display-title text-3xl leading-tight font-bold text-[var(--workspace-ink)]">
        {content}
      </h2>
    )
  }

  if (block.type === 'heading_2') {
    return (
      <h3 className="text-lg font-bold text-[var(--workspace-ink)]">
        {content}
      </h3>
    )
  }

  if (block.type === 'to_do') {
    return (
      <div className="group flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--workspace-hover)]">
        <Checkbox
          aria-label="Toggle task"
          className="mt-1"
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
        <Textarea
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
          className={cn(
            'min-h-8 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0',
            checked && 'text-muted-foreground line-through',
          )}
        />
      </div>
    )
  }

  if (block.type === 'callout') {
    return (
      <div className="flex gap-3 rounded-lg border border-[var(--callout-line)] bg-[var(--callout-bg)] p-4">
        <SparklesIcon className="mt-0.5 size-5 shrink-0 text-[var(--accent-brass)]" />
        <Textarea
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
          className="min-h-16 resize-none border-0 bg-transparent p-0 text-base leading-7 shadow-none focus-visible:ring-0"
        />
      </div>
    )
  }

  if (block.type === 'quote') {
    return (
      <blockquote className="border-l-4 border-[var(--accent-plum)] pl-4 text-base leading-7 text-[var(--workspace-ink-soft)]">
        {content}
      </blockquote>
    )
  }

  return (
    <Textarea
      value={content}
      onChange={(event) => onContentChange(event.target.value)}
      className="min-h-20 resize-none border-0 bg-transparent p-0 text-base leading-7 shadow-none focus-visible:ring-0"
    />
  )
}

function CollectionBlock({
  pageSlug,
  collection,
  view,
  selectedStatus,
  onStatusChange,
}: {
  pageSlug: string
  collection: WorkspaceCollection
  view: CollectionView
  selectedStatus: string
  onStatusChange: (status: string) => void
}) {
  const visibleRows =
    selectedStatus === 'All'
      ? collection.rows
      : collection.rows.filter((row) => row.values.status === selectedStatus)
  return (
    <section className="mt-2 flex flex-col gap-4 rounded-lg border border-[var(--workspace-line)] bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <DatabaseIcon className="size-5 text-[var(--accent-teal)]" />
          <div>
            <h3 className="text-base font-bold">{collection.title}</h3>
            <p className="text-muted-foreground text-xs">
              {visibleRows.length} rows / {collection.fields.length} fields
            </p>
          </div>
        </div>
        <div
          role="tablist"
          aria-label="Collection view"
          className="grid w-full grid-cols-3 rounded-lg bg-[var(--workspace-muted)] p-[3px] text-[var(--workspace-ink-soft)] md:w-auto md:grid-cols-5"
        >
          <ViewModeButton pageSlug={pageSlug} viewId="table" activeView={view}>
            <>
              <Table2Icon data-icon="inline-start" />
              Table
            </>
          </ViewModeButton>
          <ViewModeButton pageSlug={pageSlug} viewId="kanban" activeView={view}>
            Kanban
          </ViewModeButton>
          <ViewModeButton pageSlug={pageSlug} viewId="list" activeView={view}>
            List
          </ViewModeButton>
          <ViewModeButton
            pageSlug={pageSlug}
            viewId="gallery"
            activeView={view}
            className="hidden md:inline-flex"
          >
            Gallery
          </ViewModeButton>
          <ViewModeButton
            pageSlug={pageSlug}
            viewId="calendar"
            activeView={view}
            className="hidden md:inline-flex"
          >
            Calendar
          </ViewModeButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter rows by status"
          value={selectedStatus}
          onChange={(event) => onStatusChange(event.target.value)}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-40 rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
        >
          {statusFilterOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <Badge variant="outline" className="rounded-md">
          Filter: {selectedStatus === 'All' ? 'All statuses' : selectedStatus}
        </Badge>
      </div>

      {view === 'kanban' ? (
        <KanbanView rows={visibleRows} />
      ) : view === 'list' ? (
        <ListView rows={visibleRows} />
      ) : view === 'gallery' ? (
        <GalleryView rows={visibleRows} />
      ) : view === 'calendar' ? (
        <CalendarView rows={visibleRows} />
      ) : (
        <TableView rows={visibleRows} />
      )}
    </section>
  )
}

function ViewModeButton({
  pageSlug,
  viewId,
  activeView,
  className,
  children,
}: {
  pageSlug: string
  viewId: CollectionView
  activeView: CollectionView
  className?: string
  children: ReactNode
}) {
  const active = viewId === activeView

  return (
    <Link
      to="/pages/$pageSlug"
      params={{ pageSlug }}
      search={(previous) => ({
        ...previous,
        view: viewId,
      })}
      role="tab"
      aria-selected={active}
      className={cn(
        'inline-flex h-8 min-w-20 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring',
        active
          ? 'bg-white text-[var(--workspace-ink)] shadow-sm'
          : 'text-[var(--workspace-ink-soft)] hover:text-[var(--workspace-ink)]',
        className,
      )}
    >
      {children}
    </Link>
  )
}

function TableView({ rows }: { rows: WorkspaceCollectionRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--workspace-line)]">
      <div className="text-muted-foreground grid min-w-[520px] grid-cols-[minmax(180px,1.6fr)_120px_100px_80px] bg-[var(--workspace-muted)] px-3 py-2 text-xs font-bold uppercase">
        <span>Name</span>
        <span>Status</span>
        <span>Owner</span>
        <span>Private</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid min-w-[520px] grid-cols-[minmax(180px,1.6fr)_120px_100px_80px] items-center border-t border-[var(--workspace-line)] px-3 py-3 text-sm"
        >
          <span className="truncate font-medium">{row.title}</span>
          <StatusBadge status={String(row.values.status)} />
          <span className="text-muted-foreground">{row.values.owner}</span>
          <span>{row.values.sensitive ? 'Yes' : 'No'}</span>
        </div>
      ))}
    </div>
  )
}

function KanbanView({ rows }: { rows: WorkspaceCollectionRow[] }) {
  const groups = useMemo(
    () =>
      statusOrder.map((status) => ({
        status,
        rows: rows.filter((row) => row.values.status === status),
      })),
    [rows],
  )

  return (
    <div className="grid gap-3 md:grid-cols-4">
      {groups.map((group) => (
        <div
          key={group.status}
          className="min-h-48 rounded-md border border-[var(--workspace-line)] bg-[var(--workspace-muted)] p-2"
        >
          <div className="mb-2 flex items-center justify-between">
            <StatusBadge status={group.status} />
            <span className="text-muted-foreground text-xs">
              {group.rows.length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {group.rows.map((row) => (
              <Card key={row.id} className="rounded-md shadow-none">
                <CardContent className="flex flex-col gap-3 p-3">
                  <p className="text-sm leading-5 font-semibold">{row.title}</p>
                  <div className="text-muted-foreground flex items-center justify-between text-xs">
                    <span>{row.values.owner}</span>
                    <span>{row.values.due}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ListView({ rows }: { rows: WorkspaceCollectionRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex items-center justify-between gap-3 rounded-md border border-[var(--workspace-line)] px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate text-sm font-medium">{row.title}</span>
          </div>
          <StatusBadge status={String(row.values.status)} />
        </div>
      ))}
    </div>
  )
}

function GalleryView({ rows }: { rows: WorkspaceCollectionRow[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <Card key={row.id} className="overflow-hidden rounded-md shadow-none">
          <div className="h-16 bg-[var(--gallery-strip)]" />
          <CardHeader className="gap-2">
            <CardTitle className="text-base">{row.title}</CardTitle>
            <CardDescription>{row.values.due}</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

function CalendarView({ rows }: { rows: WorkspaceCollectionRow[] }) {
  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-1 gap-2 rounded-md border border-[var(--workspace-line)] px-3 py-2 text-sm sm:grid-cols-[110px_minmax(0,1fr)_120px] sm:items-center sm:gap-3"
        >
          <span className="text-muted-foreground flex items-center gap-2">
            <CalendarDaysIcon className="size-4" />
            {row.values.due}
          </span>
          <span className="truncate font-medium">{row.title}</span>
          <StatusBadge status={String(row.values.status)} />
        </div>
      ))}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'w-fit rounded-md px-2 py-1 text-xs font-bold',
        statusStyles[status] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {status}
    </span>
  )
}

function WorkspaceInspector({
  page,
  privacyLocked,
  includeChildren,
  onPrivacyLockedChange,
  onIncludeChildrenChange,
}: {
  page: WorkspacePage
  privacyLocked: boolean
  includeChildren: boolean
  onPrivacyLockedChange: (locked: boolean) => void
  onIncludeChildrenChange: (include: boolean) => void
}) {
  return (
    <aside className="hidden min-h-screen bg-[var(--workspace-panel)] xl:block">
      <ScrollArea className="h-screen">
        <div className="flex flex-col gap-4 p-4">
          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UsersIcon data-icon="inline-start" />
                Members
              </CardTitle>
              <CardDescription>Organization access</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {page.collaborators.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar className="size-8 rounded-md">
                      <AvatarFallback className="rounded-md">
                        {user.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {user.name}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {user.email}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="rounded-md">
                    {user.role}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GlobeIcon data-icon="inline-start" />
                Sharing
              </CardTitle>
              <CardDescription>
                Public links stay off until enabled
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <LockIcon className="size-4" />
                  Private
                </span>
                <Checkbox
                  aria-label="Toggle private sharing"
                  checked={privacyLocked}
                  onCheckedChange={(value) =>
                    onPrivacyLockedChange(value === true)
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Include child pages</span>
                <Checkbox
                  aria-label="Toggle child page sharing"
                  checked={includeChildren}
                  onCheckedChange={(value) =>
                    onIncludeChildrenChange(value === true)
                  }
                />
              </div>
              <div className="text-muted-foreground rounded-md bg-[var(--workspace-muted)] p-3 text-xs">
                {page.share.tokenPreview}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRoundIcon data-icon="inline-start" />
                Variables
              </CardTitle>
              <CardDescription>Production values are external</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {variableChecklist.map((item) => (
                <div
                  key={item.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-[var(--workspace-line)] px-3 py-2"
                >
                  <span className="truncate text-xs font-semibold">
                    {item.key}
                  </span>
                  <Badge variant="outline" className="shrink-0 rounded-md">
                    {item.status}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquareIcon data-icon="inline-start" />
                Comments
              </CardTitle>
              <CardDescription>{page.comments.length} threads</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {page.comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-md border border-[var(--workspace-line)] p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">
                      {comment.author}
                    </span>
                    {comment.resolved ? (
                      <Badge className="rounded-md">
                        <CheckIcon data-icon="inline-start" />
                        Resolved
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="rounded-md">
                        Open
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm leading-6 text-[var(--workspace-ink-soft)]">
                    {comment.body}
                  </p>
                  <p className="text-muted-foreground mt-2 text-xs">
                    {comment.target}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileTextIcon data-icon="inline-start" />
                MCP
              </CardTitle>
              <CardDescription>
                Remote tools use workspace permissions
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span>Search pages</span>
                <Badge className="rounded-md">Ready</Badge>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span>Write blocks</span>
                <Badge variant="secondary" className="rounded-md">
                  DO path
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </aside>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}
