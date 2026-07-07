import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { Button } from '#/components/ui/button'
import { authClient } from '#/lib/auth-client'
import {
  ensurePersonalWorkspaceForCurrentUser,
  workspaceAccessQuery,
} from '#/lib/workspace/access.functions'

export const Route = createFileRoute('/accept-invitation/$invitationId')({
  beforeLoad: async ({ context, location }) => {
    const access = await context.queryClient.ensureQueryData(
      workspaceAccessQuery(),
    )

    // The invitee must be signed in (with the invited email) to accept. Send
    // them to login first and bring them straight back here afterwards.
    if (!access.user) {
      context.queryClient.removeQueries(workspaceAccessQuery())
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  component: AcceptInvitationRoute,
})

type InvitationDetails = {
  organizationName?: string | null
  organizationId: string
  role: string
  inviterEmail?: string | null
}

function AcceptInvitationRoute() {
  const { invitationId } = Route.useParams()
  const navigate = useNavigate()

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)

  useEffect(() => {
    let cancelled = false

    void authClient.organization
      .getInvitation({ query: { id: invitationId } })
      .then(({ data, error }) => {
        if (cancelled) {
          return
        }
        if (error || !data) {
          setLoadError(
            error?.message ??
              'This invitation is no longer valid. Ask for a new one.',
          )
          return
        }
        setInvitation(data as InvitationDetails)
      })

    return () => {
      cancelled = true
    }
  }, [invitationId])

  const accept = async () => {
    setBusy('accept')
    setActionError(null)
    const { error } = await authClient.organization.acceptInvitation({
      invitationId,
    })
    if (error) {
      setBusy(null)
      setActionError(error.message ?? 'Could not accept the invitation.')
      return
    }
    // Land the user in the workspace they just joined.
    if (invitation) {
      await authClient.organization.setActive({
        organizationId: invitation.organizationId,
      })
    }
    window.location.assign('/')
  }

  const reject = async () => {
    setBusy('reject')
    setActionError(null)
    await authClient.organization.rejectInvitation({ invitationId })
    // A user who signed up to consider this invite has no personal workspace
    // yet (we skip that at signup when an invite is pending). Declining means
    // they go solo, so provision one and make it active before landing them in
    // the app.
    const { organizationId } = await ensurePersonalWorkspaceForCurrentUser()
    if (organizationId) {
      await authClient.organization.setActive({ organizationId })
    }
    window.location.assign('/')
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="flex w-full max-w-md flex-col gap-5 rounded-xl border border-[var(--workspace-line)] bg-[var(--workspace-paper)] p-7 shadow-sm">
        <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--accent-plum)] text-lg font-bold text-white">
          P
        </div>

        {loadError ? (
          <>
            <h1 className="display-title text-2xl font-bold">
              Invitation unavailable
            </h1>
            <p className="text-muted-foreground text-sm leading-6">
              {loadError}
            </p>
            <Button
              variant="outline"
              onClick={() => void navigate({ to: '/' })}
            >
              Go to your workspace
            </Button>
          </>
        ) : !invitation ? (
          <p className="text-muted-foreground text-sm">Loading invitation…</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <h1 className="display-title text-2xl font-bold">
                Join {invitation.organizationName ?? 'this workspace'}
              </h1>
              <p className="text-muted-foreground text-sm leading-6">
                {invitation.inviterEmail
                  ? `${invitation.inviterEmail} invited you to join `
                  : "You've been invited to join "}
                <span className="font-medium text-[var(--workspace-ink)]">
                  {invitation.organizationName ?? 'a workspace'}
                </span>{' '}
                as a {invitation.role}.
              </p>
            </div>

            {actionError ? (
              <p className="text-sm font-medium text-[var(--accent-rust)]">
                {actionError}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => void accept()}
                disabled={busy !== null}
              >
                {busy === 'accept' ? 'Joining…' : 'Accept invitation'}
              </Button>
              <Button
                variant="outline"
                onClick={() => void reject()}
                disabled={busy !== null}
              >
                Decline
              </Button>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
