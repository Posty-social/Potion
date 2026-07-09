import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  ArrowDownUpIcon,
  AtSignIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDotIcon,
  ClockIcon,
  GalleryVerticalEndIcon,
  HashIcon,
  HistoryIcon,
  KanbanSquareIcon,
  LinkIcon,
  ListFilterIcon,
  ListIcon,
  LoaderIcon,
  MaximizeIcon,
  MenuIcon,
  PhoneIcon,
  PlusIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  SquareCheckIcon,
  Table2Icon,
  TextIcon,
  Trash2Icon,
  TypeIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react'

import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Sheet, SheetContent, SheetTitle } from '#/components/ui/sheet'
import { cn } from '#/lib/utils'
import { Markdown } from '#/lib/workspace/markdown'
import {
  COMPUTED_PROPERTY_TYPES,
  OPTION_PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  type CellValue,
  type DatabaseFilter,
  type DatabaseProperty,
  type DatabaseRow,
  type DatabaseSort,
  type DatabaseView,
  type DatabaseViewType,
  type PropertyOption,
  type PropertyType,
  type WorkspaceDatabase,
} from '#/lib/workspace/types'

import type { WorkspaceMutations } from './use-workspace-mutations'

type Props = { database: WorkspaceDatabase; mutations: WorkspaceMutations }

const VIEW_TYPES: Array<{
  type: DatabaseViewType
  label: string
  icon: typeof Table2Icon
}> = [
  { type: 'table', label: 'Table', icon: Table2Icon },
  { type: 'board', label: 'Board', icon: KanbanSquareIcon },
  { type: 'list', label: 'List', icon: ListIcon },
  { type: 'gallery', label: 'Gallery', icon: GalleryVerticalEndIcon },
  { type: 'calendar', label: 'Calendar', icon: CalendarIcon },
]

export const ADDABLE_TYPES: Array<Exclude<PropertyType, 'title'>> = [
  'text',
  'number',
  'select',
  'status',
  'multi_select',
  'date',
  'person',
  'checkbox',
  'url',
]

const optionById = (property: DatabaseProperty, id: unknown) =>
  typeof id === 'string'
    ? property.options?.find((option) => option.id === id)
    : undefined

export const PROPERTY_TYPE_ICONS: Record<PropertyType, typeof TextIcon> = {
  title: TypeIcon,
  text: TextIcon,
  number: HashIcon,
  select: CircleDotIcon,
  multi_select: ListIcon,
  status: LoaderIcon,
  date: CalendarIcon,
  person: UsersIcon,
  checkbox: SquareCheckIcon,
  url: LinkIcon,
  email: AtSignIcon,
  phone: PhoneIcon,
  created_time: ClockIcon,
  last_edited_time: HistoryIcon,
}

function formatTimestamp(value: CellValue): string {
  if (typeof value !== 'string' || !value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * The value to show for a property on a row. Most come straight from the row's
 * stored `values`; the computed types (created / last-edited time) are read off
 * the row's own timestamps instead.
 */
function cellValueFor(property: DatabaseProperty, row: DatabaseRow): CellValue {
  if (property.type === 'created_time') {
    return row.createdAt
  }
  if (property.type === 'last_edited_time') {
    return row.updatedAt
  }
  return row.values[property.id] ?? null
}

// --- filter / sort helpers ----------------------------------------------

function matchesFilter(
  row: DatabaseRow,
  filter: DatabaseFilter,
  property: DatabaseProperty,
): boolean {
  if (!filter.value) {
    return true
  }
  const value = row.values[filter.propertyId]

  if (property.type === 'select' || property.type === 'status') {
    return value === filter.value
  }
  if (property.type === 'multi_select') {
    return Array.isArray(value) && value.includes(filter.value)
  }
  if (property.type === 'checkbox') {
    return String(value === true) === filter.value
  }
  return String(value ?? '')
    .toLowerCase()
    .includes(filter.value.toLowerCase())
}

function compareRows(
  a: DatabaseRow,
  b: DatabaseRow,
  sorts: DatabaseSort[],
  byId: Map<string, DatabaseProperty>,
): number {
  for (const sort of sorts) {
    const property = byId.get(sort.propertyId)
    if (!property) {
      continue
    }
    const av = a.values[sort.propertyId]
    const bv = b.values[sort.propertyId]
    let cmp = 0

    if (property.type === 'number') {
      cmp = (Number(av) || 0) - (Number(bv) || 0)
    } else if (property.type === 'checkbox') {
      cmp = (av === true ? 1 : 0) - (bv === true ? 1 : 0)
    } else if (property.type === 'select' || property.type === 'status') {
      cmp = (optionById(property, av)?.name ?? '').localeCompare(
        optionById(property, bv)?.name ?? '',
      )
    } else {
      cmp = String(av ?? '').localeCompare(String(bv ?? ''))
    }

    if (cmp !== 0) {
      return sort.direction === 'asc' ? cmp : -cmp
    }
  }
  return 0
}

// --- Root ----------------------------------------------------------------

export function DatabaseElement({ database, mutations }: Props) {
  const [activeViewId, setActiveViewId] = useState(database.views[0]?.id)
  const [openRowId, setOpenRowId] = useState<string | null>(null)
  const [optionsPropertyId, setOptionsPropertyId] = useState<string | null>(
    null,
  )

  const activeView =
    database.views.find((view) => view.id === activeViewId) ?? database.views[0]

  const byId = useMemo(
    () => new Map(database.properties.map((p) => [p.id, p])),
    [database.properties],
  )

  const visibleProperties = useMemo(() => {
    const ids = activeView?.visiblePropertyIds
    if (!ids) {
      return database.properties
    }
    return database.properties.filter(
      (p) => p.type === 'title' || ids.includes(p.id),
    )
  }, [database.properties, activeView?.visiblePropertyIds])

  const rows = useMemo(() => {
    const filtered = database.rows.filter((row) =>
      (activeView?.filters ?? []).every((filter) => {
        const property = byId.get(filter.propertyId)
        return property ? matchesFilter(row, filter, property) : true
      }),
    )
    const sorts = activeView?.sorts ?? []
    if (sorts.length === 0) {
      return filtered
    }
    return [...filtered].sort((a, b) => compareRows(a, b, sorts, byId))
  }, [database.rows, activeView?.filters, activeView?.sorts, byId])

  const openRow = database.rows.find((row) => row.id === openRowId) ?? null
  const optionsProperty =
    database.properties.find((p) => p.id === optionsPropertyId) ?? null

  const shared: SharedViewProps = {
    database,
    properties: visibleProperties,
    rows,
    mutations,
    onOpenRow: setOpenRowId,
    onConfigureOptions: setOptionsPropertyId,
  }

  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-[var(--workspace-line)] bg-white p-2 shadow-sm md:p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <input
          key={`title:${database.title}`}
          defaultValue={database.title}
          onBlur={(event) => {
            const value = event.target.value.trim()
            if (value && value !== database.title) {
              void mutations.renameDatabase({
                databaseId: database.id,
                title: value,
              })
            }
          }}
          className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-base font-bold transition-colors outline-none focus-visible:bg-[var(--workspace-muted)]"
          aria-label="Database title"
        />
        <ViewTabs
          database={database}
          mutations={mutations}
          activeViewId={activeView?.id}
          onSelect={setActiveViewId}
        />
      </div>

      {activeView ? (
        <ViewToolbar
          database={database}
          view={activeView}
          mutations={mutations}
        />
      ) : null}

      {activeView?.type === 'board' ? (
        <BoardView view={activeView} {...shared} />
      ) : activeView?.type === 'list' ? (
        <ListView {...shared} />
      ) : activeView?.type === 'gallery' ? (
        <GalleryView {...shared} />
      ) : activeView?.type === 'calendar' ? (
        <CalendarView view={activeView} {...shared} />
      ) : (
        <TableView {...shared} />
      )}

      {openRow ? (
        <RowPeekPanel
          database={database}
          row={openRow}
          mutations={mutations}
          onClose={() => setOpenRowId(null)}
        />
      ) : null}

      {optionsProperty ? (
        <PropertyOptionsDialog
          property={optionsProperty}
          onClose={() => setOptionsPropertyId(null)}
          onAddOption={(name) =>
            mutations.addPropertyOption({
              databaseId: database.id,
              propertyId: optionsProperty.id,
              name,
            })
          }
          onRenameOption={(optionId, name) =>
            mutations.renamePropertyOption({
              databaseId: database.id,
              propertyId: optionsProperty.id,
              optionId,
              name,
            })
          }
          onDeleteOption={(optionId) =>
            mutations.deletePropertyOption({
              databaseId: database.id,
              propertyId: optionsProperty.id,
              optionId,
            })
          }
        />
      ) : null}
    </section>
  )
}

type SharedViewProps = {
  database: WorkspaceDatabase
  properties: DatabaseProperty[]
  rows: DatabaseRow[]
  mutations: WorkspaceMutations
  onOpenRow: (id: string) => void
  onConfigureOptions: (id: string) => void
}

// --- View tabs -----------------------------------------------------------

function ViewTabs({
  database,
  mutations,
  activeViewId,
  onSelect,
}: {
  database: WorkspaceDatabase
  mutations: WorkspaceMutations
  activeViewId?: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {database.views.map((view) => {
        const Icon =
          VIEW_TYPES.find((v) => v.type === view.type)?.icon ?? Table2Icon
        const active = view.id === activeViewId

        return (
          <DropdownMenu key={view.id}>
            <div
              className={cn(
                'inline-flex h-7 items-center rounded-md text-xs font-semibold transition-colors',
                active
                  ? 'bg-[var(--workspace-muted)] text-[var(--workspace-ink)]'
                  : 'text-[var(--workspace-ink-soft)] hover:bg-[var(--workspace-hover)]',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(view.id)}
                className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1 pl-2"
              >
                <Icon className="size-3.5" />
                {view.name}
              </button>
              {active ? (
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="View options"
                    className="cursor-pointer pr-1.5 text-[var(--workspace-ink-soft)] transition-colors hover:text-[var(--workspace-ink)]"
                  >
                    <ChevronDownIcon className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
              ) : null}
            </div>
            <DropdownMenuContent align="start">
              <RenameViewItem view={view} mutations={mutations} />
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Layout</DropdownMenuLabel>
              {VIEW_TYPES.map((item) => {
                const Icon = item.icon
                return (
                  <DropdownMenuItem
                    key={item.type}
                    onClick={() =>
                      item.type !== view.type &&
                      mutations.setViewType({
                        viewId: view.id,
                        type: item.type,
                      })
                    }
                  >
                    <Icon className="size-3.5" />
                    <span
                      className={cn(item.type === view.type && 'font-bold')}
                    >
                      {item.label}
                    </span>
                  </DropdownMenuItem>
                )
              })}
              {database.views.length > 1 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => mutations.deleteView({ viewId: view.id })}
                  >
                    <Trash2Icon className="size-3.5" />
                    Delete view
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      })}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Add view"
            className="flex size-6 cursor-pointer items-center justify-center rounded-md text-[var(--workspace-ink-soft)] transition-colors hover:bg-[var(--workspace-hover)]"
          >
            <PlusIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Add view</DropdownMenuLabel>
          {VIEW_TYPES.map((item) => {
            const Icon = item.icon
            return (
              <DropdownMenuItem
                key={item.type}
                onClick={async () => {
                  const result = await mutations.addView({
                    databaseId: database.id,
                    type: item.type,
                  })
                  onSelect(result.viewId)
                }}
              >
                <Icon className="size-3.5" />
                {item.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function RenameViewItem({
  view,
  mutations,
}: {
  view: DatabaseView
  mutations: WorkspaceMutations
}) {
  return (
    <div className="px-1 py-1">
      <Input
        defaultValue={view.name}
        onKeyDown={(event) => event.stopPropagation()}
        onBlur={(event) => {
          const value = event.target.value.trim()
          if (value && value !== view.name) {
            void mutations.renameView({ viewId: view.id, name: value })
          }
        }}
        className="h-7 text-xs"
        aria-label="View name"
      />
    </div>
  )
}

// --- Toolbar (filter / sort / properties / group / date) -----------------

function ViewToolbar({
  database,
  view,
  mutations,
}: {
  database: WorkspaceDatabase
  view: DatabaseView
  mutations: WorkspaceMutations
}) {
  const groupable = database.properties.filter(
    (p) => p.type === 'select' || p.type === 'status',
  )
  const dateProperties = database.properties.filter((p) => p.type === 'date')
  const nonTitle = database.properties.filter((p) => p.type !== 'title')

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1">
      {view.type === 'board' && groupable.length > 0 ? (
        <ToolbarSelect
          label="Group"
          value={view.groupByPropertyId ?? ''}
          options={groupable.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(value) =>
            mutations.setViewGroupBy({
              viewId: view.id,
              groupByPropertyId: value || null,
            })
          }
        />
      ) : null}

      {view.type === 'calendar' && dateProperties.length > 0 ? (
        <ToolbarSelect
          label="Date"
          value={view.datePropertyId ?? ''}
          options={dateProperties.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(value) =>
            mutations.setViewDateProperty({
              viewId: view.id,
              datePropertyId: value || null,
            })
          }
        />
      ) : null}

      <FilterMenu view={view} properties={nonTitle} mutations={mutations} />
      <SortMenu
        view={view}
        properties={database.properties}
        mutations={mutations}
      />
      <PropertiesMenu
        view={view}
        properties={database.properties}
        mutations={mutations}
      />

      <div className="ml-auto">
        <AddPropertyMenu databaseId={database.id} mutations={mutations} />
      </div>
    </div>
  )
}

function ToolbarButton({
  active,
  count,
  icon: Icon,
  label,
}: {
  active?: boolean
  count?: number
  icon: typeof ListFilterIcon
  label: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors',
        active
          ? 'bg-[var(--workspace-muted)] text-[var(--workspace-ink)]'
          : 'text-[var(--workspace-ink-soft)] hover:bg-[var(--workspace-hover)]',
      )}
    >
      <Icon className="size-3.5" />
      {label}
      {count ? (
        <span className="rounded-full bg-[var(--accent-plum)] px-1.5 text-[10px] font-bold text-white tabular-nums">
          {count}
        </span>
      ) : null}
    </span>
  )
}

function ToolbarSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--workspace-ink-soft)]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 cursor-pointer rounded-md border border-[var(--workspace-line)] bg-white px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-plum)]/40"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function FilterMenu({
  view,
  properties,
  mutations,
}: {
  view: DatabaseView
  properties: DatabaseProperty[]
  mutations: WorkspaceMutations
}) {
  if (properties.length === 0) {
    return null
  }
  const filters = view.filters
  const commit = (next: DatabaseFilter[]) =>
    mutations.setViewFilters({ viewId: view.id, filters: next })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Filter">
          <ToolbarButton
            icon={ListFilterIcon}
            label="Filter"
            count={filters.length}
            active={filters.length > 0}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-2">
        <div className="flex flex-col gap-2">
          {filters.map((filter, index) => {
            const property = properties.find((p) => p.id === filter.propertyId)
            return (
              <div key={index} className="flex items-center gap-1.5">
                <select
                  value={filter.propertyId}
                  onChange={(event) =>
                    commit(
                      filters.map((f, i) =>
                        i === index
                          ? { propertyId: event.target.value, value: '' }
                          : f,
                      ),
                    )
                  }
                  className="h-8 w-28 shrink-0 rounded-md border border-[var(--workspace-line)] bg-white px-1.5 text-xs outline-none"
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <FilterValueInput
                  property={property}
                  value={filter.value}
                  onChange={(value) =>
                    commit(
                      filters.map((f, i) =>
                        i === index ? { ...f, value } : f,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  aria-label="Remove filter"
                  onClick={() => commit(filters.filter((_, i) => i !== index))}
                  className="text-[var(--workspace-ink-soft)] hover:text-[var(--accent-rust)]"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
            )
          })}
          <Button
            variant="ghost"
            size="sm"
            className="justify-start text-[var(--workspace-ink-soft)]"
            onClick={() =>
              commit([...filters, { propertyId: properties[0].id, value: '' }])
            }
          >
            <PlusIcon className="size-4" />
            Add filter
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FilterValueInput({
  property,
  value,
  onChange,
}: {
  property?: DatabaseProperty
  value: string
  onChange: (value: string) => void
}) {
  if (property && (property.type === 'select' || property.type === 'status')) {
    return (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        className="h-8 min-w-0 flex-1 rounded-md border border-[var(--workspace-line)] bg-white px-1.5 text-xs outline-none"
      >
        <option value="">Any</option>
        {(property.options ?? []).map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    )
  }

  if (property?.type === 'checkbox') {
    return (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        className="h-8 min-w-0 flex-1 rounded-md border border-[var(--workspace-line)] bg-white px-1.5 text-xs outline-none"
      >
        <option value="">Any</option>
        <option value="true">Checked</option>
        <option value="false">Unchecked</option>
      </select>
    )
  }

  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
      placeholder="Value"
      className="h-8 min-w-0 flex-1 text-xs"
    />
  )
}

function SortMenu({
  view,
  properties,
  mutations,
}: {
  view: DatabaseView
  properties: DatabaseProperty[]
  mutations: WorkspaceMutations
}) {
  const sorts = view.sorts
  const commit = (next: DatabaseSort[]) =>
    mutations.setViewSorts({ viewId: view.id, sorts: next })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Sort">
          <ToolbarButton
            icon={ArrowDownUpIcon}
            label="Sort"
            count={sorts.length}
            active={sorts.length > 0}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-2">
        <div className="flex flex-col gap-2">
          {sorts.map((sort, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <select
                value={sort.propertyId}
                onChange={(event) =>
                  commit(
                    sorts.map((s, i) =>
                      i === index
                        ? { ...s, propertyId: event.target.value }
                        : s,
                    ),
                  )
                }
                onKeyDown={(e) => e.stopPropagation()}
                className="h-8 min-w-0 flex-1 rounded-md border border-[var(--workspace-line)] bg-white px-1.5 text-xs outline-none"
              >
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  commit(
                    sorts.map((s, i) =>
                      i === index
                        ? {
                            ...s,
                            direction: s.direction === 'asc' ? 'desc' : 'asc',
                          }
                        : s,
                    ),
                  )
                }
                className="h-8 w-14 rounded-md border border-[var(--workspace-line)] text-xs font-medium hover:bg-[var(--workspace-hover)]"
              >
                {sort.direction === 'asc' ? 'Asc' : 'Desc'}
              </button>
              <button
                type="button"
                aria-label="Remove sort"
                onClick={() => commit(sorts.filter((_, i) => i !== index))}
                className="text-[var(--workspace-ink-soft)] hover:text-[var(--accent-rust)]"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="justify-start text-[var(--workspace-ink-soft)]"
            onClick={() =>
              commit([
                ...sorts,
                { propertyId: properties[0].id, direction: 'asc' },
              ])
            }
          >
            <PlusIcon className="size-4" />
            Add sort
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PropertiesMenu({
  view,
  properties,
  mutations,
}: {
  view: DatabaseView
  properties: DatabaseProperty[]
  mutations: WorkspaceMutations
}) {
  const visible = view.visiblePropertyIds
  const isVisible = (id: string) => !visible || visible.includes(id)
  const hiddenCount = properties.filter(
    (p) => p.type !== 'title' && !isVisible(p.id),
  ).length

  const toggle = (property: DatabaseProperty) => {
    const current = visible ?? properties.map((p) => p.id)
    const next = current.includes(property.id)
      ? current.filter((id) => id !== property.id)
      : [...current, property.id]
    // All visible → store null to keep it simple.
    const allVisible = properties.every((p) => next.includes(p.id))
    mutations.setViewProperties({
      viewId: view.id,
      visiblePropertyIds: allVisible ? null : next,
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Properties">
          <ToolbarButton
            icon={SlidersHorizontalIcon}
            label="Properties"
            count={hiddenCount}
            active={hiddenCount > 0}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Shown properties</DropdownMenuLabel>
        {properties.map((property) => {
          const shown = isVisible(property.id)
          const isTitle = property.type === 'title'
          return (
            <button
              key={property.id}
              type="button"
              disabled={isTitle}
              onClick={() => !isTitle && toggle(property)}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                isTitle
                  ? 'text-[var(--workspace-ink-soft)]'
                  : 'cursor-pointer hover:bg-[var(--workspace-hover)]',
              )}
            >
              <span className="truncate">{property.name}</span>
              {shown ? (
                <CheckIcon className="size-4 text-[var(--accent-teal)]" />
              ) : (
                <span className="size-4" />
              )}
            </button>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Notion-style "new property" popover: a name field on top and a searchable,
 * icon-labelled list of property types below. Adds the property to the database
 * schema, so it shows up in every view and in the row peek's property list.
 */
export function PropertyTypePicker({
  onAdd,
  trigger,
  align = 'start',
}: {
  onAdd: (
    name: string,
    type: Exclude<PropertyType, 'title'>,
  ) => void | Promise<unknown>
  trigger: ReactNode
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      nameRef.current?.focus()
    }
  }, [open])

  const reset = () => setName('')

  const create = async (type: Exclude<PropertyType, 'title'>) => {
    await onAdd(name.trim() || PROPERTY_TYPE_LABELS[type], type)
    setOpen(false)
    reset()
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          reset()
        }
      }}
    >
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-64 p-0">
        <div className="flex items-center gap-1.5 border-b border-[var(--workspace-line)] p-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-[var(--workspace-line)] text-[var(--workspace-ink-soft)]">
            <MenuIcon className="size-3.5" />
          </span>
          <input
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Property name"
            className="h-7 min-w-0 flex-1 rounded-md border border-[var(--accent-plum)] px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-plum)]/40"
            aria-label="Property name"
          />
        </div>
        <div className="p-1">
          <p className="px-2 py-1 text-xs font-semibold tracking-wide text-[var(--workspace-ink-soft)] uppercase">
            Type
          </p>
          <div className="flex max-h-64 flex-col overflow-y-auto">
            {ADDABLE_TYPES.map((type) => {
              const Icon = PROPERTY_TYPE_ICONS[type]
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => void create(type)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--workspace-hover)]"
                >
                  <Icon className="size-4 text-[var(--workspace-ink-soft)]" />
                  {PROPERTY_TYPE_LABELS[type]}
                </button>
              )
            })}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AddPropertyMenu({
  databaseId,
  mutations,
}: {
  databaseId: string
  mutations: WorkspaceMutations
}) {
  return (
    <PropertyTypePicker
      align="end"
      onAdd={(name, type) => mutations.addProperty({ databaseId, name, type })}
      trigger={
        <button
          type="button"
          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--workspace-ink-soft)] transition-colors hover:bg-[var(--workspace-hover)]"
        >
          <PlusIcon className="size-3.5" />
          Property
        </button>
      }
    />
  )
}

// --- Cell editors --------------------------------------------------------

function OptionChip({ option }: { option: { name: string; color: string } }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-[var(--workspace-ink)]"
      style={{ backgroundColor: option.color }}
    >
      {option.name}
    </span>
  )
}

/**
 * Select / status / multi-select editor. Lets you pick existing options AND
 * type to create a new one inline (Notion-style).
 */
function OptionPicker({
  property,
  value,
  multiple,
  onCreateOption,
  onSave,
}: {
  property: DatabaseProperty
  value: CellValue
  multiple: boolean
  onCreateOption: (name: string) => Promise<{ optionId: string }>
  onSave: (next: CellValue) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])
  const options = property.options ?? []
  const selectedIds = multiple
    ? Array.isArray(value)
      ? value
      : []
    : typeof value === 'string' && value
      ? [value]
      : []
  const trimmed = query.trim()
  const filtered = options.filter((o) =>
    o.name.toLowerCase().includes(trimmed.toLowerCase()),
  )
  const exact = options.find(
    (o) => o.name.toLowerCase() === trimmed.toLowerCase(),
  )

  const select = (optionId: string) => {
    if (multiple) {
      onSave(
        selectedIds.includes(optionId)
          ? selectedIds.filter((id) => id !== optionId)
          : [...selectedIds, optionId],
      )
    } else {
      onSave(optionId)
      setOpen(false)
    }
  }

  const create = async () => {
    if (!trimmed) {
      return
    }
    const result = await onCreateOption(trimmed)
    setQuery('')
    if (multiple) {
      onSave([...selectedIds, result.optionId])
    } else {
      onSave(result.optionId)
      setOpen(false)
    }
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setQuery('')
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={property.name}
          className="flex min-h-9 w-full cursor-pointer flex-wrap items-center gap-1 px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--workspace-muted)]"
        >
          {selectedIds.length === 0 ? (
            <span className="text-[var(--workspace-ink-soft)]">Empty</span>
          ) : (
            selectedIds.map((id) => {
              const option = optionById(property, id)
              return option ? <OptionChip key={id} option={option} /> : null
            })
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 p-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              if (exact) {
                select(exact.id)
              } else {
                void create()
              }
            }
          }}
          placeholder="Search or create…"
          className="mb-1.5 h-8 w-full rounded-md border border-[var(--workspace-line)] px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-plum)]/40"
          aria-label="Search or create option"
        />
        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {filtered.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => select(option.id)}
              className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left hover:bg-[var(--workspace-hover)]"
            >
              <OptionChip option={option} />
              {selectedIds.includes(option.id) ? (
                <CheckIcon className="size-4 text-[var(--accent-teal)]" />
              ) : null}
            </button>
          ))}
          {trimmed && !exact ? (
            <button
              type="button"
              onClick={() => void create()}
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm hover:bg-[var(--workspace-hover)]"
            >
              <PlusIcon className="size-3.5 shrink-0" />
              Create
              <span className="rounded-full bg-[var(--workspace-muted)] px-2 py-0.5 text-xs font-medium">
                {trimmed}
              </span>
            </button>
          ) : null}
          {!multiple && selectedIds.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                onSave(null)
                setOpen(false)
              }}
              className="mt-0.5 cursor-pointer rounded-md px-1.5 py-1 text-left text-xs text-[var(--workspace-ink-soft)] hover:bg-[var(--workspace-hover)]"
            >
              Clear
            </button>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function PropertyEditor({
  property,
  value,
  onCreateOption,
  onSave,
}: {
  property: DatabaseProperty
  value: CellValue
  onCreateOption: (name: string) => Promise<{ optionId: string }>
  onSave: (next: CellValue) => void
}) {
  // Computed, read-only properties derived from the record's own timestamps.
  if (COMPUTED_PROPERTY_TYPES.includes(property.type)) {
    const formatted = formatTimestamp(value)
    return (
      <div className="flex min-h-9 items-center px-3 text-sm text-[var(--workspace-ink-soft)]">
        {formatted || <span className="text-[var(--workspace-line)]">—</span>}
      </div>
    )
  }

  if (property.type === 'checkbox') {
    return (
      <div className="flex h-9 items-center px-3">
        <Checkbox
          checked={value === true}
          onCheckedChange={(checked) => onSave(checked === true)}
          aria-label={property.name}
        />
      </div>
    )
  }

  if (OPTION_PROPERTY_TYPES.includes(property.type)) {
    return (
      <OptionPicker
        property={property}
        value={value}
        multiple={property.type === 'multi_select'}
        onCreateOption={onCreateOption}
        onSave={onSave}
      />
    )
  }

  const inputType =
    property.type === 'number'
      ? 'number'
      : property.type === 'date'
        ? 'date'
        : property.type === 'url'
          ? 'url'
          : property.type === 'email'
            ? 'email'
            : property.type === 'phone'
              ? 'tel'
              : 'text'

  return (
    <input
      key={`${property.id}:${String(value)}`}
      type={inputType}
      defaultValue={value === null ? '' : String(value)}
      onBlur={(event) => {
        const raw = event.target.value
        if (property.type === 'number') {
          const parsed = raw === '' ? null : Number(raw)
          onSave(parsed !== null && Number.isNaN(parsed) ? null : parsed)
        } else {
          onSave(raw === '' ? null : raw)
        }
      }}
      className={cn(
        'h-9 w-full bg-transparent px-3 text-sm outline-none transition-colors focus-visible:bg-[var(--workspace-muted)]',
        property.type === 'number' && 'tabular-nums',
      )}
      placeholder="Empty"
    />
  )
}

// --- Table view ----------------------------------------------------------

const columnHelper = createColumnHelper<DatabaseRow>()

function TableView({
  database,
  properties,
  rows,
  mutations,
  onOpenRow,
  onConfigureOptions,
}: SharedViewProps) {
  const columns = properties.map((property) =>
    columnHelper.accessor((row) => cellValueFor(property, row), {
      id: property.id,
      header: () => (
        <PropertyHeader
          property={property}
          databaseId={database.id}
          mutations={mutations}
          onConfigureOptions={onConfigureOptions}
        />
      ),
      cell: (info) =>
        property.type === 'title' ? (
          <TitleCell
            row={info.row.original}
            propertyId={property.id}
            mutations={mutations}
            onOpenRow={onOpenRow}
          />
        ) : (
          <PropertyEditor
            property={property}
            value={info.getValue()}
            onCreateOption={(name) =>
              mutations.addPropertyOption({
                databaseId: database.id,
                propertyId: property.id,
                name,
              })
            }
            onSave={(next) =>
              mutations.updateRow({
                rowId: info.row.original.id,
                values: { [property.id]: next },
              })
            }
          />
        ),
    }),
  )

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  const titlePropertyId = database.titlePropertyId

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--workspace-line)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr
              key={headerGroup.id}
              className="border-b border-[var(--workspace-line)] bg-[var(--workspace-muted)]"
            >
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="min-w-44 border-r border-[var(--workspace-line)] p-0 text-left align-middle font-semibold"
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </th>
              ))}
              <th className="w-10 p-0">
                <AddPropertyMenu
                  databaseId={database.id}
                  mutations={mutations}
                />
              </th>
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="group border-b border-[var(--workspace-line)] transition-colors hover:bg-[var(--workspace-muted)]/40"
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className="border-r border-[var(--workspace-line)] align-middle"
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
              <td className="align-middle">
                <button
                  type="button"
                  aria-label="Delete row"
                  onClick={() =>
                    mutations.deleteRow({ rowId: row.original.id })
                  }
                  className="flex h-full w-full cursor-pointer items-center justify-center py-2 text-transparent group-hover:text-[var(--workspace-ink-soft)] hover:!text-[var(--accent-rust)]"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </td>
            </tr>
          ))}
          {/* Empty starter row — typing the name creates a real row. */}
          <tr className="border-t border-[var(--workspace-line)]">
            <td className="align-middle" colSpan={properties.length + 1}>
              <input
                key={`ghost:${rows.length}`}
                placeholder="+ New row"
                onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value) {
                    event.target.value = ''
                    void mutations.addRow({
                      databaseId: database.id,
                      values: { [titlePropertyId]: value },
                    })
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  }
                }}
                className="h-9 w-full bg-transparent px-3 text-sm text-[var(--workspace-ink)] outline-none placeholder:text-[var(--workspace-ink-soft)]"
                aria-label="New row"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function TitleCell({
  row,
  propertyId,
  mutations,
  onOpenRow,
}: {
  row: DatabaseRow
  propertyId: string
  mutations: WorkspaceMutations
  onOpenRow: (id: string) => void
}) {
  const value = row.values[propertyId]

  return (
    <div className="flex items-center gap-1 pr-1">
      <input
        key={`${row.id}:${String(value)}`}
        defaultValue={typeof value === 'string' ? value : ''}
        onBlur={(event) => {
          const next = event.target.value
          if (next !== (typeof value === 'string' ? value : '')) {
            void mutations.updateRow({
              rowId: row.id,
              values: { [propertyId]: next || null },
            })
          }
        }}
        placeholder="Untitled"
        className="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm font-medium transition-colors outline-none focus-visible:bg-[var(--workspace-muted)]"
        aria-label="Row title"
      />
      <button
        type="button"
        aria-label="Open row"
        onClick={() => onOpenRow(row.id)}
        className="shrink-0 cursor-pointer rounded-md p-1 text-transparent transition-colors group-hover:text-[var(--workspace-ink-soft)] hover:bg-[var(--workspace-hover)] hover:!text-[var(--workspace-ink)]"
      >
        <MaximizeIcon className="size-3.5" />
      </button>
    </div>
  )
}

function PropertyHeader({
  property,
  databaseId,
  mutations,
  onConfigureOptions,
}: {
  property: DatabaseProperty
  databaseId: string
  mutations: WorkspaceMutations
  onConfigureOptions: (id: string) => void
}) {
  const isTitle = property.type === 'title'
  const hasOptions = OPTION_PROPERTY_TYPES.includes(property.type)

  return (
    <div className="flex items-center gap-1 px-2 py-1.5">
      <input
        key={`${property.id}:${property.name}`}
        defaultValue={property.name}
        onBlur={(event) => {
          const value = event.target.value.trim()
          if (value && value !== property.name) {
            void mutations.updateProperty({
              databaseId,
              propertyId: property.id,
              name: value,
            })
          }
        }}
        className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-xs font-bold tracking-wide uppercase transition-colors outline-none focus-visible:bg-white"
        aria-label={`Rename ${property.name}`}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${property.name} options`}
            className="cursor-pointer text-[var(--workspace-ink-soft)] transition-colors hover:text-[var(--workspace-ink)]"
          >
            <ChevronDownIcon className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {isTitle ? (
            <DropdownMenuLabel className="text-xs font-normal text-[var(--workspace-ink-soft)]">
              Title property
            </DropdownMenuLabel>
          ) : (
            <>
              <DropdownMenuLabel>Type</DropdownMenuLabel>
              {ADDABLE_TYPES.map((type) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() =>
                    type !== property.type &&
                    mutations.updateProperty({
                      databaseId,
                      propertyId: property.id,
                      type,
                    })
                  }
                >
                  <span className={cn(type === property.type && 'font-bold')}>
                    {PROPERTY_TYPE_LABELS[type]}
                  </span>
                </DropdownMenuItem>
              ))}
              {hasOptions ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onConfigureOptions(property.id)}
                  >
                    <Settings2Icon className="size-3.5" />
                    Edit options
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  mutations.deleteProperty({
                    databaseId,
                    propertyId: property.id,
                  })
                }
              >
                <Trash2Icon className="size-3.5" />
                Delete property
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// --- Board view ----------------------------------------------------------

function BoardView({
  view,
  database,
  properties,
  rows,
  mutations,
  onOpenRow,
}: SharedViewProps & { view: DatabaseView }) {
  const groupProperty = database.properties.find(
    (p) => p.id === view.groupByPropertyId,
  )

  if (
    !groupProperty ||
    (groupProperty.type !== 'select' && groupProperty.type !== 'status')
  ) {
    return (
      <EmptyViewHint
        message="Boards group cards by a Select or Status property."
        actionLabel="Add a Status property"
        onAction={async () => {
          const result = await mutations.addProperty({
            databaseId: database.id,
            name: 'Status',
            type: 'status',
          })
          await mutations.setViewGroupBy({
            viewId: view.id,
            groupByPropertyId: result.propertyId,
          })
        }}
      />
    )
  }

  const options = groupProperty.options ?? []
  const uncategorized = rows.filter((row) => {
    const value = row.values[groupProperty.id]
    return typeof value !== 'string' || !options.some((o) => o.id === value)
  })

  return (
    <div className="flex gap-3 overflow-x-auto px-1 pb-2">
      {options.map((option) => (
        <BoardColumn
          key={option.id}
          database={database}
          properties={properties}
          groupPropertyId={groupProperty.id}
          optionId={option.id}
          title={option.name}
          color={option.color}
          rows={rows.filter(
            (row) => row.values[groupProperty.id] === option.id,
          )}
          mutations={mutations}
          onOpenRow={onOpenRow}
        />
      ))}
      <BoardColumn
        database={database}
        properties={properties}
        groupPropertyId={groupProperty.id}
        optionId={null}
        title="No status"
        color={null}
        rows={uncategorized}
        mutations={mutations}
        onOpenRow={onOpenRow}
      />
      <button
        type="button"
        onClick={() =>
          mutations.addPropertyOption({
            databaseId: database.id,
            propertyId: groupProperty.id,
            name: 'New column',
          })
        }
        className="flex h-9 w-48 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-[var(--workspace-line)] px-3 text-sm font-medium text-[var(--workspace-ink-soft)] transition-colors hover:bg-[var(--workspace-hover)]"
      >
        <PlusIcon className="size-4" />
        Add column
      </button>
    </div>
  )
}

function BoardColumn({
  database,
  properties,
  groupPropertyId,
  optionId,
  title,
  color,
  rows,
  mutations,
  onOpenRow,
}: {
  database: WorkspaceDatabase
  properties: DatabaseProperty[]
  groupPropertyId: string
  optionId: string | null
  title: string
  color: string | null
  rows: DatabaseRow[]
  mutations: WorkspaceMutations
  onOpenRow: (id: string) => void
}) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event: DragEvent) => {
        event.preventDefault()
        setDragOver(false)
        const rowId = event.dataTransfer.getData('text/plain')
        if (rowId) {
          void mutations.updateRow({
            rowId,
            values: { [groupPropertyId]: optionId },
          })
        }
      }}
      className={cn(
        'flex w-60 shrink-0 flex-col gap-2 rounded-lg border border-transparent bg-[var(--workspace-muted)] p-2 transition-colors',
        dragOver && 'border-[var(--accent-plum)] bg-[var(--workspace-hover)]',
      )}
    >
      <div className="flex items-center justify-between gap-1 px-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {color ? (
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
          ) : null}
          {optionId ? (
            <input
              key={`col:${optionId}:${title}`}
              defaultValue={title}
              onBlur={(event) => {
                const value = event.target.value.trim()
                if (value && value !== title) {
                  void mutations.renamePropertyOption({
                    databaseId: database.id,
                    propertyId: groupPropertyId,
                    optionId,
                    name: value,
                  })
                }
              }}
              className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm font-bold transition-colors outline-none focus-visible:bg-white"
              aria-label="Rename column"
            />
          ) : (
            <span className="px-1 py-0.5 text-sm font-bold text-[var(--workspace-ink-soft)]">
              {title}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1 text-xs text-[var(--workspace-ink-soft)]">
          <span className="tabular-nums">{rows.length}</span>
          {optionId ? (
            <button
              type="button"
              aria-label="Delete column"
              onClick={() =>
                mutations.deletePropertyOption({
                  databaseId: database.id,
                  propertyId: groupPropertyId,
                  optionId,
                })
              }
              className="cursor-pointer transition-colors hover:text-[var(--accent-rust)]"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          ) : null}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <BoardCard
            key={row.id}
            database={database}
            properties={properties}
            groupPropertyId={groupPropertyId}
            row={row}
            mutations={mutations}
            onOpenRow={onOpenRow}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          mutations.addRow({
            databaseId: database.id,
            values: optionId ? { [groupPropertyId]: optionId } : {},
          })
        }
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-[var(--workspace-ink-soft)] transition-colors hover:bg-[var(--workspace-hover)]"
      >
        <PlusIcon className="size-3.5" />
        New card
      </button>
    </div>
  )
}

function OptionChips({
  properties,
  row,
  excludeIds = [],
}: {
  properties: DatabaseProperty[]
  row: DatabaseRow
  excludeIds?: string[]
}) {
  const chips = properties.filter(
    (p) =>
      !excludeIds.includes(p.id) &&
      (p.type === 'select' || p.type === 'status' || p.type === 'multi_select'),
  )

  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((property) => {
        const value = row.values[property.id]
        if (property.type === 'multi_select' && Array.isArray(value)) {
          return value.map((id) => {
            const option = optionById(property, id)
            return option ? <OptionChip key={id} option={option} /> : null
          })
        }
        const option = optionById(property, value)
        return option ? <OptionChip key={property.id} option={option} /> : null
      })}
    </div>
  )
}

function BoardCard({
  database,
  properties,
  groupPropertyId,
  row,
  mutations,
  onOpenRow,
}: {
  database: WorkspaceDatabase
  properties: DatabaseProperty[]
  groupPropertyId: string
  row: DatabaseRow
  mutations: WorkspaceMutations
  onOpenRow: (id: string) => void
}) {
  const title = row.values[database.titlePropertyId]

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', row.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      className="group flex cursor-grab flex-col gap-1.5 rounded-lg border border-[var(--workspace-line)] bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-1">
        <button
          type="button"
          onClick={() => onOpenRow(row.id)}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
        >
          {typeof title === 'string' && title ? title : 'Untitled'}
        </button>
        <button
          type="button"
          aria-label="Delete card"
          onClick={() => mutations.deleteRow({ rowId: row.id })}
          className="cursor-pointer text-transparent transition-colors group-hover:text-[var(--workspace-ink-soft)] hover:!text-[var(--accent-rust)]"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
      <OptionChips
        properties={properties}
        row={row}
        excludeIds={[database.titlePropertyId, groupPropertyId]}
      />
    </div>
  )
}

// --- List view -----------------------------------------------------------

function ListView({
  database,
  properties,
  rows,
  mutations,
  onOpenRow,
}: SharedViewProps) {
  return (
    <div className="flex flex-col gap-0.5 px-1">
      {rows.map((row) => {
        const title = row.values[database.titlePropertyId]
        return (
          <div
            key={row.id}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-[var(--workspace-hover)]"
          >
            <button
              type="button"
              onClick={() => onOpenRow(row.id)}
              className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
            >
              {typeof title === 'string' && title ? title : 'Untitled'}
            </button>
            <OptionChips
              properties={properties}
              row={row}
              excludeIds={[database.titlePropertyId]}
            />
            <button
              type="button"
              aria-label="Delete row"
              onClick={() => mutations.deleteRow({ rowId: row.id })}
              className="cursor-pointer text-transparent transition-colors group-hover:text-[var(--workspace-ink-soft)] hover:!text-[var(--accent-rust)]"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => mutations.addRow({ databaseId: database.id })}
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-[var(--workspace-ink-soft)] transition-colors hover:bg-[var(--workspace-hover)]"
      >
        <PlusIcon className="size-4" />
        New
      </button>
    </div>
  )
}

// --- Gallery view --------------------------------------------------------

function GalleryView({
  database,
  properties,
  rows,
  mutations,
  onOpenRow,
}: SharedViewProps) {
  return (
    <div className="grid grid-cols-1 gap-3 px-1 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => {
        const title = row.values[database.titlePropertyId]
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onOpenRow(row.id)}
            className="flex cursor-pointer flex-col gap-2 rounded-xl border border-[var(--workspace-line)] bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--accent-plum)] hover:shadow-md"
          >
            <div className="h-20 rounded-lg bg-gradient-to-br from-[var(--workspace-muted)] to-[var(--workspace-hover)]" />
            <span className="truncate text-sm font-semibold">
              {typeof title === 'string' && title ? title : 'Untitled'}
            </span>
            <OptionChips
              properties={properties}
              row={row}
              excludeIds={[database.titlePropertyId]}
            />
          </button>
        )
      })}
      <button
        type="button"
        onClick={() => mutations.addRow({ databaseId: database.id })}
        className="flex min-h-36 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--workspace-line)] text-sm font-medium text-[var(--workspace-ink-soft)] transition-colors hover:bg-[var(--workspace-hover)]"
      >
        <PlusIcon className="size-4" />
        New
      </button>
    </div>
  )
}

// --- Calendar view -------------------------------------------------------

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function CalendarView({
  view,
  database,
  rows,
  mutations,
  onOpenRow,
}: SharedViewProps & { view: DatabaseView }) {
  const [monthOffset, setMonthOffset] = useState(0)
  const dateProperty = database.properties.find(
    (p) => p.id === view.datePropertyId && p.type === 'date',
  )

  if (!dateProperty) {
    return (
      <EmptyViewHint
        message="Calendars place rows on a Date property."
        actionLabel="Add a Date property"
        onAction={async () => {
          const result = await mutations.addProperty({
            databaseId: database.id,
            name: 'Date',
            type: 'date',
          })
          await mutations.setViewDateProperty({
            viewId: view.id,
            datePropertyId: result.propertyId,
          })
        }}
      />
    )
  }

  const today = new Date()
  const base = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)
  const year = base.getFullYear()
  const month = base.getMonth()
  const startWeekday = base.getDay()
  const cells = Array.from(
    { length: 42 },
    (_, i) => new Date(year, month, 1 - startWeekday + i),
  )
  const todayKey = isoDate(today)

  const rowsByDate = new Map<string, DatabaseRow[]>()
  for (const row of rows) {
    const value = row.values[dateProperty.id]
    if (typeof value === 'string' && value) {
      const key = value.slice(0, 10)
      const list = rowsByDate.get(key) ?? []
      list.push(row)
      rowsByDate.set(key, list)
    }
  }

  return (
    <div className="px-1">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">
          {base.toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric',
          })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonthOffset((o) => o - 1)}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-[var(--workspace-hover)]"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setMonthOffset(0)}
            className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-[var(--workspace-hover)]"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonthOffset((o) => o + 1)}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-[var(--workspace-hover)]"
          >
            <ChevronRightIcon className="size-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-xs">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="px-1 py-1 font-semibold text-[var(--workspace-ink-soft)]"
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-[var(--workspace-line)] bg-[var(--workspace-line)]">
        {cells.map((cell, index) => {
          const key = isoDate(cell)
          const inMonth = cell.getMonth() === month
          const dayRows = rowsByDate.get(key) ?? []

          return (
            <div
              key={index}
              className={cn(
                'group flex min-h-20 flex-col bg-white p-1',
                !inMonth && 'bg-[var(--workspace-muted)]',
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    key === todayKey &&
                      'rounded-full bg-[var(--accent-plum)] px-1.5 font-bold text-white',
                    !inMonth && 'text-[var(--workspace-ink-soft)]',
                  )}
                >
                  {cell.getDate()}
                </span>
                <button
                  type="button"
                  aria-label="Add on this day"
                  onClick={() =>
                    mutations.addRow({
                      databaseId: database.id,
                      values: { [dateProperty.id]: key },
                    })
                  }
                  className="cursor-pointer text-[var(--workspace-ink-soft)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--workspace-ink)]"
                >
                  <PlusIcon className="size-3" />
                </button>
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                {dayRows.map((row) => {
                  const title = row.values[database.titlePropertyId]
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => onOpenRow(row.id)}
                      className="truncate rounded bg-[var(--accent-plum)]/10 px-1 py-0.5 text-left text-xs text-[var(--accent-plum)] transition-colors hover:bg-[var(--accent-plum)]/20"
                    >
                      {typeof title === 'string' && title ? title : 'Untitled'}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// --- Shared bits ---------------------------------------------------------

function EmptyViewHint({
  message,
  actionLabel,
  onAction,
}: {
  message: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--workspace-line)] p-8 text-center text-sm text-[var(--workspace-ink-soft)]">
      <p className="mb-3">{message}</p>
      <Button variant="outline" size="sm" onClick={onAction}>
        <PlusIcon className="size-4" />
        {actionLabel}
      </Button>
    </div>
  )
}

// --- Row peek + options dialogs ------------------------------------------

/**
 * A database row opened "as a page" in a wide right-hand side panel — the same
 * peek regardless of which view (table / board / list / gallery / calendar) it
 * was opened from. Shows the title, the row's properties at the top (with an
 * "Add a property" picker), then a Markdown body.
 */
function RowPeekPanel({
  database,
  row,
  mutations,
  onClose,
}: {
  database: WorkspaceDatabase
  row: DatabaseRow
  mutations: WorkspaceMutations
  onClose: () => void
}) {
  const titleProperty = database.properties.find((p) => p.type === 'title')
  const titleValue = titleProperty ? row.values[titleProperty.id] : null
  const otherProperties = database.properties.filter((p) => p.type !== 'title')

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent aria-describedby={undefined} className="gap-0 p-0">
        <SheetTitle className="sr-only">
          {typeof titleValue === 'string' && titleValue ? titleValue : 'Row'}
        </SheetTitle>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--workspace-line)] px-4 text-xs font-medium text-[var(--workspace-ink-soft)]">
          <MaximizeIcon className="size-3.5" />
          <span className="truncate">{database.title || 'Database'}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 md:px-10">
          <input
            key={`peek-title:${row.id}:${String(titleValue)}`}
            defaultValue={typeof titleValue === 'string' ? titleValue : ''}
            onBlur={(event) => {
              if (titleProperty) {
                void mutations.updateRow({
                  rowId: row.id,
                  values: { [titleProperty.id]: event.target.value || null },
                })
              }
            }}
            placeholder="Untitled"
            className="display-title mb-4 w-full bg-transparent text-3xl font-bold outline-none placeholder:text-[var(--workspace-line)]"
            aria-label="Row title"
          />

          <div className="flex flex-col gap-1">
            {otherProperties.map((property) => {
              const Icon = PROPERTY_TYPE_ICONS[property.type]
              return (
                <div
                  key={property.id}
                  className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] items-center gap-2"
                >
                  <span className="flex items-center gap-1.5 truncate py-1 text-sm text-[var(--workspace-ink-soft)]">
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{property.name}</span>
                  </span>
                  <div className="rounded-md transition-colors hover:bg-[var(--workspace-muted)]">
                    <PropertyEditor
                      property={property}
                      value={cellValueFor(property, row)}
                      onCreateOption={(name) =>
                        mutations.addPropertyOption({
                          databaseId: database.id,
                          propertyId: property.id,
                          name,
                        })
                      }
                      onSave={(next) =>
                        mutations.updateRow({
                          rowId: row.id,
                          values: { [property.id]: next },
                        })
                      }
                    />
                  </div>
                </div>
              )
            })}

            <PropertyTypePicker
              onAdd={(name, type) =>
                mutations.addProperty({ databaseId: database.id, name, type })
              }
              trigger={
                <button
                  type="button"
                  className="mt-1 flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-[var(--workspace-ink-soft)] transition-colors hover:bg-[var(--workspace-hover)]"
                >
                  <PlusIcon className="size-4" />
                  Add a property
                </button>
              }
            />
          </div>

          <hr className="my-5 border-[var(--workspace-line)]" />

          <RowBodyEditor row={row} mutations={mutations} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * The row's page body: rendered Markdown that turns into a raw textarea on
 * click. Bold, italics, lists, headings, links and code are all supported via
 * Markdown syntax.
 */
function RowBodyEditor({
  row,
  mutations,
}: {
  row: DatabaseRow
  mutations: WorkspaceMutations
}) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const body = row.body ?? ''

  const resize = () => {
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.max(el.scrollHeight, 160)}px`
    }
  }

  useEffect(() => {
    const el = ref.current
    if (editing && el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      resize()
    }
  }, [editing])

  if (!editing && body.trim() !== '') {
    // The click target is a real, full-size overlay button — the rendered
    // Markdown body contains block-level elements that can't nest in a <button>.
    return (
      <div className="relative min-h-40">
        <Markdown
          text={body}
          className="text-[0.95rem] leading-7 text-[var(--workspace-ink)]"
        />
        <button
          type="button"
          aria-label="Edit body"
          onClick={() => setEditing(true)}
          className="absolute inset-0 size-full cursor-text"
        />
      </div>
    )
  }

  return (
    <textarea
      ref={ref}
      key={`body:${row.id}`}
      defaultValue={body}
      placeholder="Add notes, details, or a description… Markdown supported."
      onInput={resize}
      onBlur={(event) => {
        const value = event.target.value
        setEditing(false)
        if (value !== body) {
          void mutations
            .updateRowBody({ rowId: row.id, body: value })
            .catch(() => mutations.invalidate())
        }
      }}
      className="min-h-40 w-full resize-none bg-transparent text-[0.95rem] leading-7 outline-none placeholder:text-[var(--workspace-line)]"
    />
  )
}

export function PropertyOptionsDialog({
  property,
  onClose,
  onAddOption,
  onRenameOption,
  onDeleteOption,
}: {
  property: DatabaseProperty
  onClose: () => void
  onAddOption: (name: string) => void | Promise<unknown>
  onRenameOption: (optionId: string, name: string) => void | Promise<unknown>
  onDeleteOption: (optionId: string) => void | Promise<unknown>
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{property.name} options</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {(property.options ?? []).map((option: PropertyOption) => (
            <div key={option.id} className="flex items-center gap-2">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: option.color }}
              />
              <Input
                defaultValue={option.name}
                onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value && value !== option.name) {
                    void onRenameOption(option.id, value)
                  }
                }}
                className="h-8 flex-1"
                aria-label="Option name"
              />
              <button
                type="button"
                aria-label="Delete option"
                onClick={() => void onDeleteOption(option.id)}
                className="cursor-pointer text-[var(--workspace-ink-soft)] transition-colors hover:text-[var(--accent-rust)]"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          ))}
          {(property.options ?? []).length === 0 ? (
            <p className="text-sm text-[var(--workspace-ink-soft)]">
              No options yet.
            </p>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="mt-1 self-start"
            onClick={() => void onAddOption('New option')}
          >
            <PlusIcon className="size-4" />
            Add option
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
