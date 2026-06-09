<script lang="ts">
  import { getContext } from 'svelte'
  import type { Group, DropZone, WorkspaceCtx } from './WorkspaceTypes.js'
  import { WORKSPACE_CTX } from './WorkspaceTypes.js'
  import { workspaceDrag } from './workspaceDrag.svelte.js'
  import WorkspacePane from './WorkspacePane.svelte'
  import Icon from '$lib/components/common/Icon.svelte'

  let { group }: { group: Group } = $props()

  const ctx = getContext<WorkspaceCtx>(WORKSPACE_CTX)

  let el = $state<HTMLElement | undefined>(undefined)
  let dropZone = $state<DropZone | null>(null)

  function computeZone(e: DragEvent): DropZone {
    if (!el) return 'center'
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const edge = 80
    if (x < edge) return 'left'
    if (x > r.width - edge) return 'right'
    if (y < edge) return 'top'
    if (y > r.height - edge) return 'bottom'
    return 'center'
  }
</script>

<div
  class="workspace-group"
  role="region"
  aria-label="Editor group"
  bind:this={el}
  ondragover={(e) => {
    if (!workspaceDrag.dragging) return
    e.preventDefault()
    dropZone = computeZone(e)
  }}
  ondragleave={() => {
    dropZone = null
  }}
  ondrop={(e) => {
    e.preventDefault()
    if (!workspaceDrag.dragging || !dropZone) return
    const { paneId, groupId } = workspaceDrag.dragging
    ctx.dropPane(paneId, groupId, group.id, dropZone)
    dropZone = null
    workspaceDrag.end()
  }}
>
  <!-- Tab bar -->
  <div class="tab-bar" role="tablist">
    {#each group.panes as pane (pane.id)}
      <div
        class="tab"
        class:tab--active={pane.id === group.activeId}
        role="tab"
        aria-selected={pane.id === group.activeId}
        draggable="true"
        tabindex="0"
        ondragstart={(e) => {
          e.dataTransfer?.setData('text/plain', pane.id)
          workspaceDrag.start(pane.id, group.id)
        }}
        ondragend={() => {
          workspaceDrag.end()
          dropZone = null
        }}
        onclick={() => {
          group.activeId = pane.id
          ctx.setActiveGroupId(group.id)
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            group.activeId = pane.id
            ctx.setActiveGroupId(group.id)
          }
        }}
      >
        {#if pane.kind === 'terminal'}
          <Icon name="terminal" size={12} />
        {:else}
          <Icon name="file" size={12} />
        {/if}
        <span class="tab-label">{pane.label}</span>
        <button
          class="tab-close"
          type="button"
          tabindex="-1"
          onclick={(e) => {
            e.stopPropagation()
            ctx.closePane(group.id, pane.id)
          }}
          aria-label="Close {pane.label}"
        >
          <Icon name="close" size={12} />
        </button>
      </div>
    {/each}
  </div>

  <!-- Content -->
  <div class="group-content">
    {#if group.panes.length === 0}
      <div class="group-empty">
        <p>No tabs open</p>
      </div>
    {:else}
      {#each group.panes as pane (pane.id)}
        <WorkspacePane {pane} active={pane.id === group.activeId} />
      {/each}
    {/if}
  </div>

  <!-- Drop overlay -->
  {#if workspaceDrag.dragging && dropZone}
    <div class="drop-indicator drop-indicator--{dropZone}" aria-hidden="true"></div>
  {/if}
</div>

<style>
  .workspace-group {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
    background: var(--color-bg-base);
  }

  .tab-bar {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    height: 35px;
    min-height: 35px;
    background: var(--color-bg-surface);
    border-bottom: 1px solid var(--color-border);
    overflow-x: auto;
    overflow-y: hidden;
    flex-shrink: 0;
    scrollbar-width: none;
  }
  .tab-bar::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2) 0 var(--space-3);
    height: 100%;
    min-width: 80px;
    max-width: 180px;
    cursor: pointer;
    flex-shrink: 0;
    border-right: 1px solid var(--color-border-subtle);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    user-select: none;
    background: transparent;
    position: relative;
  }
  .tab:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-hover);
  }
  .tab--active {
    color: var(--color-text-primary);
    background: var(--color-bg-base);
    border-bottom: 2px solid var(--color-accent);
  }
  .tab-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-sm);
    opacity: 0;
    flex-shrink: 0;
    color: var(--color-text-muted);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .tab:hover .tab-close,
  .tab--active .tab-close {
    opacity: 1;
  }
  .tab-close:hover {
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
  }

  .group-content {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }
  .group-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }
  .group-empty p {
    margin: 0;
  }

  /* Drop zone indicators */
  .drop-indicator {
    position: absolute;
    z-index: 50;
    background: var(--color-accent);
    opacity: 0.25;
    pointer-events: none;
    border: 2px solid var(--color-accent);
  }
  .drop-indicator--center {
    inset: 0;
  }
  .drop-indicator--left {
    top: 0;
    bottom: 0;
    left: 0;
    width: 40%;
  }
  .drop-indicator--right {
    top: 0;
    bottom: 0;
    right: 0;
    width: 40%;
  }
  .drop-indicator--top {
    left: 0;
    right: 0;
    top: 0;
    height: 40%;
  }
  .drop-indicator--bottom {
    left: 0;
    right: 0;
    bottom: 0;
    height: 40%;
  }
</style>
