import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

function buildConnectionUrl(): string {
  const raw = process.env.DATABASE_URL
  if (!raw) return ''
  if (process.env.NODE_ENV === 'production') {
    try {
      const url = new URL(raw)
      if (!url.searchParams.has('sslmode')) {
        url.searchParams.set('sslmode', 'require')
        return url.toString()
      }
    } catch {
      // Not a parseable URL (e.g. postgres DSN format) — use as-is
    }
  }
  return raw
}

const client = postgres(buildConnectionUrl())
export const db = drizzle(client, { schema })
export * from './schema'
