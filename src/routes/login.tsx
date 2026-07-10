import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { authClient } from '#/lib/auth-client'
import { getEnabledSocialProviders } from '#/lib/auth.functions'
import { workspaceAccessQuery } from '#/lib/workspace/access.functions'

const loginSearchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/login')({
  validateSearch: loginSearchSchema,
  beforeLoad: async ({ context, search }) => {
    const access = await context.queryClient.ensureQueryData(
      workspaceAccessQuery(),
    )

    if (access.user) {
      throw redirect({ href: search.redirect ?? '/' })
    }
  },
  loader: async () => ({ providers: await getEnabledSocialProviders() }),
  component: LoginRoute,
})

type Mode = 'signin' | 'signup'

/** Turn Better Auth error codes into copy a person can act on. */
function friendlyAuthError(error: {
  code?: string
  message?: string
  status?: number
}): string {
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
    case 'USER_NOT_FOUND':
      return 'Incorrect email or password.'
    case 'USER_ALREADY_EXISTS':
      return 'An account with that email already exists — sign in instead.'
    case 'EMAIL_NOT_VERIFIED':
      return 'Verify your email before signing in — check your inbox for the link.'
    case 'PASSWORD_TOO_SHORT':
      return 'Passwords need at least 8 characters.'
    default:
      return error.message ?? 'Something went wrong. Try again.'
  }
}

function LoginRoute() {
  const { redirect: redirectTo } = Route.useSearch()
  const { providers } = Route.useLoaderData()
  const [mode, setMode] = useState<Mode>('signin')

  const target = redirectTo ?? '/'

  const form = useForm({
    defaultValues: { name: '', email: '', password: '' },
    onSubmitMeta: { mode: 'signin' as Mode },
    onSubmit: async ({ value, meta, formApi }) => {
      const result =
        meta.mode === 'signin'
          ? await authClient.signIn.email({
              email: value.email,
              password: value.password,
            })
          : await authClient.signUp.email({
              email: value.email,
              password: value.password,
              name: value.name,
            })

      if (result.error) {
        formApi.setErrorMap({
          onSubmit: {
            form: friendlyAuthError(result.error),
            fields: {},
          },
        })

        return
      }

      window.location.assign(target)
    },
  })

  const hasSocial = providers.google || providers.github

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="flex w-full max-w-sm flex-col gap-6 rounded-xl border border-[var(--workspace-line)] bg-[var(--workspace-paper)] p-7 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <img
            src="/icon.svg"
            alt="Potion"
            width={40}
            height={40}
            className="size-10 rounded-lg"
          />
          <h1 className="display-title mt-2 text-2xl font-bold">
            {mode === 'signin' ? 'Welcome back' : 'Create your workspace'}
          </h1>
          <p className="text-muted-foreground text-sm">
            {mode === 'signin'
              ? 'Sign in to your private workspace.'
              : 'Sign up to start organising your notes, tables and boards.'}
          </p>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit({ mode })
          }}
        >
          {mode === 'signup' ? (
            <form.Field name="name">
              {(field) => (
                <label
                  htmlFor="auth-name"
                  className="flex flex-col gap-1.5 text-sm font-medium"
                >
                  Name
                  <Input
                    id="auth-name"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Ada Lovelace"
                    autoComplete="name"
                    required
                  />
                </label>
              )}
            </form.Field>
          ) : null}

          <form.Field name="email">
            {(field) => (
              <label
                htmlFor="auth-email"
                className="flex flex-col gap-1.5 text-sm font-medium"
              >
                Email
                <Input
                  id="auth-email"
                  type="email"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </label>
            )}
          </form.Field>

          <form.Field name="password">
            {(field) => (
              <label
                htmlFor="auth-password"
                className="flex flex-col gap-1.5 text-sm font-medium"
              >
                Password
                <Input
                  id="auth-password"
                  type="password"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  placeholder="••••••••"
                  autoComplete={
                    mode === 'signin' ? 'current-password' : 'new-password'
                  }
                  minLength={8}
                  required
                />
              </label>
            )}
          </form.Field>

          {mode === 'signin' ? (
            <div className="-mt-1 flex justify-end">
              <Link
                to="/forgot-password"
                className="text-xs font-medium text-[var(--accent-plum)] no-underline underline-offset-2 hover:underline"
              >
                Forgot password?
              </Link>
            </div>
          ) : null}

          <form.Subscribe
            selector={(state) =>
              (state.errorMap.onSubmit as { form?: string } | undefined)?.form
            }
          >
            {(submitError) =>
              submitError ? (
                <p className="text-sm font-medium text-[var(--accent-rust)]">
                  {typeof submitError === 'string'
                    ? submitError
                    : 'Something went wrong. Try again.'}
                </p>
              ) : null
            }
          </form.Subscribe>

          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting} className="mt-1">
                {isSubmitting
                  ? 'Please wait…'
                  : mode === 'signin'
                    ? 'Sign in'
                    : 'Create account'}
              </Button>
            )}
          </form.Subscribe>
        </form>

        {hasSocial ? (
          <div className="flex flex-col gap-2">
            <div className="text-muted-foreground text-center text-xs">
              or continue with
            </div>
            {providers.google ? (
              <Button
                variant="outline"
                onClick={() =>
                  authClient.signIn.social({
                    provider: 'google',
                    callbackURL: target,
                  })
                }
              >
                Google
              </Button>
            ) : null}
            {providers.github ? (
              <Button
                variant="outline"
                onClick={() =>
                  authClient.signIn.social({
                    provider: 'github',
                    callbackURL: target,
                  })
                }
              >
                GitHub
              </Button>
            ) : null}
          </div>
        ) : null}

        <p className="text-muted-foreground text-center text-sm">
          {mode === 'signin' ? "Don't have an account?" : 'Already have one?'}{' '}
          <button
            type="button"
            className="font-semibold text-[var(--accent-plum)] underline-offset-2 hover:underline"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin')
              form.setErrorMap({ onSubmit: undefined })
            }}
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </section>
    </main>
  )
}
