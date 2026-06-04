import { db, serverErrors } from '$lib/server/db'

export async function logServerError(
  message: string,
  opts?: {
    stack?: string
    route?: string
    userId?: string
    context?: Record<string, unknown>
  }
): Promise<void> {
  console.error('[server-error]', opts?.route ?? 'unknown', message, opts?.stack ?? '')
  try {
    await db.insert(serverErrors).values({
      message,
      stack: opts?.stack,
      route: opts?.route,
      userId: opts?.userId ?? null,
      context: opts?.context ? JSON.stringify(opts.context) : null,
    })
  } catch {
    console.error('[error-log] failed to persist server error:', message)
  }
}
