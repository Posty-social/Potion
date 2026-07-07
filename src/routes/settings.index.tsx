import { createFileRoute } from '@tanstack/react-router'
import { Loader2Icon } from 'lucide-react'

import {
  GeneralSettings,
  useActiveWorkspace,
} from '#/components/workspace/workspace-settings'

export const Route = createFileRoute('/settings/')({
  component: GeneralSettingsPage,
})

function GeneralSettingsPage() {
  const { workspace, pending } = useActiveWorkspace()

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="display-title text-2xl font-bold">General</h1>
        <p className="text-sm text-[var(--workspace-ink-soft)]">
          Manage your workspace name and details.
        </p>
      </div>

      {workspace ? (
        <GeneralSettings key={workspace.id} workspace={workspace} />
      ) : (
        <WorkspaceLoading pending={pending} />
      )}
    </section>
  )
}

function WorkspaceLoading({ pending }: { pending: boolean }) {
  if (pending) {
    return (
      <div className="flex items-center gap-2 py-8 text-[var(--workspace-ink-soft)]">
        <Loader2Icon className="size-5 animate-spin" />
      </div>
    )
  }

  return (
    <p className="py-8 text-sm text-[var(--workspace-ink-soft)]">
      No active workspace found.
    </p>
  )
}
