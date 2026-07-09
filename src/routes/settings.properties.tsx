import { createFileRoute } from '@tanstack/react-router'

import { PropertiesSettings } from '#/components/workspace/workspace-properties-settings'

export const Route = createFileRoute('/settings/properties')({
  component: PropertiesSettingsPage,
})

function PropertiesSettingsPage() {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="display-title text-2xl font-bold">Properties</h1>
        <p className="text-sm text-[var(--workspace-ink-soft)]">
          Every property in the workspace. Properties are shared — renaming,
          changing a type, or editing select options applies to every page that
          uses them.
        </p>
      </div>

      <PropertiesSettings />
    </section>
  )
}
