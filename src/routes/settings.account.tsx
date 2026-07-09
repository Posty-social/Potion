import { createFileRoute } from '@tanstack/react-router'

import { AccountSettings } from '#/components/workspace/account-settings'

export const Route = createFileRoute('/settings/account')({
  component: AccountSettingsPage,
})

function AccountSettingsPage() {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="display-title text-2xl font-bold">My account</h1>
        <p className="text-sm text-[var(--workspace-ink-soft)]">
          Your name and profile picture, shown to everyone in the workspace.
        </p>
      </div>

      <AccountSettings />
    </section>
  )
}
