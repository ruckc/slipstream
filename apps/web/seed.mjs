// Standalone dev account seeder — runs in the production container (no tsx needed).
// Mirrors src/lib/server/dev/seed.ts using raw SQL via the postgres client.
import postgres from 'postgres'
import https from 'https'
import fs from 'fs'

if (process.env.DEV_MODE !== 'true') {
  console.error('DEV_MODE is not set to true — refusing to seed')
  process.exit(1)
}

const DEV_ACCOUNTS = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    email: 'admin@dev.local',
    displayName: 'Dev Admin',
    namespaceSlug: 'dev-admin',
    role: 'admin',
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    email: 'user1@dev.local',
    displayName: 'Dev User 1',
    namespaceSlug: 'dev-user1',
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    email: 'user2@dev.local',
    displayName: 'Dev User 2',
    namespaceSlug: 'dev-user2',
  },
  {
    id: '00000000-0000-0000-0000-000000000004',
    email: 'orgowner@dev.local',
    displayName: 'Dev Org Owner',
    namespaceSlug: 'dev-orgowner',
  },
  {
    id: '00000000-0000-0000-0000-000000000005',
    email: 'orgmember@dev.local',
    displayName: 'Dev Org Member',
    namespaceSlug: 'dev-orgmember',
  },
]

const sql = postgres(process.env.DATABASE_URL, { max: 1 })

// Kubernetes API via in-cluster config
const K8S_HOST = process.env.KUBERNETES_SERVICE_HOST
const K8S_PORT = process.env.KUBERNETES_SERVICE_PORT
const K8S_TOKEN = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8')
const K8S_CA = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt')

function k8sRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const req = https.request(
      {
        hostname: K8S_HOST,
        port: K8S_PORT,
        path,
        method,
        ca: K8S_CA,
        headers: {
          Authorization: `Bearer ${K8S_TOKEN}`,
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }))
      }
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

async function ensureK8sNamespace(k8sNamespace, slug, type) {
  const res = await k8sRequest('GET', `/api/v1/namespaces/${k8sNamespace}`)
  if (res.status === 200) return
  const create = await k8sRequest('POST', '/api/v1/namespaces', {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name: k8sNamespace,
      labels: {
        'slipstream.io/type': type,
        'slipstream.io/namespace-slug': slug,
      },
    },
  })
  if (create.status !== 201) {
    throw new Error(
      `Failed to create k8s namespace ${k8sNamespace}: ${JSON.stringify(create.body)}`
    )
  }
}

async function upsertNamespace(slug, type) {
  const _k8sNamespace = `${type === 'user' ? 'u' : 'o'}-${slug}`
  const rows = await sql`
    INSERT INTO namespaces (slug, type)
    VALUES (${slug}, ${type})
    ON CONFLICT (slug) DO NOTHING
    RETURNING id
  `
  if (rows.length) return rows[0].id
  const [{ id }] = await sql`SELECT id FROM namespaces WHERE slug = ${slug}`
  return id
}

async function main() {
  console.log('Seeding dev data...')

  for (const account of DEV_ACCOUNTS) {
    const k8sNs = `u-${account.namespaceSlug}`
    await ensureK8sNamespace(k8sNs, account.namespaceSlug, 'user')
    const namespaceId = await upsertNamespace(account.namespaceSlug, 'user')
    await sql`
      INSERT INTO users (id, namespace_id, email, display_name, role)
      VALUES (${account.id}, ${namespaceId}, ${account.email}, ${account.displayName}, ${account.role ?? 'user'})
      ON CONFLICT (id) DO NOTHING
    `
    console.log(`  user: ${account.email} (namespace: ${account.namespaceSlug}, k8s: ${k8sNs})`)
  }

  const orgSlug = 'dev-org'
  const orgK8sNs = `o-${orgSlug}`
  await ensureK8sNamespace(orgK8sNs, orgSlug, 'org')
  const orgNamespaceId = await upsertNamespace(orgSlug, 'org')

  const orgRows = await sql`
    INSERT INTO organizations (namespace_id, display_name)
    VALUES (${orgNamespaceId}, 'Dev Organization')
    ON CONFLICT (namespace_id) DO NOTHING
    RETURNING id
  `
  let orgId
  if (orgRows.length) {
    orgId = orgRows[0].id
  } else {
    const [{ id }] = await sql`SELECT id FROM organizations WHERE namespace_id = ${orgNamespaceId}`
    orgId = id
  }
  console.log(`  org: Dev Organization (namespace: ${orgSlug})`)

  const orgOwner = DEV_ACCOUNTS[3]
  const orgMember = DEV_ACCOUNTS[4]

  await sql`
    INSERT INTO org_members (org_id, user_id, role)
    VALUES (${orgId}, ${orgOwner.id}, 'owner')
    ON CONFLICT DO NOTHING
  `
  console.log(`  org member: ${orgOwner.email} -> owner`)

  await sql`
    INSERT INTO org_members (org_id, user_id, role)
    VALUES (${orgId}, ${orgMember.id}, 'member')
    ON CONFLICT DO NOTHING
  `
  console.log(`  org member: ${orgMember.email} -> member`)

  console.log('Done.')
}

main()
  .catch(console.error)
  .finally(() => sql.end())
