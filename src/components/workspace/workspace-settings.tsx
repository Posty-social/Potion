import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckIcon,
  CopyIcon,
  Loader2Icon,
  TrashIcon,
  UserPlusIcon,
} from 'lucide-react'
import { useState } from 'react'

import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { authClient } from '#/lib/auth-client'
import { initialsFor } from '#/lib/workspace/types'

// A workspace in the UI is an organization in the data model / Better Auth.
export type WorkspaceSummary = {
  id: string
  name: string
  slug: string
  logo?: string | null
}

type InviteRole = 'member' | 'admin'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
}

/**
 * Resolve the currently active workspace for the settings pages. The Better
 * Auth org store is client-only, so `workspace` is null until it loads.
 */
export function useActiveWorkspace(): {
  workspace: WorkspaceSummary | null
  pending: boolean
} {
  const { data, isPending } = authClient.useActiveOrganization()

  return {
    workspace: (data ?? null) as WorkspaceSummary | null,
    pending: isPending,
  }
}

// --- General -------------------------------------------------------------

export function GeneralSettings({
  workspace,
}: {
  workspace: WorkspaceSummary
}) {
  const [name, setName] = useState(workspace.name)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === workspace.name) {
      return
    }
    setStatus('saving')
    setError(null)
    const { error: updateError } = await authClient.organization.update({
      organizationId: workspace.id,
      data: { name: trimmed },
    })
    if (updateError) {
      setStatus('idle')
      setError(updateError.message ?? 'Could not update workspace.')
      return
    }
    setStatus('saved')
    // Reload so the switcher and any name-derived UI pick up the new name.
    window.location.reload()
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <label
        htmlFor="workspace-name"
        className="flex flex-col gap-1.5 text-sm font-medium"
      >
        Workspace name
        <Input
          id="workspace-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error ? (
        <p className="text-sm font-medium text-[var(--accent-rust)]">{error}</p>
      ) : null}
      <div className="flex justify-end">
        <Button
          onClick={() => void save()}
          disabled={
            status === 'saving' ||
            !name.trim() ||
            name.trim() === workspace.name
          }
        >
          {status === 'saving' ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}

// --- Members -------------------------------------------------------------

type FullMember = {
  id: string
  role: string
  userId: string
  user: { name?: string | null; email: string }
}

type FullInvitation = {
  id: string
  email: string
  role: string
  status: string
}

/**
 * Members + pending invitations for a workspace. Keyed by workspace id so each
 * workspace is cached independently and switching workspaces refetches; writes
 * invalidate this key to refresh.
 */
function workspaceOrganizationQuery(workspaceId: string) {
  return queryOptions({
    queryKey: ['workspace', 'organization', workspaceId],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getFullOrganization(
        {
          query: { organizationId: workspaceId },
        },
      )
      if (error) {
        throw new Error(error.message ?? 'Could not load workspace members.')
      }
      return {
        members: (data?.members ?? []) as FullMember[],
        invitations: ((data?.invitations ?? []) as FullInvitation[]).filter(
          (invite) => invite.status === 'pending',
        ),
      }
    },
  })
}

export function MembersSettings({
  workspace,
}: {
  workspace: WorkspaceSummary
}) {
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const { data, isPending, isError, error } = useQuery(
    workspaceOrganizationQuery(workspace.id),
  )

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ['workspace', 'organization', workspace.id],
    })

  const members = data?.members ?? []
  const invitations = data?.invitations ?? []
  const currentUserId = session?.user?.id
  const currentRole = members.find(
    (member) => member.userId === currentUserId,
  )?.role
  const canManage = currentRole === 'owner' || currentRole === 'admin'

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

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {canManage ? (
        <InviteForm workspace={workspace} onInvited={invalidate} />
      ) : null}

      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-bold tracking-wide text-[var(--workspace-ink-soft)] uppercase">
          Members
        </h3>
        <div className="flex flex-col">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 border-b border-[var(--workspace-line)] py-2 last:border-b-0"
            >
              <Avatar className="size-8 rounded-md">
                <AvatarFallback className="rounded-md bg-[var(--accent-teal)] text-xs text-white">
                  {initialsFor(member.user.name ?? '', member.user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.user.name || member.user.email}
                  {member.userId === currentUserId ? (
                    <span className="text-[var(--workspace-ink-soft)]">
                      {' '}
                      (you)
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-[var(--workspace-ink-soft)]">
                  {member.user.email}
                </p>
              </div>
              <Badge variant="secondary">
                {ROLE_LABELS[member.role] ?? member.role}
              </Badge>
              {canManage &&
              member.role !== 'owner' &&
              member.userId !== currentUserId ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${member.user.email}`}
                  onClick={async () => {
                    await authClient.organization.removeMember({
                      organizationId: workspace.id,
                      memberIdOrEmail: member.user.email,
                    })
                    await invalidate()
                  }}
                >
                  <TrashIcon className="size-4" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {invitations.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-bold tracking-wide text-[var(--workspace-ink-soft)] uppercase">
            Pending invitations
          </h3>
          <div className="flex flex-col">
            {invitations.map((invite) => (
              <PendingInvitationRow
                key={invite.id}
                invite={invite}
                canManage={canManage}
                onCancelled={invalidate}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function InviteForm({
  workspace,
  onInvited,
}: {
  workspace: WorkspaceSummary
  onInvited: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole>('member')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)

  const submit = async () => {
    const trimmed = email.trim()
    if (!trimmed) {
      return
    }
    setSubmitting(true)
    setError(null)
    setInviteLink(null)
    const { data, error: inviteError } =
      await authClient.organization.inviteMember({
        organizationId: workspace.id,
        email: trimmed,
        role,
      })
    setSubmitting(false)
    if (inviteError) {
      setError(inviteError.message ?? 'Could not send invitation.')
      return
    }
    setEmail('')
    if (data?.id) {
      setInviteLink(`${window.location.origin}/accept-invitation/${data.id}`)
    }
    await onInvited()
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--workspace-line)] p-3">
      <h3 className="text-xs font-bold tracking-wide text-[var(--workspace-ink-soft)] uppercase">
        Invite people
      </h3>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          value={email}
          placeholder="teammate@example.com"
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void submit()
            }
          }}
          className="flex-1"
        />
        <Select
          value={role}
          onValueChange={(value) => setRole(value as InviteRole)}
        >
          <SelectTrigger className="sm:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <Button
          onClick={() => void submit()}
          disabled={submitting || !email.trim()}
        >
          <UserPlusIcon className="size-4" />
          {submitting ? 'Inviting…' : 'Invite'}
        </Button>
      </div>
      {error ? (
        <p className="text-sm font-medium text-[var(--accent-rust)]">{error}</p>
      ) : null}
      {inviteLink ? <InviteLink link={inviteLink} /> : null}
    </div>
  )
}

function InviteLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-[var(--workspace-hover)] p-2">
      <p className="text-xs text-[var(--workspace-ink-soft)]">
        Share this link with your teammate so they can join:
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-[var(--workspace-paper)] px-2 py-1 text-xs">
          {link}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(link)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? (
            <CheckIcon className="size-4" />
          ) : (
            <CopyIcon className="size-4" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

function PendingInvitationRow({
  invite,
  canManage,
  onCancelled,
}: {
  invite: FullInvitation
  canManage: boolean
  onCancelled: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/accept-invitation/${invite.id}`

  return (
    <div className="flex items-center gap-3 border-b border-[var(--workspace-line)] py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{invite.email}</p>
        <p className="truncate text-xs text-[var(--workspace-ink-soft)]">
          Invited as {ROLE_LABELS[invite.role] ?? invite.role}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Copy invite link for ${invite.email}`}
        onClick={() => void navigator.clipboard.writeText(link)}
      >
        <CopyIcon className="size-4" />
        Copy link
      </Button>
      {canManage ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Cancel invitation for ${invite.email}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await authClient.organization.cancelInvitation({
              invitationId: invite.id,
            })
            await onCancelled()
          }}
        >
          <TrashIcon className="size-4" />
        </Button>
      ) : null}
    </div>
  )
}
