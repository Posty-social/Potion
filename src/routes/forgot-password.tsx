import { useMutation } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordRoute,
})

function ForgotPasswordRoute() {
  const [email, setEmail] = useState('')

  const requestMutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: '/reset-password',
      })
      if (error) {
        throw new Error(
          error.message ?? 'Could not send the reset email. Try again.',
        )
      }
    },
  })

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

        {requestMutation.isSuccess ? (
          <>
            <h1 className="display-title text-2xl font-bold">
              Check your email
            </h1>
            <p className="text-muted-foreground text-sm leading-6">
              If an account exists for{' '}
              <span className="font-medium text-[var(--workspace-ink)]">
                {email.trim()}
              </span>
              , we sent a link to reset its password. The link expires in one
              hour.
            </p>
            <Link
              to="/login"
              className="text-sm font-semibold text-[var(--accent-plum)] underline-offset-2 hover:underline"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <h1 className="display-title text-2xl font-bold">
                Reset your password
              </h1>
              <p className="text-muted-foreground text-sm">
                Enter your account email and we&apos;ll send you a reset link.
              </p>
            </div>

            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                if (email.trim()) {
                  requestMutation.mutate()
                }
              }}
            >
              <label
                htmlFor="forgot-email"
                className="flex flex-col gap-1.5 text-sm font-medium"
              >
                Email
                <Input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </label>

              {requestMutation.error ? (
                <p className="text-sm font-medium text-[var(--accent-rust)]">
                  {requestMutation.error.message}
                </p>
              ) : null}

              <Button
                type="submit"
                disabled={requestMutation.isPending || !email.trim()}
              >
                {requestMutation.isPending ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>

            <p className="text-muted-foreground text-center text-sm">
              Remembered it?{' '}
              <Link
                to="/login"
                className="font-semibold text-[var(--accent-plum)] underline-offset-2 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  )
}
