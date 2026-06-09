<script lang="ts">
  import { setContext } from 'svelte'
  import type { Group, Layout, PaneData, DropZone, WorkspaceCtx } from './WorkspaceTypes.js'
  import { WORKSPACE_CTX } from './WorkspaceTypes.js'
  import { podFetch } from '$lib/pod-fetch'
  import WorkspaceNode from './WorkspaceNode.svelte'

  let {
    projectId,
    namespaceSlug,
    projectSlug,
    projectStatus,
    canShell,
    canReadFiles,
  }: {
    projectId: string
    namespaceSlug: string
    projectSlug: string
    projectStatus: string
    canShell: boolean
    canReadFiles: boolean
  } = $props()

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
      const data = (await res.json()) as { session_id: string }
      const id: string = crypto.randomUUID()
      const count = groups.flatMap((g) => g.panes).filter((p) => p.kind === 'terminal').length + 1
      const pane: PaneData = {
        kind: 'terminal',
        id,
        sessionId: data.session_id,
        label: `Terminal ${count}`,
      }
      target.panes = [...target.panes, pane]
      target.activeId = id
      activeGroupId = target.id
    } catch {
      /* ignore */
    }
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
    getActiveGroupId: () => activeGroupId,
    setActiveGroupId: (id) => {
      activeGroupId = id
    },
    closePane,
    dropPane,
  }
  setContext(WORKSPACE_CTX, ctx)

  // ── Auto terminal ──────────────────────────────────────────────────────────

  let autoCreated = false
  $effect(() => {
    if (projectStatus !== 'running' || !canShell || autoCreated) return
    if (groups.some((g) => g.panes.some((p) => p.kind === 'terminal'))) return
    autoCreated = true
    createTerminal()
  })
</script>

<div class="workspace-root">
  <WorkspaceNode node={layout} {groups} />
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
