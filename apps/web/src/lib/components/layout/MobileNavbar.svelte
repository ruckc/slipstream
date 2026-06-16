<script lang="ts">
  import { getContext } from 'svelte'
  import type { WorkspaceCtx } from '$lib/components/workspace/WorkspaceTypes.js'
  import { WORKSPACE_CTX } from '$lib/components/workspace/WorkspaceTypes.js'
  import Icon from '$lib/components/common/Icon.svelte'

  let { onToggleSidebar }: { onToggleSidebar?: () => void } = $props()

  const ctx = getContext<WorkspaceCtx>(WORKSPACE_CTX)

  let menuOpen = $state(false)
  let tabDropdownOpen = $state(false)
  let renamingPaneId = $state<string | null>(null)
  let renameValue = $state('')

  const activePane = $derived(ctx.getActivePane())
  const allPanes = $derived(ctx.getAllPanes())
  const activeIsTerminal = $derived(activePane?.kind === 'terminal')

  function toggleMenu() {
    menuOpen = !menuOpen
    tabDropdownOpen = false
  }

  function toggleTabDropdown() {
    tabDropdownOpen = !tabDropdownOpen
    menuOpen = false
  }

  function closeAll() {
    menuOpen = false
    tabDropdownOpen = false
  }

  function selectPane(paneId: string) {
    ctx.setActivePaneById(paneId)
    tabDropdownOpen = false
  }

  function closeCurrentTab() {
    if (!activePane) return
    ctx.closePane(ctx.getActiveGroupId(), activePane.id)
    menuOpen = false
  }

  function startRename() {
    if (!activePane) return
    renameValue = activePane.label
    renamingPaneId = activePane.id
    menuOpen = false
  }

  function commitRename() {
    if (!renamingPaneId || !activePane) return
    const trimmed = renameValue.trim()
    if (trimmed) activePane.label = trimmed
    renamingPaneId = null
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') commitRename()
    else if (e.key === 'Escape') renamingPaneId = null
  }

  function paneIcon(kind: string) {
    if (kind === 'terminal') return 'terminal'
    if (kind === 'pod-logs') return 'file-text'
    if (kind === 'pod-describe') return 'info'
    if (kind === 'processes') return 'play'
    return 'file'
  }
</script>

<!-- Close overlays on outside click -->
<svelte:window
  onclick={(e) => {
    const target = e.target as HTMLElement
    if (!target.closest('.mobile-navbar')) closeAll()
  }}
/>

<nav class="mobile-navbar" aria-label="Mobile workspace navigation">
  <!-- Hamburger -->
  <button
    class="nav-btn"
    type="button"
    aria-label="Menu"
    aria-expanded={menuOpen}
    onclick={(e) => {
      e.stopPropagation()
      toggleMenu()
    }}
  >
    <Icon name="ellipsis" size={18} />
  </button>

  <!-- Active tab selector -->
  <button
    class="tab-selector"
    type="button"
    aria-label="Switch tab"
    aria-expanded={tabDropdownOpen}
    onclick={(e) => {
      e.stopPropagation()
      toggleTabDropdown()
    }}
  >
    {#if activePane}
      <Icon name={paneIcon(activePane.kind)} size={14} />
      {#if renamingPaneId === activePane.id}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="rename-input"
          bind:value={renameValue}
          autofocus
          onblur={commitRename}
          onkeydown={handleRenameKeydown}
          onclick={(e) => e.stopPropagation()}
          aria-label="Rename tab"
          maxlength={64}
        />
      {:else}
        <span class="tab-label">{activePane.label}</span>
      {/if}
    {:else}
      <span class="tab-label tab-label--empty">No tabs open</span>
    {/if}
    <Icon name="chevron-down" size={12} />
  </button>

  <!-- Tab dropdown -->
  {#if tabDropdownOpen && allPanes.length > 0}
    <div class="dropdown tab-dropdown" role="listbox" aria-label="Open tabs">
      {#each allPanes as pane (pane.id)}
        <button
          class="dropdown-item"
          class:dropdown-item--active={pane.id === activePane?.id}
          type="button"
          role="option"
          aria-selected={pane.id === activePane?.id}
          onclick={(e) => {
            e.stopPropagation()
            selectPane(pane.id)
          }}
        >
          <Icon name={paneIcon(pane.kind)} size={14} />
          <span>{pane.label}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Hamburger menu -->
  {#if menuOpen}
    <div class="dropdown menu-dropdown" role="menu">
      <button
        class="dropdown-item"
        type="button"
        role="menuitem"
        onclick={(e) => {
          e.stopPropagation()
          onToggleSidebar?.()
          menuOpen = false
        }}
      >
        <Icon name="files" size={14} />
        <span>Toggle files</span>
      </button>

      {#if ctx.canShell}
        <button
          class="dropdown-item"
          type="button"
          role="menuitem"
          onclick={(e) => {
            e.stopPropagation()
            ctx.createTerminal()
            menuOpen = false
          }}
        >
          <Icon name="terminal" size={14} />
          <span>New terminal</span>
        </button>
      {/if}

      {#if ctx.canShell}
        <button
          class="dropdown-item"
          type="button"
          role="menuitem"
          onclick={(e) => {
            e.stopPropagation()
            ctx.openProcesses()
            menuOpen = false
          }}
        >
          <Icon name="play" size={14} />
          <span>Processes</span>
        </button>
      {/if}

      <button
        class="dropdown-item"
        type="button"
        role="menuitem"
        onclick={(e) => {
          e.stopPropagation()
          ctx.openRegistry()
          menuOpen = false
        }}
      >
        <Icon name="box" size={14} />
        <span>Registry</span>
      </button>

      <button
        class="dropdown-item"
        type="button"
        role="menuitem"
        onclick={(e) => {
          e.stopPropagation()
          ctx.openPodLogs()
          menuOpen = false
        }}
      >
        <Icon name="file-text" size={14} />
        <span>Pod logs</span>
      </button>

      <button
        class="dropdown-item"
        type="button"
        role="menuitem"
        onclick={(e) => {
          e.stopPropagation()
          ctx.openPodDescribe()
          menuOpen = false
        }}
      >
        <Icon name="info" size={14} />
        <span>Describe pod</span>
      </button>

      {#if activeIsTerminal && activePane}
        <div class="dropdown-divider" role="separator"></div>
        <button
          class="dropdown-item"
          type="button"
          role="menuitem"
          onclick={(e) => {
            e.stopPropagation()
            ctx.getTerminalActions(activePane.id)?.clear()
            menuOpen = false
          }}
        >
          <Icon name="trash" size={14} />
          <span>Clear terminal</span>
        </button>
        <button
          class="dropdown-item"
          type="button"
          role="menuitem"
          onclick={(e) => {
            e.stopPropagation()
            startRename()
          }}
        >
          <Icon name="edit" size={14} />
          <span>Rename</span>
        </button>
        <button
          class="dropdown-item dropdown-item--danger"
          type="button"
          role="menuitem"
          onclick={(e) => {
            e.stopPropagation()
            ctx.getTerminalActions(activePane.id)?.kill()
            menuOpen = false
          }}
        >
          <Icon name="stop" size={14} />
          <span>Kill session</span>
        </button>
      {/if}

      {#if activePane}
        <div class="dropdown-divider" role="separator"></div>
        <button
          class="dropdown-item dropdown-item--danger"
          type="button"
          role="menuitem"
          onclick={(e) => {
            e.stopPropagation()
            closeCurrentTab()
          }}
        >
          <Icon name="close" size={14} />
          <span>Close tab</span>
        </button>
      {/if}
    </div>
  {/if}
</nav>

<style>
  .mobile-navbar {
    display: flex;
    flex-direction: row;
    align-items: center;
    height: 44px;
    min-height: 44px;
    background: var(--color-bg-surface);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
    position: relative;
    z-index: 50;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    color: var(--color-text-muted);
    border-right: 1px solid var(--color-border-subtle);
  }
  .nav-btn:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-hover);
  }

  .tab-selector {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    height: 44px;
    padding: 0 var(--space-3);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    text-align: left;
  }
  .tab-selector:hover {
    background: var(--color-bg-hover);
  }

  .tab-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .tab-label--empty {
    color: var(--color-text-muted);
  }

  .rename-input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-sans);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    background: var(--color-bg-input);
    border: 1px solid var(--color-border-focus);
    border-radius: var(--radius-sm);
    padding: 2px var(--space-2);
    height: 28px;
  }

  .dropdown {
    position: absolute;
    top: 44px;
    left: 0;
    right: 0;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-top: none;
    z-index: 200;
    overflow-y: auto;
    max-height: 60dvh;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  }

  .tab-dropdown {
    left: 44px;
  }

  .menu-dropdown {
    right: unset;
    width: 220px;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    text-align: left;
  }
  .dropdown-item:hover {
    background: var(--color-bg-hover);
  }
  .dropdown-item--active {
    color: var(--color-accent);
    background: var(--color-bg-hover);
  }
  .dropdown-item--danger {
    color: var(--color-danger, #e53e3e);
  }

  .dropdown-divider {
    height: 1px;
    background: var(--color-border-subtle);
    margin: var(--space-1) 0;
  }
</style>
