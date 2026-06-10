<script lang="ts">
  import { setContext } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import type {
    Group,
    Layout,
    PaneData,
    DropZone,
    WorkspaceCtx,
    TerminalActions,
  } from './WorkspaceTypes.js'
  import { WORKSPACE_CTX } from './WorkspaceTypes.js'
  import { podFetch } from '$lib/pod-fetch'
  import WorkspaceNode from './WorkspaceNode.svelte'
  import WorkspaceGroup from './WorkspaceGroup.svelte'
  import MobileNavbar from '$lib/components/layout/MobileNavbar.svelte'

  let {
    projectId,
    namespaceSlug,
    projectSlug,
    projectStatus,
    canShell,
    canReadFiles,
    onToggleSidebar,
  }: {
    projectId: string
    namespaceSlug: string
    projectSlug: string
    projectStatus: string
    canShell: boolean
    canReadFiles: boolean
    onToggleSidebar?: () => void
  } = $props()

  let isMobile = $state(false)
  $effect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    isMobile = mq.matches
    const handler = (e: MediaQueryListEvent) => {
      isMobile = e.matches
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  })

  // ── State ─────────────────────────────────────────────────────────────────

  const rootId: string = crypto.randomUUID()

  let groups = $state<Group[]>([{ id: rootId, panes: [], activeId: null }])
  let layout = $state<Layout>({ type: 'leaf', groupId: rootId })
  let activeGroupId = $state(rootId)

  // ── Helpers ────────────────────────────────────────────────────────────────

  function findGroup(id: string): Group | undefined {
    return groups.find((g) => g.id === id)
  }

  function getTargetGroup(): Group {
    return findGroup(activeGroupId) ?? groups[0]
  }

  // ── Public API (callable via bind:this) ────────────────────────────────────

  export function openFile(path: string) {
    if (!canReadFiles) return
    const label = path.split('/').pop() ?? path

    // Focus if already open
    for (const g of groups) {
      const existing = g.panes.find(
        (p) => p.kind === 'file' && (p as { path: string }).path === path
      )
      if (existing) {
        g.activeId = existing.id
        activeGroupId = g.id
        return
      }
    }

    const target = getTargetGroup()
    const id: string = crypto.randomUUID()
    const pane: PaneData = { kind: 'file', id, path, label, content: null, loading: true }
    target.panes = [...target.panes, pane]
    target.activeId = id
    activeGroupId = target.id

    loadFile(id, target.id, path)
  }

  async function loadFile(paneId: string, groupId: string, path: string) {
    try {
      const res = await podFetch(
        projectId,
        namespaceSlug,
        projectSlug,
        `/fs/read?path=${encodeURIComponent(path)}`
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const g = findGroup(groupId)
      if (!g) return
      g.panes = g.panes.map((p) =>
        p.id === paneId && p.kind === 'file'
          ? { ...p, content: new Uint8Array(buf), loading: false }
          : p
      )
    } catch {
      const g = findGroup(groupId)
      if (!g) return
      g.panes = g.panes.map((p) => (p.id === paneId ? { ...p, loading: false } : p))
    }
  }

  export async function openPodLogs() {
    const target = getTargetGroup()
    const existing = groups.flatMap((g) => g.panes).find((p) => p.kind === 'pod-logs')
    if (existing) {
      for (const g of groups) {
        if (g.panes.some((p) => p.id === existing.id)) {
          g.activeId = existing.id
          activeGroupId = g.id
        }
      }
      await fetchPodLogs(existing.id)
      return
    }
    const id: string = crypto.randomUUID()
    const pane = { kind: 'pod-logs' as const, id, label: 'Pod Logs', logs: null, loading: true }
    target.panes = [...target.panes, pane]
    target.activeId = id
    activeGroupId = target.id
    await fetchPodLogs(id)
  }

  export async function openPodDescribe() {
    const target = getTargetGroup()
    const existing = groups.flatMap((g) => g.panes).find((p) => p.kind === 'pod-describe')
    if (existing) {
      for (const g of groups) {
        if (g.panes.some((p) => p.id === existing.id)) {
          g.activeId = existing.id
          activeGroupId = g.id
        }
      }
      await fetchPodDescribe(existing.id)
      return
    }
    const id: string = crypto.randomUUID()
    const pane = {
      kind: 'pod-describe' as const,
      id,
      label: 'Describe Pod',
      pod: null,
      loading: true,
    }
    target.panes = [...target.panes, pane]
    target.activeId = id
    activeGroupId = target.id
    await fetchPodDescribe(id)
  }

  async function fetchPodLogs(paneId: string) {
    setPaneField(paneId, { loading: true })
    try {
      const res = await fetch(`/api/pods/${projectId}/logs`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { logs: string }
      setPaneField(paneId, { logs: data.logs, loading: false })
    } catch {
      setPaneField(paneId, { logs: null, loading: false })
    }
  }

  async function fetchPodDescribe(paneId: string) {
    setPaneField(paneId, { loading: true })
    try {
      const res = await fetch(`/api/pods/${projectId}/describe`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { pod: Record<string, unknown> | null }
      setPaneField(paneId, { pod: data.pod, loading: false })
    } catch {
      setPaneField(paneId, { pod: null, loading: false })
    }
  }

  function setPaneField(paneId: string, fields: Record<string, unknown>) {
    for (const g of groups) {
      const idx = g.panes.findIndex((p) => p.id === paneId)
      if (idx !== -1) {
        g.panes = g.panes.map((p, i) => (i === idx ? { ...p, ...fields } : p))
        return
      }
    }
  }

  export async function createTerminal() {
    if (!canShell) return
    const target = getTargetGroup()
    try {
      const res = await podFetch(projectId, namespaceSlug, projectSlug, '/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { session_id } = (await res.json()) as { session_id: string }

      const label = await resolveSessionLabel(session_id)

      const id: string = crypto.randomUUID()
      const pane: PaneData = { kind: 'terminal', id, sessionId: session_id, label }
      target.panes = [...target.panes, pane]
      target.activeId = id
      activeGroupId = target.id
    } catch {
      /* ignore */
    }
  }

  async function resolveSessionLabel(sessionId: string): Promise<string> {
    type SessionInfo = { session_id: string; process_name?: string }
    try {
      const res = await podFetch(projectId, namespaceSlug, projectSlug, '/sessions')
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { sessions: SessionInfo[] }
      const match = data.sessions.find((s) => s.session_id === sessionId)
      if (match?.process_name) return match.process_name
    } catch {
      /* fall through */
    }
    const count = groups.flatMap((g) => g.panes).filter((p) => p.kind === 'terminal').length + 1
    return `Terminal ${count}`
  }

  // ── Context operations ─────────────────────────────────────────────────────

  function closePane(groupId: string, paneId: string) {
    const g = findGroup(groupId)
    if (!g) return
    const pane = g.panes.find((p) => p.id === paneId)
    if (pane?.kind === 'terminal') {
      podFetch(projectId, namespaceSlug, projectSlug, `/sessions/${pane.sessionId}`, {
        method: 'DELETE',
      }).catch(() => {})
    }
    g.panes = g.panes.filter((p) => p.id !== paneId)
    if (g.activeId === paneId) g.activeId = g.panes[g.panes.length - 1]?.id ?? null
    pruneLayout()
  }

  function dropPane(paneId: string, fromGroupId: string, toGroupId: string, zone: DropZone) {
    if (fromGroupId === toGroupId && zone === 'center') return

    const fromGroup = findGroup(fromGroupId)
    if (!fromGroup) return
    const pane = fromGroup.panes.find((p) => p.id === paneId)
    if (!pane) return

    // Remove from source
    fromGroup.panes = fromGroup.panes.filter((p) => p.id !== paneId)
    if (fromGroup.activeId === paneId)
      fromGroup.activeId = fromGroup.panes[fromGroup.panes.length - 1]?.id ?? null

    if (zone === 'center') {
      const toGroup = findGroup(toGroupId)
      if (!toGroup) return
      toGroup.panes = [...toGroup.panes, pane]
      toGroup.activeId = pane.id
    } else {
      const newGroupId: string = crypto.randomUUID()
      const newGroup: Group = { id: newGroupId, panes: [pane], activeId: pane.id }
      groups = [...groups, newGroup]
      layout = doSplitLayout(layout, toGroupId, newGroupId, zone)
      activeGroupId = newGroupId
    }

    pruneLayout()
  }

  function pruneLayout() {
    const cleaned = cleanLayout(layout)
    if (!cleaned) {
      // All empty — reset
      const newId: string = crypto.randomUUID()
      groups = [{ id: newId, panes: [], activeId: null }]
      layout = { type: 'leaf', groupId: newId }
      activeGroupId = newId
    } else {
      layout = cleaned
    }
    // Remove orphaned groups
    const liveIds = collectGroupIds(layout)
    groups = groups.filter((g) => liveIds.has(g.id))
  }

  function collectGroupIds(node: Layout): Set<string> {
    if (node.type === 'leaf') return new Set([node.groupId])
    return node.children.reduce(
      (s, c) => (collectGroupIds(c).forEach((id) => s.add(id)), s),
      new Set<string>()
    )
  }

  function cleanLayout(node: Layout): Layout | null {
    if (node.type === 'leaf') {
      return (findGroup(node.groupId)?.panes.length ?? 0) > 0 ? node : null
    }
    const children: Layout[] = []
    const sizes: number[] = []
    for (let i = 0; i < node.children.length; i++) {
      const c = cleanLayout(node.children[i])
      if (c) {
        children.push(c)
        sizes.push(node.sizes[i] ?? 50)
      }
    }
    if (children.length === 0) return null
    if (children.length === 1) return children[0]
    const total = sizes.reduce((a, b) => a + b, 0)
    return { ...node, children, sizes: sizes.map((s) => (s / total) * 100) }
  }

  function doSplitLayout(
    node: Layout,
    targetGroupId: string,
    newGroupId: string,
    zone: Exclude<DropZone, 'center'>
  ): Layout {
    if (node.type === 'leaf') {
      if (node.groupId !== targetGroupId) return node
      const direction: 'h' | 'v' = zone === 'left' || zone === 'right' ? 'h' : 'v'
      const newFirst = zone === 'left' || zone === 'top'
      const newLeaf: Layout = { type: 'leaf', groupId: newGroupId }
      const children: Layout[] = newFirst ? [newLeaf, node] : [node, newLeaf]
      const splitId: string = crypto.randomUUID()
      return { type: 'split', id: splitId, direction, children, sizes: [50, 50] }
    }
    return {
      ...node,
      children: node.children.map((c) => doSplitLayout(c, targetGroupId, newGroupId, zone)),
    }
  }

  // ── Terminal actions registry ──────────────────────────────────────────────

  const terminalActionsMap = new SvelteMap<string, TerminalActions>()

  // ── Mobile flat group ──────────────────────────────────────────────────────

  const mobileGroup: Group = $derived.by(() => {
    const allPanes = groups.flatMap((g) => g.panes)
    const activeGroup = findGroup(activeGroupId) ?? groups[0]
    return {
      id: activeGroup?.id ?? rootId,
      panes: allPanes,
      activeId: activeGroup?.activeId ?? allPanes[0]?.id ?? null,
    }
  })

  // ── Context ────────────────────────────────────────────────────────────────

  const ctx: WorkspaceCtx = {
    get projectId() {
      return projectId
    },
    get namespaceSlug() {
      return namespaceSlug
    },
    get projectSlug() {
      return projectSlug
    },
    get canShell() {
      return canShell
    },
    getActiveGroupId: () => activeGroupId,
    setActiveGroupId: (id) => {
      activeGroupId = id
    },
    closePane,
    dropPane,
    refreshPodLogs: fetchPodLogs,
    refreshPodDescribe: fetchPodDescribe,
    createTerminal,
    openPodLogs,
    openPodDescribe,
    registerTerminalActions: (paneId, actions) => terminalActionsMap.set(paneId, actions),
    unregisterTerminalActions: (paneId) => terminalActionsMap.delete(paneId),
    getTerminalActions: (paneId) => terminalActionsMap.get(paneId),
    getAllPanes: () => groups.flatMap((g) => g.panes),
    getActivePane: () => {
      const g = findGroup(activeGroupId) ?? groups[0]
      return g?.panes.find((p) => p.id === g.activeId) ?? null
    },
    setActivePaneById: (paneId) => {
      for (const g of groups) {
        if (g.panes.some((p) => p.id === paneId)) {
          g.activeId = paneId
          activeGroupId = g.id
          return
        }
      }
    },
  }
  setContext(WORKSPACE_CTX, ctx)

  // ── Session hydration ──────────────────────────────────────────────────────

  let hydrated = false
  $effect(() => {
    if (projectStatus !== 'running' || !canShell || hydrated) return
    hydrated = true
    hydrateTerminals()
  })

  async function hydrateTerminals() {
    type SessionInfo = { session_id: string; created_at: string; process_name?: string }
    try {
      const res = await podFetch(projectId, namespaceSlug, projectSlug, '/sessions')
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { sessions: SessionInfo[] }
      const sessions = (data.sessions ?? []).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )
      if (sessions.length === 0) {
        await createTerminal()
        return
      }
      const target = getTargetGroup()
      for (const session of sessions) {
        const id: string = crypto.randomUUID()
        const count = groups.flatMap((g) => g.panes).filter((p) => p.kind === 'terminal').length + 1
        const label = session.process_name ?? `Terminal ${count}`
        const pane: PaneData = { kind: 'terminal', id, sessionId: session.session_id, label }
        target.panes = [...target.panes, pane]
        target.activeId = id
      }
      activeGroupId = target.id
    } catch {
      await createTerminal()
    }
  }
</script>

<div class="workspace-root">
  {#if isMobile}
    <MobileNavbar {onToggleSidebar} />
    <WorkspaceGroup group={mobileGroup} />
  {:else}
    <WorkspaceNode node={layout} {groups} />
  {/if}
</div>

<style>
  .workspace-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
</style>
