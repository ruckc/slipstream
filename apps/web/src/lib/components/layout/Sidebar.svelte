<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    width = $bindable(240),
    children,
    title,
  }: {
    width?: number
    children: Snippet
    title?: string
  } = $props()
</script>

<aside
  class="sidebar"
  style="width: {width}px; min-width: {width}px;"
  aria-label={title ?? 'Sidebar'}
>
  {#if title}
    <div class="sidebar-header">
      <span class="sidebar-title">{title}</span>
    </div>
  {/if}
  <div class="sidebar-content">
    {@render children()}
  </div>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-bg-surface);
    overflow: hidden;
    min-width: 150px;
    max-width: 600px;
    flex-shrink: 0;
  }

  @media (max-width: 639px) {
    .sidebar {
      position: fixed !important;
      top: 0;
      left: 0;
      width: 260px !important;
      min-width: 260px !important;
      max-width: 260px !important;
      height: 100dvh;
      z-index: 100;
      border-right: 1px solid var(--color-border);
    }
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    height: 35px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .sidebar-title {
    font-size: var(--font-size-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }
</style>
