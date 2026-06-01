<script lang="ts">
  import Icon from '$lib/components/common/Icon.svelte'

  let {
    id,
    label,
    icon,
    dirty = false,
    active,
    onActivate,
    onClose,
  }: {
    id: string
    label: string
    icon?: string
    dirty?: boolean
    active: boolean
    onActivate: (id: string) => void
    onClose: (id: string) => void
  } = $props()

  let hovered = $state(false)
</script>

<div
  class="editor-tab"
  class:editor-tab--active={active}
  role="tab"
  aria-selected={active}
  aria-label={label + (dirty ? ' (unsaved)' : '')}
  tabindex={active ? 0 : -1}
  onclick={() => onActivate(id)}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onActivate(id) }}
  onmouseenter={() => hovered = true}
  onmouseleave={() => hovered = false}
>
  {#if icon}
    <span class="editor-tab-icon">
      <Icon name={icon} size={14} />
    </span>
  {/if}

  <span class="editor-tab-label">{label}</span>

  <button
    class="editor-tab-close"
    class:editor-tab-close--dirty={dirty && !hovered}
    class:editor-tab-close--visible={hovered || dirty}
    onclick={(e) => { e.stopPropagation(); onClose(id) }}
    aria-label="Close {label}"
    type="button"
    tabindex={-1}
  >
    {#if dirty && !hovered}
      <span class="editor-tab-dirty-dot" aria-hidden="true">●</span>
    {:else}
      <Icon name="close" size={14} />
    {/if}
  </button>
</div>

<style>
  .editor-tab {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-3);
    height: 35px;
    cursor: pointer;
    white-space: nowrap;
    border-top: 1px solid transparent;
    border-right: 1px solid var(--color-border-subtle);
    background: var(--color-tab-bg);
    color: var(--color-tab-fg);
    font-size: var(--font-size-sm);
    position: relative;
    flex-shrink: 0;
    user-select: none;
    min-width: 0;
    max-width: 200px;
    transition: background var(--transition-fast), color var(--transition-fast);
  }

  .editor-tab:hover:not(.editor-tab--active) {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  .editor-tab--active {
    background: var(--color-tab-active-bg);
    color: var(--color-tab-active-fg);
    border-top-color: var(--color-tab-active-border);
  }

  .editor-tab-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--color-text-muted);
  }

  .editor-tab--active .editor-tab-icon {
    color: var(--color-text-primary);
  }

  .editor-tab-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .editor-tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    flex-shrink: 0;
    opacity: 0;
    transition: background var(--transition-fast), opacity var(--transition-fast);
    margin-left: var(--space-1);
  }

  .editor-tab-close--visible {
    opacity: 1;
  }

  .editor-tab-close:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  .editor-tab-dirty-dot {
    font-size: 10px;
    color: var(--color-text-muted);
    line-height: 1;
  }
</style>
