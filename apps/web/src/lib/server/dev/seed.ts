import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { DEV_ACCOUNTS } from './seed-accounts'

if (process.env.NODE_ENV === 'production') {
  throw new Error('seed.ts must not be run in production')
}

const client = postgres(process.env.DATABASE_URL!)
const db = drizzle(client, { schema })

async function main() {
  console.log('Seeding dev data...')

  // -------------------------------------------------------------------------
  // 1. Upsert user namespaces + users
  // -------------------------------------------------------------------------
  for (const account of DEV_ACCOUNTS) {
    const k8sNamespace = `u-${account.namespaceSlug}`

    // Upsert namespace
    const [ns] = await db
      .insert(schema.namespaces)
      .values({
        slug: account.namespaceSlug,
        type: 'user',
        k8sNamespace,
      })
      .onConflictDoNothing()
      .returning()

    // If it already existed, fetch it
    const namespace =
      ns ??
      (await db.query.namespaces.findFirst({
        where: (n, { eq }) => eq(n.slug, account.namespaceSlug),
      }))!

    // Upsert user (ON CONFLICT (id) DO NOTHING)
    await db
      .insert(schema.users)
      .values({
        id: account.id,
        namespaceId: namespace.id,
        email: account.email,
        displayName: account.displayName,
      })
      .onConflictDoNothing()

    console.log(`  user: ${account.email} (namespace: ${account.namespaceSlug})`)
  }

  // -------------------------------------------------------------------------
  // 2. Upsert dev org namespace + organization
  // -------------------------------------------------------------------------
  const orgSlug = 'dev-org'
  const orgK8sNamespace = 'o-dev-org'

  const [orgNs] = await db
    .insert(schema.namespaces)
    .values({
      slug: orgSlug,
      type: 'org',
      k8sNamespace: orgK8sNamespace,
    })
    .onConflictDoNothing()
    .returning()

  const orgNamespace =
    orgNs ??
    (await db.query.namespaces.findFirst({
      where: (n, { eq }) => eq(n.slug, orgSlug),
    }))!

  const [org] = await db
    .insert(schema.organizations)
    .values({
      namespaceId: orgNamespace.id,
      displayName: 'Dev Organization',
    })
    .onConflictDoNothing()
    .returning()

  const organization =
    org ??
    (await db.query.organizations.findFirst({
      where: (o, { eq }) => eq(o.namespaceId, orgNamespace.id),
    }))!

  console.log(`  org: Dev Organization (namespace: ${orgSlug})`)

  // -------------------------------------------------------------------------
  // 3. Upsert org members
  // -------------------------------------------------------------------------
  const orgOwner = DEV_ACCOUNTS[3] // orgowner@dev.local
  const orgMember = DEV_ACCOUNTS[4] // orgmember@dev.local

  await db
    .insert(schema.orgMembers)
    .values({ orgId: organization.id, userId: orgOwner.id, role: 'owner' })
    .onConflictDoNothing()

  console.log(`  org member: ${orgOwner.email} -> owner`)

  await db
    .insert(schema.orgMembers)
    .values({ orgId: organization.id, userId: orgMember.id, role: 'member' })
    .onConflictDoNothing()

  console.log(`  org member: ${orgMember.email} -> member`)

  console.log('Done.')
}

main().catch(console.error).finally(() => process.exit())
