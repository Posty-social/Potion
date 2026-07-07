import { useNavigate } from '@tanstack/react-router'
import {
  CheckIcon,
  ChevronsUpDownIcon,
  Loader2Icon,
  PlusIcon,
  SettingsIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'

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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import type { WorkspaceSummary } from '#/components/workspace/workspace-settings'
import { authClient } from '#/lib/auth-client'

/** Derive a URL-safe, reasonably unique slug from a workspace name. */
function slugifyWorkspaceName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  const suffix = Math.random().toString(36).slice(2, 8)

  return base ? `${base}-${suffix}` : `workspace-${suffix}`
}

/**
 * Workspace switcher shown at the top of the sidebar. Lets the user switch
 * between the workspaces (organizations) they belong to, create a new one, and
 * open the workspace settings page.
 */
export function WorkspaceSwitcher() {
  const navigate = useNavigate()
  // Better Auth session/org stores are client-only; gate rendering behind a
  // mount flag so SSR and the first client render match (avoids hydration
  // mismatches, matching the pattern used elsewhere in the shell).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { data: organizations } = authClient.useListOrganizations()
  const { data: activeOrganization } = authClient.useActiveOrganization()

  const [createOpen, setCreateOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  const workspaces = (organizations ?? []) as WorkspaceSummary[]
  const active = (activeOrganization ?? null) as WorkspaceSummary | null
  const activeName = active?.name ?? workspaces[0]?.name

  const switchWorkspace = async (organizationId: string) => {
    if (organizationId === active?.id) {
      return
    }
    setSwitching(true)
    const { error } = await authClient.organization.setActive({
      organizationId,
    })
    if (error) {
      setSwitching(false)
      return
    }
    // Full reload so every route loader re-reads data for the new workspace.
    window.location.assign('/')
  }

  return (
    <div className="flex items-center gap-1 px-3 py-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Switch workspace"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-[var(--workspace-hover)]"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--accent-plum)] text-sm font-bold text-white">
              {mounted && activeName ? activeName.charAt(0).toUpperCase() : 'P'}
            </div>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {mounted ? (activeName ?? 'Potion') : 'Potion'}
            </span>
            {switching ? (
              <Loader2Icon className="size-4 shrink-0 animate-spin text-[var(--workspace-ink-soft)]" />
            ) : (
              <ChevronsUpDownIcon className="size-4 shrink-0 text-[var(--workspace-ink-soft)]" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs text-[var(--workspace-ink-soft)]">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onClick={() => switchWorkspace(workspace.id)}
            >
              <div className="flex size-5 shrink-0 items-center justify-center rounded bg-[var(--accent-plum)] text-[10px] font-bold text-white">
                {workspace.name.charAt(0).toUpperCase()}
              </div>
              <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
              {workspace.id === active?.id ? (
                <CheckIcon className="size-4 shrink-0" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void navigate({ to: '/settings' })}>
            <SettingsIcon className="size-4" />
            Workspace settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

// --- Create workspace ----------------------------------------------------

function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    setSubmitting(true)
    setError(null)
    const { error: createError } = await authClient.organization.create({
      name: trimmed,
      slug: slugifyWorkspaceName(trimmed),
    })
    if (createError) {
      setSubmitting(false)
      setError(createError.message ?? 'Could not create workspace.')
      return
    }
    // New workspaces become active on create; reload so the app lands in the
    // fresh (seeded) workspace.
    window.location.assign('/')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            A workspace is a separate space for pages, databases and members.
          </DialogDescription>
        </DialogHeader>
        <label
          htmlFor="create-workspace-name"
          className="flex flex-col gap-1.5 text-sm font-medium"
        >
          Workspace name
          <Input
            id="create-workspace-name"
            value={name}
            placeholder="Acme Inc."
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void submit()
              }
            }}
          />
        </label>
        {error ? (
          <p className="text-sm font-medium text-[var(--accent-rust)]">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || !name.trim()}
          >
            {submitting ? 'Creating…' : 'Create workspace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
