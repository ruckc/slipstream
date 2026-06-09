<script lang="ts">
  import type { Layout, Group } from './WorkspaceTypes.js'
  import WorkspaceGroup from './WorkspaceGroup.svelte'
  import WorkspaceNode from './WorkspaceNode.svelte'

  let { node, groups }: { node: Layout; groups: Group[] } = $props()

  function findGroup(id: string) {
    return groups.find((g) => g.id === id)
  }

  // Resize state
  let containerEl = $state<HTMLElement | undefined>(undefined)
  let resizing = false
  let resizeIdx = 0
  let resizeStartPos = 0
  let resizeStartSizes: number[] = []

  function onHandleDown(e: PointerEvent, idx: number) {
    if (node.type !== 'split') return
    e.preventDefault()
    resizing = true
    resizeIdx = idx
    resizeStartPos = node.direction === 'h' ? e.clientX : e.clientY
    resizeStartSizes = [...node.sizes]
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onContainerMove(e: PointerEvent) {
    if (!resizing || node.type !== 'split' || !containerEl) return
    const cur = node.direction === 'h' ? e.clientX : e.clientY
    const totalPx = node.direction === 'h' ? containerEl.clientWidth : containerEl.clientHeight
    const delta = ((cur - resizeStartPos) / totalPx) * 100
    const a = Math.max(4, resizeStartSizes[resizeIdx] + delta)
    const b = Math.max(4, resizeStartSizes[resizeIdx + 1] - delta)
    node.sizes[resizeIdx] = a
    node.sizes[resizeIdx + 1] = b
  }

  function onContainerUp() {
    resizing = false
  }
</script>

{#if node.type === 'leaf'}
  {@const group = findGroup(node.groupId)}
  {#if group}
    <WorkspaceGroup {group} />
  {/if}
{:else}
  <div
    class="ws-split ws-split--{node.direction}"
    role="group"
    bind:this={containerEl}
    onpointermove={onContainerMove}
    onpointerup={onContainerUp}
    onpointercancel={onContainerUp}
  >
    {#each node.children as child, i (child.type === 'leaf' ? child.groupId : child.id)}
      <div class="ws-split-child" style="flex: {node.sizes[i] ?? 1} 1 0%">
        <WorkspaceNode node={child} {groups} />
      </div>
      {#if i < node.children.length - 1}
        <div
          class="ws-split-handle ws-split-handle--{node.direction}"
          role="separator"
          onpointerdown={(e) => onHandleDown(e, i)}
        ></div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .ws-split {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .ws-split--h {
    flex-direction: row;
  }
  .ws-split--v {
    flex-direction: column;
  }

  .ws-split-child {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .ws-split-handle {
    flex-shrink: 0;
    background: var(--color-border-subtle);
    transition: background var(--transition-fast);
    z-index: 10;
  }
  .ws-split-handle:hover {
    background: var(--color-accent);
  }
  .ws-split-handle--h {
    width: 4px;
    cursor: col-resize;
    height: 100%;
  }
  .ws-split-handle--v {
    height: 4px;
    cursor: row-resize;
    width: 100%;
  }
</style>
