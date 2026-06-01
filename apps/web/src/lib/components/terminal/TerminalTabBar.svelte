<script lang="ts">
  import TerminalTab from './TerminalTab.svelte'
  import Icon from '$lib/components/common/Icon.svelte'

  export interface TerminalSession {
    id: string
    label: string
  }

  let {
    sessions,
    activeSessionId = $bindable(null),
    onNewSession,
    onCloseSession,
  }: {
    sessions: TerminalSession[]
    activeSessionId?: string | null
    onNewSession: () => void
    onCloseSession: (id: string) => void
  } = $props()

  function handleActivate(id: string) {
    activeSessionId = id
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!sessions.length) return
    const idx = sessions.findIndex(s => s.id === activeSessionId)
    if (e.key === 'ArrowLeft' && idx > 0) {
      activeSessionId = sessions[idx - 1].id
    } else if (e.key === 'ArrowRight' && idx < sessions.length - 1) {
      activeSessionId = sessions[idx + 1].id
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tab-bar"
  role="tablist"
  aria-label="Terminal sessions"
  onkeydown={handleKeydown}
>
  {#each sessions as session (session.id)}
    <TerminalTab
      sessionId={session.id}
      label={session.label}
      active={session.id === activeSessionId}
      onActivate={handleActivate}
      onClose={onCloseSession}
    />
  {/each}
  <button
    class="new-session-btn"
    onclick={onNewSession}
    aria-label="New terminal session"
    title="New terminal"
  >
    <Icon name="add" size={14} />
  </button>
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: center;
    background: var(--color-tab-bg);
    border-bottom: 1px solid var(--color-border-subtle);
    overflow-x: auto;
    overflow-y: hidden;
    flex-shrink: 0;
    height: 35px;
    scrollbar-width: none;
  }

  .tab-bar::-webkit-scrollbar {
    display: none;
  }

  .new-session-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 35px;
    flex-shrink: 0;
    color: var(--color-text-muted);
    border-radius: 0;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .new-session-btn:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }
</style>
