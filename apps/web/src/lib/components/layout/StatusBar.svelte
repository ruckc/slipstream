<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    panelVisible = $bindable(true),
    leftContent,
    rightContent,
  }: {
    panelVisible?: boolean
    leftContent?: Snippet
    rightContent?: Snippet
  } = $props()

  function togglePanel() {
    panelVisible = !panelVisible
  }
</script>

<footer class="status-bar" role="status" aria-label="Status bar">
  <div class="status-bar-left">
    {#if leftContent}
      {@render leftContent()}
    {/if}
  </div>

  <div class="status-bar-right">
    {#if rightContent}
      {@render rightContent()}
    {/if}
    <button
      class="status-btn"
      onclick={togglePanel}
      aria-label={panelVisible ? 'Hide panel' : 'Show panel'}
      aria-pressed={panelVisible}
      type="button"
      title={panelVisible ? 'Hide panel' : 'Show panel'}
    >
      {#if panelVisible}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <!-- chevron-down pointing up (collapse) -->
          <path d="M3.293 9.707a1 1 0 0 0 1.414 0L8 6.414l3.293 3.293a1 1 0 0 0 1.414-1.414l-4-4a1 1 0 0 0-1.414 0l-4 4a1 1 0 0 0 0 1.414z"/>
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <!-- chevron pointing down (expand) -->
          <path d="M3.293 5.293a1 1 0 0 1 1.414 0L8 8.586l3.293-3.293a1 1 0 1 1 1.414 1.414l-4 4a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 0-1.414z"/>
        </svg>
      {/if}
    </button>
  </div>
</footer>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 22px;
    min-height: 22px;
    background: var(--color-statusbar-bg);
    color: var(--color-statusbar-fg);
    font-size: var(--font-size-xs);
    padding: 0 var(--space-2);
    flex-shrink: 0;
    overflow: hidden;
  }

  .status-bar-left,
  .status-bar-right {
    display: flex;
    align-items: center;
    gap: 1px;
    overflow: hidden;
  }

  .status-bar-right {
    flex-shrink: 0;
  }

  .status-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    padding: 0 var(--space-2);
    color: var(--color-statusbar-fg);
    border-radius: 0;
    transition: background var(--transition-fast);
  }

  .status-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }
</style>
