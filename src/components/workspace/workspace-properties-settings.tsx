import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, Settings2Icon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import {
  addWorkspaceCatalogPropertyOption,
  deleteWorkspaceCatalogProperty,
  deleteWorkspaceCatalogPropertyOption,
  renameWorkspaceCatalogPropertyOption,
  updateWorkspaceCatalogProperty,
  workspacePropertiesQuery,
} from '#/lib/workspace/functions'
import {
  OPTION_PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  type DatabaseProperty,
  type PropertyType,
} from '#/lib/workspace/types'

import { ADDABLE_TYPES, PROPERTY_TYPE_ICONS } from './database-element'
import { PropertyOptionsDialog } from './database-element'

/**
 * Review and manage the workspace-wide property catalog. These definitions are
 * shared: renaming, retyping, or editing options here changes every page that
 * uses the property, and deleting removes it (and its values) from all pages.
 */
export function PropertiesSettings() {
  const queryClient = useQueryClient()
  const {
    data: properties,
    isPending,
    isError,
    error,
  } = useQuery(workspacePropertiesQuery())

  const [optionsPropertyId, setOptionsPropertyId] = useState<string | null>(
    null,
  )
  const [deleteTarget, setDeleteTarget] = useState<DatabaseProperty | null>(
    null,
  )

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['workspace'] })

  const updateMutation = useMutation({
    mutationFn: (input: {
      propertyId: string
      name?: string
      type?: Exclude<PropertyType, 'title'>
    }) => updateWorkspaceCatalogProperty({ data: input }),
    onSettled: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (input: { propertyId: string }) =>
      deleteWorkspaceCatalogProperty({ data: input }),
    onSettled: invalidate,
    onSuccess: () => setDeleteTarget(null),
  })

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--workspace-ink-soft)]">
        <Loader2Icon className="size-5 animate-spin" />
      </div>
    )
  }

  if (isError) {
    return (
      <p className="py-8 text-sm font-medium text-[var(--accent-rust)]">
        {error.message}
      </p>
    )
  }

  const optionsProperty =
    properties.find((property) => property.id === optionsPropertyId) ?? null

  if (properties.length === 0) {
    return (
      <p className="py-8 text-sm text-[var(--workspace-ink-soft)]">
        No properties yet. Add one from any page with “Add a property” and it
        will show up here for the whole workspace.
      </p>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col">
      {updateMutation.error || deleteMutation.error ? (
        <p className="pb-3 text-sm font-medium text-[var(--accent-rust)]">
          {updateMutation.error?.message ?? deleteMutation.error?.message}
        </p>
      ) : null}

      {properties.map((property) => (
        <PropertyRow
          key={property.id}
          property={property}
          onRename={(name) =>
            updateMutation.mutate({ propertyId: property.id, name })
          }
          onRetype={(type) =>
            updateMutation.mutate({ propertyId: property.id, type })
          }
          onConfigureOptions={() => setOptionsPropertyId(property.id)}
          onDelete={() => setDeleteTarget(property)}
        />
      ))}

      {optionsProperty ? (
        <PropertyOptionsDialog
          property={optionsProperty}
          onClose={() => setOptionsPropertyId(null)}
          onAddOption={async (name) => {
            await addWorkspaceCatalogPropertyOption({
              data: { propertyId: optionsProperty.id, name },
            })
            await invalidate()
          }}
          onRenameOption={async (optionId, name) => {
            await renameWorkspaceCatalogPropertyOption({
              data: { propertyId: optionsProperty.id, optionId, name },
            })
            await invalidate()
          }}
          onDeleteOption={async (optionId) => {
            await deleteWorkspaceCatalogPropertyOption({
              data: { propertyId: optionsProperty.id, optionId },
            })
            await invalidate()
          }}
        />
      ) : null}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleteTarget?.name}”?</DialogTitle>
            <DialogDescription>
              This removes the property and its values from every page in the
              workspace. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteTarget &&
                deleteMutation.mutate({ propertyId: deleteTarget.id })
              }
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete property'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PropertyRow({
  property,
  onRename,
  onRetype,
  onConfigureOptions,
  onDelete,
}: {
  property: DatabaseProperty
  onRename: (name: string) => void
  onRetype: (type: Exclude<PropertyType, 'title'>) => void
  onConfigureOptions: () => void
  onDelete: () => void
}) {
  const Icon = PROPERTY_TYPE_ICONS[property.type]
  const hasOptions = OPTION_PROPERTY_TYPES.includes(property.type)

  return (
    <div className="flex items-center gap-3 border-b border-[var(--workspace-line)] py-2.5 last:border-b-0">
      <Icon className="size-4 shrink-0 text-[var(--workspace-ink-soft)]" />

      <Input
        defaultValue={property.name}
        aria-label={`Rename ${property.name}`}
        className="h-8 w-44 shrink-0"
        onBlur={(event) => {
          const value = event.target.value.trim()
          if (value && value !== property.name) {
            onRename(value)
          }
        }}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-[var(--workspace-ink-soft)] transition-colors hover:bg-[var(--workspace-hover)]"
          >
            {PROPERTY_TYPE_LABELS[property.type]}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {ADDABLE_TYPES.map((type) => (
            <DropdownMenuItem
              key={type}
              onClick={() => type !== property.type && onRetype(type)}
            >
              <span className={cn(type === property.type && 'font-bold')}>
                {PROPERTY_TYPE_LABELS[type]}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {(property.options ?? []).map((option) => (
          <span
            key={option.id}
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-[var(--workspace-ink)]"
            style={{ backgroundColor: option.color }}
          >
            {option.name}
          </span>
        ))}
      </div>

      {hasOptions ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onConfigureOptions}
          aria-label={`Edit options for ${property.name}`}
        >
          <Settings2Icon className="size-4" />
          Options
        </Button>
      ) : null}

      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        aria-label={`Delete ${property.name}`}
      >
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  )
}
