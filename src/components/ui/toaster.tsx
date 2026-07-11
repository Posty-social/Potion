import { useSyncExternalStore } from 'react'

import { cn } from '#/lib/utils'

export type Toast = {
  id: number
  title: string
  description?: string
  variant: 'default' | 'error'
  /** 0–1 renders a progress bar; null hides it. */
  progress: number | null
}

type ToastInput = {
  title: string
  description?: string
  variant?: 'default' | 'error'
  progress?: number | null
  /**
   * ms until auto-dismiss. null keeps the toast until updated or dismissed;
   * omitted defaults to 4s (progress toasts default to sticking around).
   */
  duration?: number | null
}

// Module-level store so `toast()` is callable from anywhere (including
// non-component code like upload helpers); <Toaster /> subscribes to it.
let nextId = 1
let toasts: Toast[] = []
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

function schedule(id: number, duration: number | null) {
  const existing = timers.get(id)
  if (existing) {
    clearTimeout(existing)
    timers.delete(id)
  }
  if (duration !== null) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), duration),
    )
  }
}

export function toast(input: ToastInput): number {
  const id = nextId++
  toasts = [
    ...toasts,
    {
      id,
      title: input.title,
      description: input.description,
      variant: input.variant ?? 'default',
      progress: input.progress ?? null,
    },
  ]
  schedule(
    id,
    input.duration !== undefined
      ? input.duration
      : input.progress != null
        ? null
        : 4000,
  )
  emit()
  return id
}

export function updateToast(id: number, patch: Partial<ToastInput>): void {
  const { duration, ...rest } = patch
  toasts = toasts.map((item) => (item.id === id ? { ...item, ...rest } : item))
  if (duration !== undefined) {
    schedule(id, duration)
  }
  emit()
}

export function dismissToast(id: number): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  toasts = toasts.filter((item) => item.id !== id)
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const EMPTY: Toast[] = []
const getSnapshot = () => toasts
const getServerSnapshot = () => EMPTY

export function Toaster() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  if (items.length === 0) {
    return null
  }

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          className={cn(
            'animate-in fade-in slide-in-from-bottom-2 pointer-events-auto rounded-lg border bg-[var(--workspace-paper)] p-3 shadow-lg',
            item.variant === 'error'
              ? 'border-[var(--accent-rust)]'
              : 'border-[var(--workspace-line)]',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <p
              className={cn(
                'min-w-0 truncate text-sm font-medium',
                item.variant === 'error' && 'text-[var(--accent-rust)]',
              )}
            >
              {item.title}
            </p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismissToast(item.id)}
              className="shrink-0 text-xs text-[var(--workspace-ink-soft)] hover:text-[var(--workspace-ink)]"
            >
              ✕
            </button>
          </div>
          {item.description ? (
            <p className="mt-0.5 text-xs break-words text-[var(--workspace-ink-soft)]">
              {item.description}
            </p>
          ) : null}
          {item.progress != null ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--workspace-hover)]">
              <div
                className="h-full rounded-full bg-[var(--accent-teal)] transition-[width] duration-200"
                style={{ width: `${Math.round(item.progress * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
