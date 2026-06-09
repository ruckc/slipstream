import { query, command, getRequestEvent } from '$app/server'
import { db, projects, namespaces, organizations, orgMembers, users } from '$lib/server/db'
import type { Project, Namespace } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import * as v from 'valibot'
import { ensurePvc } from '$lib/server/k8s/pvc'
import { ensureDeployment, scaleDeployment, getDeploymentStatus } from '$lib/server/k8s/deployment'
import { ensureRouteAndService } from '$lib/server/k8s/route'
import { ensureNetworkPolicy } from '$lib/server/k8s/policy'
import {
  resolveEgressPolicy,
  ensureCiliumEgressPolicy,
  deleteCiliumEgressPolicy,
} from '$lib/server/k8s/cilium-policy'
import {
  projectK8sNamespace,
  ensureProjectNamespace,
  deleteProjectNamespace,
} from '$lib/server/k8s/namespace'
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
  v.object({
    actorUserId: v.string(),
    namespaceId: v.string(),
    slug: v.string(),
    displayName: v.string(),
  }),
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
        k8sPvcName: 'pending',
      })
      .returning()

    const idleTimeout = await resolveIdleTimeout(project.id)
    const k8sNs = projectK8sNamespace(project.id)

    try {
      await ensureProjectNamespace(project.id, ns.id, ns.slug, ns.type as 'user' | 'org')
      const pvcName = await ensurePvc(k8sNs, project.id)
      await db.update(projects).set({ k8sPvcName: pvcName }).where(eq(projects.id, project.id))
      const egressPolicy = await resolveEgressPolicy(ns.id, project.id)
      await ensureNetworkPolicy(k8sNs, project.id, egressPolicy.enabled)
      await ensureCiliumEgressPolicy(k8sNs, project.id, egressPolicy)
      await ensureDeployment(k8sNs, project.id, arg.slug, pvcName, idleTimeout, ns.slug)
      await ensureRouteAndService(k8sNs, project.id, ns.slug, arg.slug)
    } catch (e) {
      await Promise.allSettled([
        deleteProjectNamespace(project.id),
        db.delete(projects).where(eq(projects.id, project.id)),
      ])
      const body = (e as { body?: unknown }).body
      const msg = body ? JSON.stringify(body) : (e as Error).message
      await logServerError(msg, {
        route: 'createProject/provision',
        stack: (e as Error).stack,
        context: { projectId: project.id, k8sNamespace: k8sNs },
      })
      throw error(500, 'Failed to provision project resources')
    }

    const [updated] = await db.select().from(projects).where(eq(projects.id, project.id)).limit(1)
    return updated
  }
)

export const getProject = query(
  v.object({ namespaceSlug: v.string(), projectSlug: v.string() }),
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
  v.object({ projectId: v.string() }),
  async (arg: { projectId: string }): Promise<void> => {
    const { locals } = getRequestEvent()
    if (!locals.user) throw error(401, 'Unauthorized')
    const project = await getProjectById(arg.projectId)
    await assertProjectManage(locals.user.id, arg.projectId)

    const ns = await getNamespaceById(project.namespaceId)
    const k8sNs = projectK8sNamespace(arg.projectId)

    // Idempotent — already scaling or running
    const currentStatus = await getDeploymentStatus(k8sNs, arg.projectId)
    if (currentStatus !== 'stopped') return

    const idleTimeout = await resolveIdleTimeout(arg.projectId)

    try {
      await ensureProjectNamespace(arg.projectId, ns.id, ns.slug, ns.type as 'user' | 'org')
      const egressPolicy = await resolveEgressPolicy(ns.id, arg.projectId)
      await ensureNetworkPolicy(k8sNs, arg.projectId, egressPolicy.enabled)
      await ensureCiliumEgressPolicy(k8sNs, arg.projectId, egressPolicy)
      await ensureDeployment(
        k8sNs,
        arg.projectId,
        project.slug,
        project.k8sPvcName,
        idleTimeout,
        ns.slug
      )
      await ensureRouteAndService(k8sNs, arg.projectId, ns.slug, project.slug)
      await scaleDeployment(k8sNs, arg.projectId, 1)
    } catch (e) {
      const body = (e as { body?: unknown }).body
      const msg = body ? JSON.stringify(body) : (e as Error).message
      await logServerError(msg, {
        route: 'startProject/provision',
        stack: (e as Error).stack,
        context: { projectId: arg.projectId, k8sNamespace: k8sNs },
      })
      throw error(500, 'Failed to start project')
    }
  }
)

export const deleteProject = command(
  v.object({ actorUserId: v.string(), projectId: v.string() }),
  async (arg: { actorUserId: string; projectId: string }): Promise<void> => {
    await getProjectById(arg.projectId)
    await assertProjectManage(arg.actorUserId, arg.projectId)

    // Namespace deletion cascades all resources including the CNP, but explicitly
    // clean up in case the namespace is already gone.
    const k8sNs = projectK8sNamespace(arg.projectId)
    await Promise.allSettled([
      deleteProjectNamespace(arg.projectId),
      deleteCiliumEgressPolicy(k8sNs, arg.projectId),
    ])

    await db.delete(projects).where(eq(projects.id, arg.projectId))
  }
)
