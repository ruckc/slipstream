<script lang="ts">
  import { getContext } from 'svelte'
  import type { Group, DropZone, WorkspaceCtx } from './WorkspaceTypes.js'
  import { WORKSPACE_CTX } from './WorkspaceTypes.js'
  import { workspaceDrag } from './workspaceDrag.svelte.js'
  import WorkspacePane from './WorkspacePane.svelte'
  import Icon from '$lib/components/common/Icon.svelte'
  import Tooltip from '$lib/components/common/Tooltip.svelte'

  let { group }: { group: Group } = $props()

  const ctx = getContext<WorkspaceCtx>(WORKSPACE_CTX)

  let el = $state<HTMLElement | undefined>(undefined)
  let dropZone = $state<DropZone | null>(null)
  let renamingPaneId = $state<string | null>(null)
  let renameValue = $state('')

  const activePane = $derived(group.panes.find((p) => p.id === group.activeId) ?? null)
  const activeIsTerminal = $derived(activePane?.kind === 'terminal')

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

  function startRename(paneId: string, currentLabel: string) {
    renameValue = currentLabel
    renamingPaneId = paneId
  }

  function commitRename() {
    if (!renamingPaneId) return
    const trimmed = renameValue.trim()
    if (trimmed) {
      const pane = group.panes.find((p) => p.id === renamingPaneId)
      if (pane) pane.label = trimmed
    }
    renamingPaneId = null
  }

  function cancelRename() {
    renamingPaneId = null
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitRename()
    else if (e.key === 'Escape') cancelRename()
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
  <div class="tab-bar">
    <!-- Scrollable tab list -->
    <div class="tab-list" role="tablist">
      {#each group.panes as pane (pane.id)}
        <div
          class="tab"
          class:tab--active={pane.id === group.activeId}
          role="tab"
          aria-selected={pane.id === group.activeId}
          draggable={renamingPaneId !== pane.id}
          tabindex="0"
          ondragstart={(e) => {
            if (renamingPaneId) return
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
          ondblclick={() => {
            group.activeId = pane.id
            ctx.setActiveGroupId(group.id)
            startRename(pane.id, pane.label)
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
          {:else if pane.kind === 'pod-logs'}
            <Icon name="file-text" size={12} />
          {:else if pane.kind === 'pod-describe'}
            <Icon name="info" size={12} />
          {:else}
            <Icon name="file" size={12} />
          {/if}

          {#if renamingPaneId === pane.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="tab-rename-input"
              bind:value={renameValue}
              autofocus
              onblur={commitRename}
              onkeydown={handleRenameKeydown}
              onclick={(e) => e.stopPropagation()}
              aria-label="Rename tab"
              maxlength={64}
            />
          {:else}
            <span class="tab-label">{pane.label}</span>
          {/if}

          <button
            class="tab-close"
            type="button"
            tabindex="-1"
            onclick={(e) => {
              e.stopPropagation()
              if (renamingPaneId === pane.id) renamingPaneId = null
              ctx.closePane(group.id, pane.id)
            }}
            aria-label="Close {pane.label}"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      {/each}
    </div>

    <!-- Pinned actions on the right -->
    <div class="tab-actions">
      {#if activeIsTerminal}
        <div class="tab-actions-divider"></div>
        <Tooltip text="Clear terminal" position="bottom" delay={300}>
          <button
            class="tab-action-btn"
            type="button"
            aria-label="Clear terminal"
            onclick={() => ctx.getTerminalActions(group.activeId!)?.clear()}
          >
            <Icon name="trash" size={13} />
          </button>
        </Tooltip>
        <Tooltip text="Rename" position="bottom" delay={300}>
          <button
            class="tab-action-btn"
            type="button"
            aria-label="Rename terminal"
            onclick={() => activePane && startRename(activePane.id, activePane.label)}
          >
            <Icon name="edit" size={13} />
          </button>
        </Tooltip>
        <Tooltip text="Kill session" position="bottom" delay={300}>
          <button
            class="tab-action-btn"
            type="button"
            aria-label="Kill session"
            onclick={() => ctx.getTerminalActions(group.activeId!)?.kill()}
          >
            <Icon name="stop" size={13} />
          </button>
        </Tooltip>
        <div class="tab-actions-divider"></div>
      {/if}

      {#if ctx.canShell}
        <Tooltip text="New terminal" position="bottom" delay={300}>
          <button
            class="tab-action-btn"
            type="button"
            aria-label="New terminal"
            onclick={() => ctx.createTerminal()}
          >
            <Icon name="terminal" size={13} />
          </button>
        </Tooltip>
      {/if}
      <Tooltip text="Pod logs" position="bottom" delay={300}>
        <button
          class="tab-action-btn"
          type="button"
          aria-label="Pod logs"
          onclick={() => ctx.openPodLogs()}
        >
          <Icon name="file-text" size={13} />
        </button>
      </Tooltip>
      <Tooltip text="Describe pod" position="bottom" delay={300}>
        <button
          class="tab-action-btn"
          type="button"
          aria-label="Describe pod"
          onclick={() => ctx.openPodDescribe()}
        >
          <Icon name="info" size={13} />
        </button>
      </Tooltip>
    </div>
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
    flex-shrink: 0;
    overflow: hidden;
  }

  .tab-list {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    min-width: 0;
  }
  .tab-list::-webkit-scrollbar {
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
  .tab-rename-input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-sans);
    font-size: var(--font-size-xs);
    color: var(--color-text-primary);
    background: var(--color-bg-input);
    border: 1px solid var(--color-border-focus);
    border-radius: var(--radius-sm);
    padding: 1px var(--space-1);
    height: 20px;
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

  /* Right-side action buttons */
  .tab-actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    border-left: 1px solid var(--color-border-subtle);
    padding: 0 var(--space-1);
    gap: 1px;
  }

  .tab-actions-divider {
    width: 1px;
    height: 16px;
    background: var(--color-border-subtle);
    margin: 0 var(--space-1);
    flex-shrink: 0;
  }

  .tab-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    transition:
      color var(--transition-fast),
      background var(--transition-fast);
  }
  .tab-action-btn:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-hover);
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
