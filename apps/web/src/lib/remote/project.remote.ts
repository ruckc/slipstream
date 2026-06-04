import { query, command } from '$app/server'
import { db, projects, namespaces, organizations, orgMembers, users } from '$lib/server/db'
import type { Project, Namespace } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import { createPvc, deletePvc } from '$lib/server/k8s/pvc'
import { createDeployment, scaleDeployment, deleteDeployment } from '$lib/server/k8s/deployment'
import { createRouteAndService, deleteRouteAndService } from '$lib/server/k8s/route'
import { createNetworkPolicy, deleteNetworkPolicy } from '$lib/server/k8s/policy'
import { resolvePermissions, resolveIdleTimeout } from '$lib/server/permissions'
import { logServerError } from '$lib/server/error-log'

async function getProjectById(projectId: string): Promise<Project> {
  const rows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (rows.length === 0) throw error(404, 'Project not found')
  return rows[0]
}

async function getNamespaceById(namespaceId: string): Promise<Namespace> {
  const rows = await db.select().from(namespaces).where(eq(namespaces.id, namespaceId)).limit(1)
  if (rows.length === 0) throw error(404, 'Namespace not found')
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

  const nsRows = await db.select().from(namespaces).where(eq(namespaces.id, namespaceId)).limit(1)
  if (nsRows.length === 0) throw error(404, 'Namespace not found')
  const ns = nsRows[0]

  if (ns.type === 'user' && ns.id === user.namespaceId) return

  if (ns.type === 'org') {
    const orgRows = await db
      .select({ member: orgMembers })
      .from(organizations)
      .innerJoin(
        orgMembers,
        and(eq(orgMembers.orgId, organizations.id), eq(orgMembers.userId, userId))
      )
      .where(eq(organizations.namespaceId, namespaceId))
      .limit(1)
    if (orgRows.length > 0 && orgRows[0].member.role === 'owner') return
  }

  throw error(403, 'You do not have permission to create projects in this namespace')
}

export const createProject = command(
  'unchecked',
  async (arg: {
    actorUserId: string
    namespaceId: string
    slug: string
    displayName: string
  }): Promise<Project> => {
    await assertNamespaceAccess(arg.actorUserId, arg.namespaceId)

    const existing = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.namespaceId, arg.namespaceId), eq(projects.slug, arg.slug)))
      .limit(1)
    if (existing.length > 0)
      throw error(409, 'A project with that slug already exists in this namespace')

    const nsRows = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.id, arg.namespaceId))
      .limit(1)
    if (nsRows.length === 0) throw error(404, 'Namespace not found')
    const ns = nsRows[0]

    const [project] = await db
      .insert(projects)
      .values({
        namespaceId: arg.namespaceId,
        slug: arg.slug,
        displayName: arg.displayName,
        status: 'stopped',
        k8sPvcName: 'pending',
      })
      .returning()

    const idleTimeout = await resolveIdleTimeout(project.id)

    // Create PVC
    let pvcName: string
    try {
      pvcName = await createPvc(ns.k8sNamespace, project.id)
    } catch (e) {
      await db.delete(projects).where(eq(projects.id, project.id))
      await logServerError((e as Error).message, {
        route: 'createProject/createPvc',
        stack: (e as Error).stack,
        context: { projectId: project.id, k8sNamespace: ns.k8sNamespace },
      })
      throw error(500, 'Failed to provision storage for project')
    }

    await db.update(projects).set({ k8sPvcName: pvcName }).where(eq(projects.id, project.id))

    // Create NetworkPolicy (permanent)
    try {
      await createNetworkPolicy(ns.k8sNamespace, project.id)
    } catch (e) {
      await deletePvc(ns.k8sNamespace, pvcName).catch(() => {})
      await db.delete(projects).where(eq(projects.id, project.id))
      await logServerError((e as Error).message, {
        route: 'createProject/createNetworkPolicy',
        stack: (e as Error).stack,
        context: { projectId: project.id, k8sNamespace: ns.k8sNamespace },
      })
      throw error(500, 'Failed to configure network policy for project')
    }

    // Create Deployment at replicas=0 (permanent)
    try {
      await createDeployment(ns.k8sNamespace, project.id, pvcName, idleTimeout)
    } catch (e) {
      await deleteNetworkPolicy(ns.k8sNamespace, project.id).catch(() => {})
      await deletePvc(ns.k8sNamespace, pvcName).catch(() => {})
      await db.delete(projects).where(eq(projects.id, project.id))
      await logServerError((e as Error).message, {
        route: 'createProject/createDeployment',
        stack: (e as Error).stack,
        context: { projectId: project.id, k8sNamespace: ns.k8sNamespace },
      })
      throw error(500, 'Failed to create project deployment')
    }

    // Create Service + HTTPRoute (permanent)
    try {
      await createRouteAndService(ns.k8sNamespace, project.id, ns.slug, arg.slug)
    } catch (e) {
      await deleteDeployment(ns.k8sNamespace, project.id).catch(() => {})
      await deleteNetworkPolicy(ns.k8sNamespace, project.id).catch(() => {})
      await deletePvc(ns.k8sNamespace, pvcName).catch(() => {})
      await db.delete(projects).where(eq(projects.id, project.id))
      await logServerError((e as Error).message, {
        route: 'createProject/createRouteAndService',
        stack: (e as Error).stack,
        context: { projectId: project.id, k8sNamespace: ns.k8sNamespace },
      })
      throw error(500, 'Failed to configure routing for project')
    }

    const [updated] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
    return updated
  }
)

export const getProject = query(
  'unchecked',
  async (arg: {
    namespaceSlug: string
    projectSlug: string
  }): Promise<(Project & { namespace: Namespace }) | null> => {
    const rows = await db
      .select({ project: projects, namespace: namespaces })
      .from(projects)
      .innerJoin(namespaces, eq(projects.namespaceId, namespaces.id))
      .where(and(eq(namespaces.slug, arg.namespaceSlug), eq(projects.slug, arg.projectSlug)))
      .limit(1)
    if (rows.length === 0) return null
    return { ...rows[0].project, namespace: rows[0].namespace }
  }
)

export const startProject = command(
  'unchecked',
  async (arg: { actorUserId: string; projectId: string }): Promise<Project> => {
    const project = await getProjectById(arg.projectId)
    await assertProjectManage(arg.actorUserId, arg.projectId)

    // Already starting or running — idempotent no-op
    if (project.status === 'starting' || project.status === 'running') {
      return project
    }

    if (project.status !== 'stopped') {
      throw error(409, `Project cannot be started from status '${project.status}'`)
    }

    const ns = await getNamespaceById(project.namespaceId)

    try {
      await scaleDeployment(ns.k8sNamespace, arg.projectId, 1)
    } catch (e) {
      await logServerError((e as Error).message, {
        route: 'startProject/scaleDeployment',
        stack: (e as Error).stack,
        context: { projectId: arg.projectId, k8sNamespace: ns.k8sNamespace },
      })
      throw error(500, 'Failed to start project')
    }

    const [updated] = await db
      .update(projects)
      .set({ status: 'starting', updatedAt: new Date() })
      .where(eq(projects.id, arg.projectId))
      .returning()
    return updated
  }
)

export const stopProject = command(
  'unchecked',
  async (arg: { actorUserId: string; projectId: string }): Promise<Project> => {
    const project = await getProjectById(arg.projectId)
    await assertProjectManage(arg.actorUserId, arg.projectId)

    const ns = await getNamespaceById(project.namespaceId)

    await scaleDeployment(ns.k8sNamespace, arg.projectId, 0).catch(() => {})

    const [updated] = await db
      .update(projects)
      .set({ status: 'stopped', updatedAt: new Date() })
      .where(eq(projects.id, arg.projectId))
      .returning()
    return updated
  }
)

export const deleteProject = command(
  'unchecked',
  async (arg: { actorUserId: string; projectId: string }): Promise<void> => {
    const project = await getProjectById(arg.projectId)
    await assertProjectManage(arg.actorUserId, arg.projectId)

    const ns = await getNamespaceById(project.namespaceId)

    await Promise.allSettled([
      deleteDeployment(ns.k8sNamespace, arg.projectId),
      deleteRouteAndService(ns.k8sNamespace, arg.projectId),
      deleteNetworkPolicy(ns.k8sNamespace, arg.projectId),
      deletePvc(ns.k8sNamespace, project.k8sPvcName),
    ])

    await db.delete(projects).where(eq(projects.id, arg.projectId))
  }
)

export const updateProjectStatus = command(
  'unchecked',
  async (arg: { projectId: string; status: Project['status'] }): Promise<void> => {
    await db
      .update(projects)
      .set({ status: arg.status, updatedAt: new Date() })
      .where(eq(projects.id, arg.projectId))
  }
)
