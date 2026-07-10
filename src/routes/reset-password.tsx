import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { authClient } from '#/lib/auth-client'

// Better Auth redirects the emailed link here with ?token= (or ?error= when
// the link is invalid or already used).
const resetSearchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
})

export const Route = createFileRoute('/reset-password')({
  validateSearch: resetSearchSchema,
  component: ResetPasswordRoute,
})

function ResetPasswordRoute() {
  const { token, error: linkError } = Route.useSearch()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        throw new Error('This reset link is missing its token.')
      }
      if (password !== confirm) {
        throw new Error('The passwords do not match.')
      }
      const { error } = await authClient.resetPassword({
        newPassword: password,
        token,
      })
      if (error) {
        throw new Error(
          error.message ??
            'Could not reset the password. The link may have expired.',
        )
      }
    },
    onSuccess: () => {
      void navigate({ to: '/login' })
    },
  })

  const unusable = Boolean(linkError) || !token

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="flex w-full max-w-sm flex-col gap-5 rounded-xl border border-[var(--workspace-line)] bg-[var(--workspace-paper)] p-7 shadow-sm">
        <img
          src="/icon.svg"
          alt="Potion"
          width={40}
          height={40}
          className="size-10 rounded-lg"
        />

        {unusable ? (
          <>
            <h1 className="display-title text-2xl font-bold">
              Link unavailable
            </h1>
            <p className="text-muted-foreground text-sm leading-6">
              This password reset link is invalid or has expired. Request a new
              one and try again.
            </p>
            <Link
              to="/forgot-password"
              className="text-sm font-semibold text-[var(--accent-plum)] underline-offset-2 hover:underline"
            >
              Request a new link
            </Link>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <h1 className="display-title text-2xl font-bold">
                Choose a new password
              </h1>
              <p className="text-muted-foreground text-sm">
                It needs at least 8 characters.
              </p>
            </div>

            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                resetMutation.mutate()
              }}
            >
              <label
                htmlFor="reset-password"
                className="flex flex-col gap-1.5 text-sm font-medium"
              >
                New password
                <Input
                  id="reset-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>

              <label
                htmlFor="reset-confirm"
                className="flex flex-col gap-1.5 text-sm font-medium"
              >
                Confirm password
                <Input
                  id="reset-confirm"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>

              {resetMutation.error ? (
                <p className="text-sm font-medium text-[var(--accent-rust)]">
                  {resetMutation.error.message}
                </p>
              ) : null}

              <Button
                type="submit"
                disabled={resetMutation.isPending || !password || !confirm}
              >
                {resetMutation.isPending ? 'Saving…' : 'Reset password'}
              </Button>
            </form>
          </>
        )}
      </section>
    </main>
  )
}
