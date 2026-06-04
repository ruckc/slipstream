<script lang="ts">
  import Icon from '$lib/components/common/Icon.svelte'
  import type { FileEntry } from './FileTreeFile.svelte'

  let {
    entry,
    depth,
    path,
    expanded = false,
    loading = false,
    selected = false,
    onToggle,
    onContextMenu,
  }: {
    entry: FileEntry
    depth: number
    path: string
    expanded?: boolean
    loading?: boolean
    selected?: boolean
    onToggle: () => void
    onContextMenu: (e: MouseEvent, entry: FileEntry, path: string) => void
  } = $props()

  let longPressTimer: ReturnType<typeof setTimeout> | null = null

  function handleTouchStart(e: TouchEvent) {
    const touch = e.touches[0]
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      onContextMenu({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent, entry, path)
    }, 500)
  }

  function cancelLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }
</script>

<button
  class="dir-row"
  class:dir-row--selected={selected}
  style="padding-left: calc(var(--space-2) + {depth * 16}px)"
  onclick={onToggle}
  oncontextmenu={(e) => {
    e.preventDefault()
    onContextMenu(e, entry, path)
  }}
  ontouchstart={handleTouchStart}
  ontouchend={cancelLongPress}
  ontouchcancel={cancelLongPress}
  aria-expanded={expanded}
  title={path}
>
  <span class="dir-chevron" class:dir-chevron--expanded={expanded} aria-hidden="true">
    {#if loading}
      <span class="dir-spinner"></span>
    {:else}
      <Icon name="chevron-right" size={12} />
    {/if}
  </span>
  <span class="dir-icon">
    <Icon name={expanded ? 'folder-open' : 'folder'} size={14} />
  </span>
  <span class="dir-name">{entry.name}</span>
</button>

<style>
  .dir-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    height: 22px;
    padding-right: var(--space-3);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    text-align: left;
    border-radius: 0;
    cursor: pointer;
    transition: background var(--transition-fast);
    white-space: nowrap;
  }

  .dir-row:hover {
    background: var(--color-bg-hover);
  }

  .dir-row--selected {
    background: var(--color-bg-selection);
  }

  .dir-chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: var(--color-text-muted);
    transition: transform var(--transition-fast);
  }

  .dir-chevron--expanded {
    transform: rotate(90deg);
  }

  .dir-spinner {
    display: block;
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--color-text-disabled);
    border-top-color: var(--color-text-muted);
    border-radius: 50%;
    animation: dir-spin 0.6s linear infinite;
  }

  @keyframes dir-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .dir-icon {
    display: flex;
    align-items: center;
    color: var(--color-warning);
    flex-shrink: 0;
  }

  .dir-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  @media (max-width: 639px) {
    .dir-row {
      height: 40px;
    }
  }
</style>
