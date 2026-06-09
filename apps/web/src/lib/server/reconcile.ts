import { db, projects } from '$lib/server/db'
import { inArray } from 'drizzle-orm'
import { listDeploymentStatuses, scaleDeployment } from '$lib/server/k8s/deployment'
import { projectK8sNamespace } from '$lib/server/k8s/namespace'
import { queryMetricByProject } from '$lib/server/victoriametrics'
import { resolveIdleTimeout } from '$lib/server/permissions'

const INTERVAL_MS = 60_000

async function runOnce(): Promise<void> {
  // Skip entirely if VictoriaMetrics isn't configured — no metrics to act on.
  if (!process.env.METRICS_PUSH_URL) return

  const [statuses, lastActivityMap] = await Promise.all([
    listDeploymentStatuses(),
    queryMetricByProject('slipstream_last_activity_at'),
  ])

  // Only consider deployments that are starting or running — stopped ones have
  // replicas=0 already.
  const activeProjectIds = [...statuses.entries()]
    .filter(([, s]) => s === 'starting' || s === 'running')
    .map(([id]) => id)

  if (activeProjectIds.length === 0) return

  // Load project info for all active projects in one query.
  const rows = await db
    .select({ project: projects })
    .from(projects)
    .where(inArray(projects.id, activeProjectIds))

  const now = Date.now() / 1000 // Unix seconds

  await Promise.all(
    rows.map(async ({ project }) => {
      const lastActivity = lastActivityMap.get(project.id)
      // No metric yet means the agent hasn't pushed one — don't touch it.
      if (lastActivity === undefined) return

      const idleTimeout = await resolveIdleTimeout(project.id)
      if (now - lastActivity < idleTimeout) return

      try {
        await scaleDeployment(projectK8sNamespace(project.id), project.id, 0)
      } catch (e) {
        console.error(`reconcile: failed to scale down ${project.id}`, e)
      }
    })
  )
}

export function startReconciler(): void {
  if (!process.env.METRICS_PUSH_URL) return

  setInterval(() => {
    runOnce().catch((e) => {
      console.error('reconciler error', e)
    })
  }, INTERVAL_MS)
}
