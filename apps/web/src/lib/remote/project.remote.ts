import { db, projects, namespaces, organizations, orgMembers, users } from '$lib/server/db'
import type { Project, Namespace } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import { createPvc, deletePvc } from '$lib/server/k8s/pvc'
import { createPod, deletePod } from '$lib/server/k8s/pod'
import { createRouteAndService, deleteRouteAndService } from '$lib/server/k8s/route'
import { createNetworkPolicy, deleteNetworkPolicy } from '$lib/server/k8s/policy'
import { resolvePermissions, resolveIdleTimeout } from '$lib/server/permissions'

export async function createProject(
  actorUserId: string,
  namespaceId: string,
  slug: string,
  displayName: string,
): Promise<Project> {
  // Validate actor has access to create in this namespace
  await assertNamespaceAccess(actorUserId, namespaceId)

  // Validate slug is unique within the namespace
  const existing = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.namespaceId, namespaceId), eq(projects.slug, slug)))
    .limit(1)

  if (existing.length > 0) {
    throw error(409, 'A project with that slug already exists in this namespace')
  }

  // Get namespace to find k8s namespace
  const nsRows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.id, namespaceId))
    .limit(1)

  if (nsRows.length === 0) {
    throw error(404, 'Namespace not found')
  }

  const ns = nsRows[0]

  // Create the project record first (with a temporary PVC name) to get the ID
  const [project] = await db
    .insert(projects)
    .values({
      namespaceId,
      slug,
      displayName,
      status: 'stopped',
      k8sPvcName: 'pending', // placeholder; updated below
    })
    .returning()

  // Create PVC using the project ID
  let pvcName: string
  try {
    pvcName = await createPvc(ns.k8sNamespace, project.id)
  } catch (e) {
    // Roll back project insert
    await db.delete(projects).where(eq(projects.id, project.id))
    throw error(500, `Failed to create PVC: ${(e as Error).message}`)
  }

  // Update project with real PVC name
  const [updated] = await db
    .update(projects)
    .set({ k8sPvcName: pvcName })
    .where(eq(projects.id, project.id))
    .returning()

  return updated
}

export async function getProject(
  namespaceSlug: string,
  projectSlug: string,
): Promise<(Project & { namespace: Namespace }) | null> {
  const rows = await db
    .select({ project: projects, namespace: namespaces })
    .from(projects)
    .innerJoin(namespaces, eq(projects.namespaceId, namespaces.id))
    .where(and(eq(namespaces.slug, namespaceSlug), eq(projects.slug, projectSlug)))
    .limit(1)

  if (rows.length === 0) return null

  return { ...rows[0].project, namespace: rows[0].namespace }
}

export async function startProject(actorUserId: string, projectId: string): Promise<Project> {
  const project = await getProjectById(projectId)

  await assertProjectManage(actorUserId, projectId)

  if (project.status !== 'stopped') {
    throw error(409, `Project cannot be started from status '${project.status}'`)
  }

  const ns = await getNamespaceById(project.namespaceId)
  const idleTimeout = await resolveIdleTimeout(projectId)

  // Create pod, route, service, and network policy
  let podName: string
  let routeName: string

  try {
    await createNetworkPolicy(ns.k8sNamespace, projectId)
  } catch (e) {
    throw error(500, `Failed to create network policy: ${(e as Error).message}`)
  }

  try {
    podName = await createPod(ns.k8sNamespace, projectId, project.k8sPvcName, idleTimeout)
  } catch (e) {
    // Best-effort cleanup of network policy
    await deleteNetworkPolicy(ns.k8sNamespace, projectId).catch(() => {})
    throw error(500, `Failed to create pod: ${(e as Error).message}`)
  }

  try {
    const result = await createRouteAndService(ns.k8sNamespace, projectId, ns.slug, project.slug)
    routeName = result.routeName
  } catch (e) {
    // Best-effort cleanup
    await deletePod(ns.k8sNamespace, podName).catch(() => {})
    await deleteNetworkPolicy(ns.k8sNamespace, projectId).catch(() => {})
    throw error(500, `Failed to create route: ${(e as Error).message}`)
  }

  const [updated] = await db
    .update(projects)
    .set({
      status: 'starting',
      k8sPodName: podName,
      k8sRouteName: routeName,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning()

  return updated
}

export async function stopProject(actorUserId: string, projectId: string): Promise<Project> {
  const project = await getProjectById(projectId)

  await assertProjectManage(actorUserId, projectId)

  const ns = await getNamespaceById(project.namespaceId)

  // Delete pod and route (PVC is kept)
  if (project.k8sPodName) {
    await deletePod(ns.k8sNamespace, project.k8sPodName).catch(() => {})
  }

  if (project.k8sRouteName) {
    // Derive service name from projectId convention
    const svcName = `svc-${projectId}`
    await deleteRouteAndService(ns.k8sNamespace, project.k8sRouteName, svcName).catch(() => {})
  }

  await deleteNetworkPolicy(ns.k8sNamespace, projectId).catch(() => {})

  const [updated] = await db
    .update(projects)
    .set({
      status: 'stopped',
      k8sPodName: null,
      k8sRouteName: null,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning()

  return updated
}

export async function deleteProject(actorUserId: string, projectId: string): Promise<void> {
  const project = await getProjectById(projectId)

  await assertProjectManage(actorUserId, projectId)

  const ns = await getNamespaceById(project.namespaceId)

  // Stop running resources first
  if (project.status !== 'stopped') {
    if (project.k8sPodName) {
      await deletePod(ns.k8sNamespace, project.k8sPodName).catch(() => {})
    }
    if (project.k8sRouteName) {
      const svcName = `svc-${projectId}`
      await deleteRouteAndService(ns.k8sNamespace, project.k8sRouteName, svcName).catch(() => {})
    }
    await deleteNetworkPolicy(ns.k8sNamespace, projectId).catch(() => {})
  }

  // Delete PVC
  await deletePvc(ns.k8sNamespace, project.k8sPvcName).catch(() => {})

  // Delete project record (cascade will handle project_permissions and usage_samples)
  await db.delete(projects).where(eq(projects.id, projectId))
}

export async function updateProjectStatus(
  projectId: string,
  status: Project['status'],
): Promise<void> {
  await db
    .update(projects)
    .set({ status, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getProjectById(projectId: string): Promise<Project> {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (rows.length === 0) {
    throw error(404, 'Project not found')
  }

  return rows[0]
}

async function getNamespaceById(namespaceId: string): Promise<Namespace> {
  const rows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.id, namespaceId))
    .limit(1)

  if (rows.length === 0) {
    throw error(404, 'Namespace not found')
  }

  return rows[0]
}

async function assertProjectManage(userId: string, projectId: string): Promise<void> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (userRows.length === 0) throw error(403, 'Forbidden')

  const perms = await resolvePermissions(userRows[0], projectId)
  if (!perms.includes('project:manage')) {
    throw error(403, 'You do not have permission to manage this project')
  }
}

async function assertNamespaceAccess(userId: string, namespaceId: string): Promise<void> {
  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (userRows.length === 0) throw error(403, 'Forbidden')

  const user = userRows[0]

  const nsRows = await db
    .select()
    .from(namespaces)
    .where(eq(namespaces.id, namespaceId))
    .limit(1)

  if (nsRows.length === 0) throw error(404, 'Namespace not found')

  const ns = nsRows[0]

  // User owns their own namespace
  if (ns.type === 'user' && ns.id === user.namespaceId) return

  // Org namespace: user must be owner
  if (ns.type === 'org') {
    const orgRows = await db
      .select({ member: orgMembers })
      .from(organizations)
      .innerJoin(
        orgMembers,
        and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, userId)),
      )
      .where(eq(organizations.namespaceId, namespaceId))
      .limit(1)

    if (orgRows.length > 0 && orgRows[0].member.role === 'owner') return
  }

  throw error(403, 'You do not have permission to create projects in this namespace')
}
