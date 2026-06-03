// Standalone database migration runner.
// Uses drizzle-orm/postgres-js/migrator (production dep — no drizzle-kit needed).
// Run with: node migrate.mjs
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const client = postgres(process.env.DATABASE_URL, { max: 1 })
const db = drizzle(client)

try {
  await migrate(db, { migrationsFolder: join(__dirname, 'drizzle') })
  console.log('Migrations applied successfully')
} finally {
  await client.end()
}
