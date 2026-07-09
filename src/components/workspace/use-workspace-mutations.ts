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
  updateWorkspaceRow,
  updateWorkspaceRowBody,
} from '#/lib/workspace/functions'
import type {
  CellValue,
  DatabaseViewType,
  PropertyType,
  WorkspaceBlockType,
  WorkspacePage,
} from '#/lib/workspace/types'

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

  // Optimistically patch every cached copy of a page (keyed by slug) by id, so
  // property edits feel instant instead of waiting on the server round-trip.
  const patchPage = useCallback(
    (pageId: string, update: (page: WorkspacePage) => WorkspacePage) => {
      queryClient.setQueriesData<WorkspacePage | null>(
        { queryKey: ['workspace', 'page'] },
        (page) => (page && page.id === pageId ? update(page) : page),
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

    // For optimistic writes: reconcile with server truth whether or not the
    // request succeeds (a failure rolls the optimistic patch back).
    const runReconcile = async <T>(promise: Promise<T>): Promise<T> => {
      try {
        return await promise
      } finally {
        await invalidate()
      }
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
      // Page properties
      addPageProperty: (input: {
        pageId: string
        name: string
        type: OptionPropertyType
      }) => run(addWorkspacePageProperty({ data: input })),
      attachPageProperty: (input: { pageId: string; propertyId: string }) =>
        run(attachWorkspacePageProperty({ data: input })),
      updatePageProperty: (input: {
        pageId: string
        propertyId: string
        name?: string
        type?: OptionPropertyType
      }) => run(updateWorkspacePageProperty({ data: input })),
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
        return runReconcile(deleteWorkspacePageProperty({ data: input }))
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
        return runReconcile(setWorkspacePagePropertyValue({ data: input }))
      },
      addPagePropertyOption: (input: {
        pageId: string
        propertyId: string
        name: string
      }) => run(addWorkspacePagePropertyOption({ data: input })),
      renamePagePropertyOption: (input: {
        pageId: string
        propertyId: string
        optionId: string
        name: string
      }) => run(renameWorkspacePagePropertyOption({ data: input })),
      deletePagePropertyOption: (input: {
        pageId: string
        propertyId: string
        optionId: string
      }) => run(deleteWorkspacePagePropertyOption({ data: input })),
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
      updateRow: (input: {
        rowId: string
        values: Record<string, CellValue>
      }) => run(updateWorkspaceRow({ data: input })),
      updateRowBody: (input: { rowId: string; body: string }) =>
        run(updateWorkspaceRowBody({ data: input })),
      deleteRow: (input: { rowId: string }) =>
        run(deleteWorkspaceRow({ data: input })),
    }
  }, [invalidate, patchPage])
}

export type WorkspaceMutations = ReturnType<typeof useWorkspaceMutations>
