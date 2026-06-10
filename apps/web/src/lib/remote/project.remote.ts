import { query, command, getRequestEvent } from '$app/server'
import { db, projects, namespaces, organizations, orgMembers, users } from '$lib/server/db'
import type { Project, Namespace } from '$lib/server/db'
import { eq, and } from 'drizzle-orm'
import { error } from '@sveltejs/kit'
import * as v from 'valibot'
import {
  createProjectEnvironment,
  getProjectEnvironment,
  patchProjectEnvironmentSpec,
  deleteProjectEnvironment,
  phaseToProjectStatus,
  resolvedEgressToSpec,
} from '$lib/server/k8s/cr'
import { resolveEgressPolicy } from '$lib/server/k8s/egress'
import { resolvePermissions, resolveIdleTimeout } from '$lib/server/permissions'
import { logServerError } from '$lib/server/error-log'

async function getProjectById(projectId: string): Promise<Project> {
  const rows = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (rows.length === 0) throw error(404, 'Project not found')
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
        k8sPvcName: 'managed-by-controller',
      })
      .returning()

    const [idleTimeout, egressPolicy] = await Promise.all([
      resolveIdleTimeout(project.id),
      resolveEgressPolicy(ns.id, project.id),
    ])

    try {
      await createProjectEnvironment({
        projectId: project.id,
        namespaceId: ns.id,
        namespaceSlug: ns.slug,
        projectSlug: arg.slug,
        desiredState: 'stopped',
        idleTimeoutSeconds: idleTimeout,
        retainStorage: true,
        egressPolicy: resolvedEgressToSpec(egressPolicy),
      })
    } catch (e) {
      await db.delete(projects).where(eq(projects.id, project.id))
      const msg = (e as Error).message
      await logServerError(msg, {
        route: 'createProject/provision',
        stack: (e as Error).stack,
        context: { projectId: project.id },
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

export const getProjectStatus = query(
  v.object({ projectId: v.string() }),
  async (arg: { projectId: string }): Promise<'stopped' | 'starting' | 'running'> => {
    const cr = await getProjectEnvironment(arg.projectId)
    return phaseToProjectStatus(cr?.status?.phase)
  }
)

export const getProjectPodIP = query(
  v.object({ projectId: v.string() }),
  async (arg: { projectId: string }): Promise<string | null> => {
    const cr = await getProjectEnvironment(arg.projectId)
    return cr?.status?.podIP ?? null
  }
)

export const startProject = command(
  v.object({ projectId: v.string() }),
  async (arg: { projectId: string }): Promise<void> => {
    const { locals } = getRequestEvent()
    if (!locals.user) throw error(401, 'Unauthorized')
    await getProjectById(arg.projectId)
    await assertProjectManage(locals.user.id, arg.projectId)

    const cr = await getProjectEnvironment(arg.projectId)
    if (!cr) throw error(404, 'Project environment not found')
    if (cr.spec.desiredState === 'running') return

    try {
      await patchProjectEnvironmentSpec(arg.projectId, { desiredState: 'running' })
    } catch (e) {
      const msg = (e as Error).message
      await logServerError(msg, {
        route: 'startProject',
        stack: (e as Error).stack,
        context: { projectId: arg.projectId },
      })
      throw error(500, 'Failed to start project')
    }
  }
)

export const stopProject = command(
  v.object({ projectId: v.string() }),
  async (arg: { projectId: string }): Promise<void> => {
    const { locals } = getRequestEvent()
    if (!locals.user) throw error(401, 'Unauthorized')
    await getProjectById(arg.projectId)
    await assertProjectManage(locals.user.id, arg.projectId)

    try {
      await patchProjectEnvironmentSpec(arg.projectId, { desiredState: 'stopped' })
    } catch (e) {
      const msg = (e as Error).message
      await logServerError(msg, {
        route: 'stopProject',
        stack: (e as Error).stack,
        context: { projectId: arg.projectId },
      })
      throw error(500, 'Failed to stop project')
    }
  }
)

export const deleteProject = command(
  v.object({ actorUserId: v.string(), projectId: v.string() }),
  async (arg: { actorUserId: string; projectId: string }): Promise<void> => {
    await getProjectById(arg.projectId)
    await assertProjectManage(arg.actorUserId, arg.projectId)

    await deleteProjectEnvironment(arg.projectId)
    await db.delete(projects).where(eq(projects.id, arg.projectId))
  }
)
