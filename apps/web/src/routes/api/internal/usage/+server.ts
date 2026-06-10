import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from '@sveltejs/kit'
import * as k8s from '@kubernetes/client-node'
import { getKubeConfig } from '$lib/server/k8s/client'
import { db, usageSamples, projects } from '$lib/server/db'
import { inArray } from 'drizzle-orm'

type SamplePayload = {
  projectId: string
  metric: string
  value: number
  sampledAt: string // ISO string
}

type RequestBody = {
  samples: SamplePayload[]
}

const VALID_METRICS = new Set([
  'cpu_seconds',
  'memory_byte_seconds',
  'disk_bytes',
  'ingress_bytes',
  'egress_bytes',
])

async function validateServiceAccountJwt(token: string): Promise<boolean> {
  try {
    const kc = getKubeConfig()
    const authApi = kc.makeApiClient(k8s.AuthenticationV1Api)
    const review = new k8s.V1TokenReview()
    review.spec = new k8s.V1TokenReviewSpec()
    review.spec.token = token
    const result = await authApi.createTokenReview({ body: review })
    return result.status?.authenticated === true
  } catch {
    return false
  }
}

export const POST: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw error(401, 'Missing authorization')
  }

  const token = authHeader.slice(7)
  const authenticated = await validateServiceAccountJwt(token)
  if (!authenticated) {
    throw error(403, 'Invalid token')
  }

  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch {
    throw error(400, 'Invalid JSON')
  }

  if (!Array.isArray(body.samples) || body.samples.length === 0) {
    throw error(400, 'samples must be a non-empty array')
  }

  // Validate all samples before any DB writes
  const projectIds = [...new Set(body.samples.map((s) => s.projectId))]
  const existingProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(inArray(projects.id, projectIds))
  const validProjectIds = new Set(existingProjects.map((p) => p.id))

  const rows = body.samples
    .filter((s) => {
      return (
        validProjectIds.has(s.projectId) &&
        VALID_METRICS.has(s.metric) &&
        typeof s.value === 'number' &&
        isFinite(s.value) &&
        s.sampledAt
      )
    })
    .map((s) => ({
      projectId: s.projectId,
      metric: s.metric,
      value: String(s.value),
      sampledAt: new Date(s.sampledAt),
    }))

  if (rows.length > 0) {
    await db.insert(usageSamples).values(rows)
  }

  return json({ inserted: rows.length })
}
