<script lang="ts">
  export interface ContextMenuItem {
    label: string
    icon?: string
    action: () => void
    disabled?: boolean
    separator?: boolean
  }

  import { untrack } from 'svelte'
  import Icon from './Icon.svelte'

  let {
    items,
    x,
    y,
    open = $bindable(false),
  }: {
    items: ContextMenuItem[]
    x: number
    y: number
    open?: boolean
  } = $props()

  let menuEl = $state<HTMLElement | null>(null)
  let focusedIndex = $state(-1)

  // Adjusted position to keep menu in viewport — initialized with untrack to avoid
  // capturing the reactive prop; the $effect below sets real values once the menu mounts.
  let adjustedX = $state(untrack(() => x))
  let adjustedY = $state(untrack(() => y))

  $effect(() => {
    if (open && menuEl) {
      const rect = menuEl.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      adjustedX = x + rect.width > vw ? Math.max(0, vw - rect.width - 4) : x
      adjustedY = y + rect.height > vh ? Math.max(0, vh - rect.height - 4) : y
    }
  })

  $effect(() => {
    if (!open) {
      focusedIndex = -1
      return
    }

    function onClickOutside(e: MouseEvent) {
      if (menuEl && !menuEl.contains(e.target as Node)) {
        open = false
      }
    }

    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        open = false
        return
      }
      const selectableItems = items.filter((item) => !item.separator && !item.disabled)
      const selectableCount = selectableItems.length

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        focusedIndex = (focusedIndex + 1) % selectableCount
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        focusedIndex = (focusedIndex - 1 + selectableCount) % selectableCount
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < selectableCount) {
          selectableItems[focusedIndex].action()
          open = false
        }
      }
    }

    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKeydown)

    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKeydown)
    }
  })

  function handleItemClick(item: ContextMenuItem) {
    if (item.disabled || item.separator) return
    item.action()
    open = false
  }

  // Map items to selectable indices for keyboard focus tracking
  let selectableMap = $derived(
    items.reduce<number[]>((acc, item, i) => {
      if (!item.separator && !item.disabled) acc.push(i)
      return acc
    }, [])
  )
</script>

{#if open}
  <div
    class="context-menu"
    role="menu"
    bind:this={menuEl}
    style="left: {adjustedX}px; top: {adjustedY}px;"
  >
    {#each items as item, i (i)}
      {#if item.separator}
        <hr class="context-menu-separator" />
      {:else}
        {@const selectableIdx = selectableMap.indexOf(i)}
        <button
          class="context-menu-item"
          class:context-menu-item--disabled={item.disabled}
          class:context-menu-item--focused={focusedIndex === selectableIdx}
          role="menuitem"
          disabled={item.disabled}
          onclick={() => handleItemClick(item)}
          onmouseenter={() => {
            focusedIndex = selectableIdx
          }}
        >
          {#if item.icon}
            <span class="context-menu-item-icon">
              <Icon name={item.icon} size={14} />
            </span>
          {/if}
          <span class="context-menu-item-label">{item.label}</span>
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: 9000;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    min-width: 160px;
    max-width: 280px;
    padding: var(--space-1) 0;
    animation: menu-appear var(--transition-fast) ease forwards;
  }

  @keyframes menu-appear {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .context-menu-separator {
    margin: var(--space-1) 0;
    border-color: var(--color-border-subtle);
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    text-align: left;
    border-radius: 0;
    cursor: pointer;
    transition: background var(--transition-fast);
    background: transparent;
  }

  .context-menu-item:hover:not(.context-menu-item--disabled),
  .context-menu-item--focused:not(.context-menu-item--disabled) {
    background: var(--color-bg-active);
  }

  .context-menu-item--disabled {
    color: var(--color-text-disabled);
    cursor: not-allowed;
  }

  .context-menu-item-icon {
    display: flex;
    align-items: center;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .context-menu-item-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
