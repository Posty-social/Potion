import { useQuery } from '@tanstack/react-query'
import { PlusIcon, Settings2Icon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import { workspacePropertiesQuery } from '#/lib/workspace/functions'
import {
  OPTION_PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  type CellValue,
  type DatabaseProperty,
  type WorkspacePage,
} from '#/lib/workspace/types'

import {
  ADDABLE_TYPES,
  PROPERTY_TYPE_ICONS,
  PropertyEditor,
  PropertyOptionsDialog,
  PropertyTypePicker,
} from './database-element'
import type { WorkspaceMutations } from './use-workspace-mutations'

/**
 * The value shown for a page property. Stored values live in
 * `page.propertyValues`; the computed types read the page's own timestamps.
 */
function pageValueFor(
  page: WorkspacePage,
  property: DatabaseProperty,
): CellValue {
  if (property.type === 'created_time') {
    return page.createdAt
  }
  if (property.type === 'last_edited_time') {
    return page.updatedAt
  }
  return page.propertyValues[property.id] ?? null
}

/**
 * Notion-style page properties shown between the title and the page body.
 * Every page can have them (no database required) — reuses the same property
 * editors, picker, and options dialog as databases.
 */
export function PageProperties({
  page,
  mutations,
}: {
  page: WorkspacePage
  mutations: WorkspaceMutations
}) {
  const [optionsPropertyId, setOptionsPropertyId] = useState<string | null>(
    null,
  )
  const optionsProperty =
    page.properties.find((p) => p.id === optionsPropertyId) ?? null

  // Workspace-wide catalog of shared properties, minus the ones already on this
  // page — offered in the "Add a property" picker so pages reuse each other's
  // properties and select options.
  const { data: catalog } = useQuery(workspacePropertiesQuery())
  const attachedIds = new Set(page.properties.map((property) => property.id))
  const availableProperties = (catalog ?? []).filter(
    (property) => !attachedIds.has(property.id),
  )

  return (
    <div className="mb-3 flex flex-col gap-1">
      {page.properties.map((property) => (
        <div
          key={property.id}
          className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] items-center gap-2"
        >
          <PagePropertyLabel
            page={page}
            property={property}
            mutations={mutations}
            onConfigureOptions={setOptionsPropertyId}
          />
          <div className="rounded-md transition-colors hover:bg-[var(--workspace-muted)]">
            <PropertyEditor
              property={property}
              value={pageValueFor(page, property)}
              onCreateOption={(name) =>
                mutations.addPagePropertyOption({
                  pageId: page.id,
                  propertyId: property.id,
                  name,
                })
              }
              onSave={(next) =>
                mutations.setPagePropertyValue({
                  pageId: page.id,
                  propertyId: property.id,
                  value: next,
                })
              }
            />
          </div>
        </div>
      ))}

      <PropertyTypePicker
        onAdd={(name, type) =>
          mutations.addPageProperty({ pageId: page.id, name, type })
        }
        existingProperties={availableProperties}
        onPickExisting={(propertyId) =>
          mutations.attachPageProperty({ pageId: page.id, propertyId })
        }
        trigger={
          <button
            type="button"
            className="mt-0.5 flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-[var(--workspace-ink-soft)] transition-colors hover:bg-[var(--workspace-hover)]"
          >
            <PlusIcon className="size-4" />
            Add a property
          </button>
        }
      />

      {optionsProperty ? (
        <PropertyOptionsDialog
          property={optionsProperty}
          onClose={() => setOptionsPropertyId(null)}
          onAddOption={(name) =>
            mutations.addPagePropertyOption({
              pageId: page.id,
              propertyId: optionsProperty.id,
              name,
            })
          }
          onRenameOption={(optionId, name) =>
            mutations.renamePagePropertyOption({
              pageId: page.id,
              propertyId: optionsProperty.id,
              optionId,
              name,
            })
          }
          onDeleteOption={(optionId) =>
            mutations.deletePagePropertyOption({
              pageId: page.id,
              propertyId: optionsProperty.id,
              optionId,
            })
          }
        />
      ) : null}
    </div>
  )
}

/** The clickable property name + icon, opening a rename/type/delete menu. */
function PagePropertyLabel({
  page,
  property,
  mutations,
  onConfigureOptions,
}: {
  page: WorkspacePage
  property: DatabaseProperty
  mutations: WorkspaceMutations
  onConfigureOptions: (id: string) => void
}) {
  const Icon = PROPERTY_TYPE_ICONS[property.type]
  const hasOptions = OPTION_PROPERTY_TYPES.includes(property.type)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm text-[var(--workspace-ink-soft)] transition-colors hover:bg-[var(--workspace-hover)]"
        >
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{property.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <div className="px-1 py-1">
          <Input
            defaultValue={property.name}
            onKeyDown={(event) => event.stopPropagation()}
            onBlur={(event) => {
              const value = event.target.value.trim()
              if (value && value !== property.name) {
                void mutations.updatePageProperty({
                  pageId: page.id,
                  propertyId: property.id,
                  name: value,
                })
              }
            }}
            className="h-7 text-xs"
            aria-label="Property name"
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Type</DropdownMenuLabel>
        {ADDABLE_TYPES.map((type) => (
          <DropdownMenuItem
            key={type}
            onClick={() =>
              type !== property.type &&
              mutations.updatePageProperty({
                pageId: page.id,
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
            <DropdownMenuItem onClick={() => onConfigureOptions(property.id)}>
              <Settings2Icon className="size-3.5" />
              Edit options
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            mutations.deletePageProperty({
              pageId: page.id,
              propertyId: property.id,
            })
          }
        >
          <Trash2Icon className="size-3.5" />
          Delete property
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
