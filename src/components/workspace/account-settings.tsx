import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2Icon, UploadIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { authClient } from '#/lib/auth-client'
import { initialsFor } from '#/lib/workspace/types'

/**
 * Personal account settings: display name and profile picture. The picture is
 * stored in the R2 assets bucket under `users/$userId/profile` and served back
 * through `/api/users/$userId/avatar`.
 */
export function AccountSettings() {
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const user = session?.user

  // Bumped after an upload so every <img> refetches past the cache.
  const [avatarVersion, setAvatarVersion] = useState(0)
  const [name, setName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['workspace', 'members'] })

  const nameMutation = useMutation({
    mutationFn: async (nextName: string) => {
      const { error } = await authClient.updateUser({ name: nextName })
      if (error) {
        throw new Error(error.message ?? 'Could not update your name.')
      }
    },
    onSuccess: () => {
      void invalidate()
      void queryClient.invalidateQueries({ queryKey: ['auth', 'access'] })
    },
  })

  const avatarMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!user) {
        throw new Error('Not signed in.')
      }
      const response = await fetch(`/api/users/${user.id}/avatar`, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(
          body?.error === 'invalid_size'
            ? 'Pictures must be under 5 MB.'
            : body?.error === 'not_an_image'
              ? 'That file is not an image.'
              : 'Could not upload the picture.',
        )
      }
    },
    onSuccess: () => {
      setAvatarVersion((version) => version + 1)
      void invalidate()
    },
  })

  if (!user) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--workspace-ink-soft)]">
        <Loader2Icon className="size-5 animate-spin" />
      </div>
    )
  }

  const currentName = name ?? user.name ?? ''
  const error = nameMutation.error?.message ?? avatarMutation.error?.message

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar className="size-16 rounded-full">
          <AvatarImage
            src={`/api/users/${user.id}/avatar?v=${avatarVersion}`}
            alt={user.name ?? 'Profile picture'}
          />
          <AvatarFallback className="rounded-full bg-[var(--accent-teal)] text-lg text-white">
            {initialsFor(user.name ?? '', user.email)}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={avatarMutation.isPending}
          >
            <UploadIcon className="size-4" />
            {avatarMutation.isPending ? 'Uploading…' : 'Upload picture'}
          </Button>
          <p className="text-xs text-[var(--workspace-ink-soft)]">
            An image up to 5 MB.
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Choose a profile picture"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              avatarMutation.mutate(file)
            }
            event.target.value = ''
          }}
        />
      </div>

      <label
        htmlFor="account-name"
        className="flex flex-col gap-1.5 text-sm font-medium"
      >
        Preferred name
        <Input
          id="account-name"
          value={currentName}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <p className="text-sm text-[var(--workspace-ink-soft)]">
        Signed in as {user.email}
      </p>

      {error ? (
        <p className="text-sm font-medium text-[var(--accent-rust)]">{error}</p>
      ) : null}

      <div className="flex justify-end">
        <Button
          onClick={() => nameMutation.mutate(currentName.trim())}
          disabled={
            nameMutation.isPending ||
            !currentName.trim() ||
            currentName.trim() === user.name
          }
        >
          {nameMutation.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}
