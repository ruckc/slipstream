<script lang="ts">
  import Icon from '$lib/components/common/Icon.svelte'

  let {
    sessionId,
    label,
    active = false,
    onActivate,
    onClose,
  }: {
    sessionId: string
    label: string
    active?: boolean
    onActivate: (id: string) => void
    onClose: (id: string) => void
  } = $props()
</script>

<div
  class="terminal-tab"
  class:terminal-tab--active={active}
  role="tab"
  aria-selected={active}
  aria-controls="terminal-pane-{sessionId}"
  tabindex={active ? 0 : -1}
>
  <button class="terminal-tab-label" onclick={() => onActivate(sessionId)} title={label}>
    <Icon name="terminal" size={12} />
    <span class="terminal-tab-name">{label}</span>
  </button>
  <button
    class="terminal-tab-close"
    onclick={(e) => {
      e.stopPropagation()
      onClose(sessionId)
    }}
    aria-label="Close {label}"
    title="Close terminal"
  >
    <Icon name="close" size={10} />
  </button>
</div>

<style>
  .terminal-tab {
    display: flex;
    align-items: center;
    height: 35px;
    border-right: 1px solid var(--color-border-subtle);
    background: var(--color-tab-bg);
    color: var(--color-tab-fg);
    flex-shrink: 0;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
    max-width: 180px;
    min-width: 80px;
    position: relative;
  }

  .terminal-tab:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  .terminal-tab--active {
    background: var(--color-tab-active-bg);
    color: var(--color-tab-active-fg);
    border-bottom: 1px solid var(--color-tab-active-border);
  }

  .terminal-tab--active:hover {
    background: var(--color-tab-active-bg);
  }

  .terminal-tab-label {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-2) 0 var(--space-3);
    height: 100%;
    font-size: var(--font-size-sm);
    color: inherit;
    overflow: hidden;
    min-width: 0;
  }

  .terminal-tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .terminal-tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-right: var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-disabled);
    opacity: 0;
    transition:
      background var(--transition-fast),
      color var(--transition-fast),
      opacity var(--transition-fast);
    flex-shrink: 0;
  }

  .terminal-tab:hover .terminal-tab-close,
  .terminal-tab--active .terminal-tab-close {
    opacity: 1;
  }

  .terminal-tab-close:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }
</style>
