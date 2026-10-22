import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import {
  addWorkspacePageProperty,
  addWorkspacePagePropertyOption,
  attachWorkspacePageProperty,
  addWorkspaceProperty,
  addWorkspacePropertyOption,
  addWorkspaceRow,
  addWorkspaceView,
  archiveWorkspaceRows,
  createWorkspaceBlock,
  createWorkspacePage,
  deleteWorkspaceBlock,
  deleteWorkspacePage,
  deleteWorkspacePageProperty,
  deleteWorkspacePagePropertyOption,
  deleteWorkspaceProperty,
  deleteWorkspacePropertyOption,
  deleteWorkspaceRow,
  deleteWorkspaceView,
  moveWorkspaceBlock,
  renameWorkspaceDatabase,
  renameWorkspacePage,
  renameWorkspacePagePropertyOption,
  renameWorkspacePropertyOption,
  renameWorkspaceView,
  setWorkspaceBlockChecked,
  setWorkspacePageIcon,
  setWorkspacePagePropertyValue,
  setWorkspaceViewDateProperty,
  setWorkspaceViewFilters,
  setWorkspaceViewGroupBy,
  setWorkspaceViewProperties,
  setWorkspaceViewSorts,
  setWorkspaceViewType,
  updateWorkspaceBlock,
  updateWorkspacePageProperty,
  updateWorkspaceProperty,
  updateWorkspacePropertyOption,
  updateWorkspaceRow,
  updateWorkspaceRowBody,
} from '#/lib/workspace/functions'
import {
  OPTION_PROPERTY_TYPES,
  nextOptionColor,
  type CellValue,
  type DatabaseProperty,
  type DatabaseRow,
  type DatabaseViewType,
  type PropertyType,
  type WorkspaceBlockType,
  type WorkspacePage,
} from '#/lib/workspace/types'

import { hasPendingRowWrites, inOrder } from './row-write-queue'

type OptionPropertyType = Exclude<PropertyType, 'title'>

/**
 * Client-side wrappers around the workspace server functions. Every mutation
 * refreshes the cached workspace queries so the UI reflects server truth.
 */
export function useWorkspaceMutations() {
  const queryClient = useQueryClient()

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['workspace'] }),
    [queryClient],
  )

  // Optimistically patch every cached page (keyed by slug), so property edits
  // feel instant instead of waiting on the server round-trip.
  const patchPages = useCallback(
    (update: (page: WorkspacePage) => WorkspacePage) => {
      queryClient.setQueriesData<WorkspacePage | null>(
        { queryKey: ['workspace', 'page'] },
        (page) => (page ? update(page) : page),
      )
    },
    [queryClient],
  )

  const patchPage = useCallback(
    (pageId: string, update: (page: WorkspacePage) => WorkspacePage) => {
      patchPages((page) => (page.id === pageId ? update(page) : page))
    },
    [patchPages],
  )

  // Optimistically patch the shared workspace-property catalog cache.
  const patchCatalog = useCallback(
    (update: (properties: DatabaseProperty[]) => DatabaseProperty[]) => {
      queryClient.setQueryData<DatabaseProperty[]>(
        ['workspace', 'properties'],
        (properties) => (properties ? update(properties) : properties),
      )
    },
    [queryClient],
  )

  return useMemo(() => {
    const run = async <T>(promise: Promise<T>): Promise<T> => {
      const result = await promise
      await invalidate()

      return result
    }

    // For optimistic writes: the cache is already patched, so sync with server
    // truth in the background. On failure the invalidate rolls the patch back.
    const sync = (promise: Promise<unknown>): void => {
      void promise
        .catch(() => {
          // Server rejected; the refetch below restores the truth.
        })
        .then(() => invalidate())
    }

    // Row writes go through the in-order queue and only refetch once it has
    // drained, so a refetch between two queued writes can't briefly undo the
    // optimistic state. On failure the drained refetch restores server truth.
    const settleRowWrite = async <T>(promise: Promise<T>): Promise<T> => {
      try {
        return await promise
      } finally {
        if (!hasPendingRowWrites()) {
          await invalidate()
        }
      }
    }

    // Patch one database row wherever it is cached (rows live on the page that
    // hosts their database). In-flight page refetches are cancelled first so a
    // stale response can't overwrite the patch.
    const patchRows = (
      rowIds: string[],
      update: (row: DatabaseRow) => DatabaseRow,
    ) => {
      void queryClient.cancelQueries({ queryKey: ['workspace', 'page'] })
      patchPages((page) => ({
        ...page,
        databases: page.databases.map((database) => ({
          ...database,
          rows: database.rows.map((row) =>
            rowIds.includes(row.id) ? update(row) : row,
          ),
        })),
      }))
    }

    // Patch a shared property definition everywhere it is cached: on every
    // page that attaches it and in the workspace catalog.
    const patchProperty = (
      propertyId: string,
      update: (property: DatabaseProperty) => DatabaseProperty,
    ) => {
      const apply = (property: DatabaseProperty) =>
        property.id === propertyId ? update(property) : property
      patchPages((page) => ({
        ...page,
        properties: page.properties.map(apply),
      }))
      patchCatalog((properties) => properties.map(apply))
    }

    return {
      invalidate,
      // Pages
      createPage: (input: { title: string; parentPageId?: string }) =>
        run(createWorkspacePage({ data: input })),
      renamePage: (input: { pageId: string; title: string }) =>
        run(renameWorkspacePage({ data: input })),
      setPageIcon: (input: { pageId: string; icon: string }) =>
        run(setWorkspacePageIcon({ data: input })),
      deletePage: (input: { pageId: string }) =>
        run(deleteWorkspacePage({ data: input })),
      // Page properties — fully optimistic: patch the cache immediately (with
      // client-generated ids where the server would mint one), resolve without
      // waiting for the server, and sync in the background.
      addPageProperty: (input: {
        pageId: string
        name: string
        type: OptionPropertyType
      }) => {
        const propertyId = `prop_${crypto.randomUUID()}`
        const property: DatabaseProperty = {
          id: propertyId,
          name: input.name,
          type: input.type,
          ...(OPTION_PROPERTY_TYPES.includes(input.type)
            ? { options: [] }
            : {}),
        }
        patchPage(input.pageId, (page) => ({
          ...page,
          properties: [...page.properties, property],
        }))
        patchCatalog((properties) => [...properties, property])
        sync(addWorkspacePageProperty({ data: { ...input, propertyId } }))
        return Promise.resolve({ propertyId })
      },
      attachPageProperty: (input: { pageId: string; propertyId: string }) => {
        const property = queryClient
          .getQueryData<DatabaseProperty[]>(['workspace', 'properties'])
          ?.find((candidate) => candidate.id === input.propertyId)
        if (property) {
          patchPage(input.pageId, (page) =>
            page.properties.some((p) => p.id === property.id)
              ? page
              : { ...page, properties: [...page.properties, property] },
          )
        }
        sync(attachWorkspacePageProperty({ data: input }))
        return Promise.resolve()
      },
      updatePageProperty: (input: {
        pageId: string
        propertyId: string
        name?: string
        type?: OptionPropertyType
      }) => {
        patchProperty(input.propertyId, (property) => ({
          ...property,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.type !== undefined && input.type !== property.type
            ? {
                type: input.type,
                options: OPTION_PROPERTY_TYPES.includes(input.type)
                  ? (property.options ?? [])
                  : undefined,
              }
            : {}),
        }))
        sync(updateWorkspacePageProperty({ data: input }))
        return Promise.resolve()
      },
      deletePageProperty: (input: { pageId: string; propertyId: string }) => {
        patchPage(input.pageId, (page) => {
          const propertyValues = { ...page.propertyValues }
          delete propertyValues[input.propertyId]
          return {
            ...page,
            properties: page.properties.filter(
              (property) => property.id !== input.propertyId,
            ),
            propertyValues,
          }
        })
        sync(deleteWorkspacePageProperty({ data: input }))
        return Promise.resolve()
      },
      setPagePropertyValue: (input: {
        pageId: string
        propertyId: string
        value: CellValue
      }) => {
        patchPage(input.pageId, (page) => ({
          ...page,
          propertyValues: {
            ...page.propertyValues,
            [input.propertyId]: input.value,
          },
        }))
        sync(setWorkspacePagePropertyValue({ data: input }))
        return Promise.resolve()
      },
      addPagePropertyOption: (input: {
        pageId: string
        propertyId: string
        name: string
      }) => {
        const optionId = `opt_${crypto.randomUUID()}`
        patchProperty(input.propertyId, (property) => {
          const options = property.options ?? []
          return {
            ...property,
            options: [
              ...options,
              {
                id: optionId,
                name: input.name,
                color: nextOptionColor(options),
              },
            ],
          }
        })
        sync(addWorkspacePagePropertyOption({ data: { ...input, optionId } }))
        return Promise.resolve({ optionId })
      },
      renamePagePropertyOption: (input: {
        pageId: string
        propertyId: string
        optionId: string
        name: string
      }) => {
        patchProperty(input.propertyId, (property) => ({
          ...property,
          options: property.options?.map((option) =>
            option.id === input.optionId
              ? { ...option, name: input.name }
              : option,
          ),
        }))
        sync(renameWorkspacePagePropertyOption({ data: input }))
        return Promise.resolve()
      },
      deletePagePropertyOption: (input: {
        pageId: string
        propertyId: string
        optionId: string
      }) => {
        patchProperty(input.propertyId, (property) => ({
          ...property,
          options: property.options?.filter(
            (option) => option.id !== input.optionId,
          ),
        }))
        patchPage(input.pageId, (page) => {
          const current = page.propertyValues[input.propertyId]
          const next =
            current === input.optionId
              ? null
              : Array.isArray(current)
                ? current.filter((id) => id !== input.optionId)
                : current
          return {
            ...page,
            propertyValues: {
              ...page.propertyValues,
              [input.propertyId]: next,
            },
          }
        })
        sync(deleteWorkspacePagePropertyOption({ data: input }))
        return Promise.resolve()
      },
      // Blocks
      createBlock: (input: {
        pageId: string
        type: WorkspaceBlockType
        afterBlockId?: string
        content?: string
        databaseTitle?: string
        initialView?: DatabaseViewType
      }) => run(createWorkspaceBlock({ data: input })),
      updateBlock: (input: {
        pageId: string
        blockId: string
        content: string
        version: number
      }) => run(updateWorkspaceBlock({ data: input })),
      setBlockChecked: (input: { blockId: string; checked: boolean }) =>
        run(setWorkspaceBlockChecked({ data: input })),
      deleteBlock: (input: { blockId: string }) =>
        run(deleteWorkspaceBlock({ data: input })),
      // Reorder a block within its page. Optimistically splice it into place so
      // the drag feels instant, then reconcile with the server.
      moveBlock: (input: {
        pageId: string
        blockId: string
        afterBlockId: string | null
      }) => {
        patchPage(input.pageId, (page) => {
          const moving = page.blocks.find((b) => b.id === input.blockId)
          if (!moving) {
            return page
          }
          const rest = page.blocks.filter((b) => b.id !== input.blockId)
          const at =
            input.afterBlockId === null
              ? 0
              : rest.findIndex((b) => b.id === input.afterBlockId) + 1
          return {
            ...page,
            blocks: [...rest.slice(0, at), moving, ...rest.slice(at)],
          }
        })
        sync(
          moveWorkspaceBlock({
            data: {
              blockId: input.blockId,
              afterBlockId: input.afterBlockId,
            },
          }),
        )
      },
      // Database
      renameDatabase: (input: { databaseId: string; title: string }) =>
        run(renameWorkspaceDatabase({ data: input })),
      // Views
      addView: (input: {
        databaseId: string
        type: DatabaseViewType
        name?: string
      }) => run(addWorkspaceView({ data: input })),
      renameView: (input: { viewId: string; name: string }) =>
        run(renameWorkspaceView({ data: input })),
      deleteView: (input: { viewId: string }) =>
        run(deleteWorkspaceView({ data: input })),
      setViewType: (input: { viewId: string; type: DatabaseViewType }) =>
        run(setWorkspaceViewType({ data: input })),
      setViewGroupBy: (input: {
        viewId: string
        groupByPropertyId: string | null
      }) => run(setWorkspaceViewGroupBy({ data: input })),
      setViewDateProperty: (input: {
        viewId: string
        datePropertyId: string | null
      }) => run(setWorkspaceViewDateProperty({ data: input })),
      setViewSorts: (input: {
        viewId: string
        sorts: Array<{ propertyId: string; direction: 'asc' | 'desc' }>
      }) => run(setWorkspaceViewSorts({ data: input })),
      setViewFilters: (input: {
        viewId: string
        filters: Array<{ propertyId: string; value: string }>
      }) => run(setWorkspaceViewFilters({ data: input })),
      setViewProperties: (input: {
        viewId: string
        visiblePropertyIds: string[] | null
      }) => run(setWorkspaceViewProperties({ data: input })),
      // Properties
      addProperty: (input: {
        databaseId: string
        name: string
        type: OptionPropertyType
      }) => run(addWorkspaceProperty({ data: input })),
      updateProperty: (input: {
        databaseId: string
        propertyId: string
        name?: string
        type?: OptionPropertyType
      }) => run(updateWorkspaceProperty({ data: input })),
      deleteProperty: (input: { databaseId: string; propertyId: string }) =>
        run(deleteWorkspaceProperty({ data: input })),
      addPropertyOption: (input: {
        databaseId: string
        propertyId: string
        name: string
      }) => run(addWorkspacePropertyOption({ data: input })),
      renamePropertyOption: (input: {
        databaseId: string
        propertyId: string
        optionId: string
        name: string
      }) => run(renameWorkspacePropertyOption({ data: input })),
      updatePropertyOption: (input: {
        databaseId: string
        propertyId: string
        optionId: string
        name?: string
        color?: string
      }) => run(updateWorkspacePropertyOption({ data: input })),
      deletePropertyOption: (input: {
        databaseId: string
        propertyId: string
        optionId: string
      }) => run(deleteWorkspacePropertyOption({ data: input })),
      // Rows
      addRow: (input: {
        databaseId: string
        values?: Record<string, CellValue>
      }) => run(addWorkspaceRow({ data: input })),
      // Optimistic, so a card dropped on a board column (or any edited cell)
      // moves immediately; run() then syncs with the server, and its
      // invalidate restores server truth if the write fails.
      updateRow: (input: {
        rowId: string
        values: Record<string, CellValue>
      }) => {
        patchRows([input.rowId], (row) => ({
          ...row,
          values: { ...row.values, ...input.values },
        }))
        return settleRowWrite(
          inOrder(() => updateWorkspaceRow({ data: input })),
        )
      },
      updateRowBody: (input: { rowId: string; body: string }) =>
        settleRowWrite(inOrder(() => updateWorkspaceRowBody({ data: input }))),
      deleteRow: (input: { rowId: string }) =>
        settleRowWrite(inOrder(() => deleteWorkspaceRow({ data: input }))),
      // Archive / unarchive rows. Optimistic so the card leaves (or returns
      // to) the board immediately; the background sync reconciles with the
      // server and rolls back on failure.
      setRowsArchived: (input: { rowIds: string[]; archived: boolean }) => {
        const archivedAt = input.archived ? new Date().toISOString() : null
        patchRows(input.rowIds, (row) => ({
          ...row,
          isArchived: input.archived,
          archivedAt,
        }))
        void settleRowWrite(
          inOrder(() => archiveWorkspaceRows({ data: input })),
        ).catch(() => {
          // The drained refetch has already restored server truth.
        })
        return Promise.resolve()
      },
    }
  }, [invalidate, patchPage, patchPages, patchCatalog, queryClient])
}

export type WorkspaceMutations = ReturnType<typeof useWorkspaceMutations>
