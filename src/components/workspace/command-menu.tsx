import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { FileTextIcon, PlusIcon } from 'lucide-react'
import { useDeferredValue, useEffect, useState } from 'react'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '#/components/ui/command'
import { workspaceSearchQuery } from '#/lib/workspace/functions'

/**
 * ⌘K / Ctrl+K quick switcher: search every page (titles, slugs, and block
 * content — the search runs on the server) and jump to it. Results come from
 * TanStack Query keyed per query string; cmdk's own filtering is disabled
 * since the server already ranks matches.
 */
export function CommandMenu({ onNewPage }: { onNewPage: () => void }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  // Defer the query key so fast typing doesn't fire a request per keystroke.
  const deferredSearch = useDeferredValue(search.trim())

  const { data: results } = useQuery({
    ...workspaceSearchQuery(deferredSearch),
    enabled: open,
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const close = () => {
    setOpen(false)
    setSearch('')
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      title="Search pages"
      description="Search every page in the workspace"
      shouldFilter={false}
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search pages…"
      />
      <CommandList>
        <CommandEmpty>No pages found.</CommandEmpty>
        <CommandGroup heading={deferredSearch ? 'Results' : 'Pages'}>
          {(results ?? []).map((page) => (
            <CommandItem
              key={page.id}
              value={page.id}
              onSelect={() => {
                close()
                void navigate({
                  to: '/p/$pageSlug',
                  params: { pageSlug: page.slug },
                })
              }}
            >
              <span className="shrink-0">{page.icon ?? <FileTextIcon />}</span>
              <span className="truncate">{page.title || 'Untitled'}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="action-new-page"
            onSelect={() => {
              close()
              onNewPage()
            }}
          >
            <PlusIcon />
            New page
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
