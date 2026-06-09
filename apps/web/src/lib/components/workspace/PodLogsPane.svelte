<script lang="ts">
  import type { PodLogsPaneData } from './WorkspaceTypes.js'
  import Icon from '$lib/components/common/Icon.svelte'

  let { pane, onRefresh }: { pane: PodLogsPaneData; onRefresh: () => void } = $props()
</script>

<div class="pod-logs">
  <div class="pod-logs__toolbar">
    <span class="pod-logs__title">Pod Logs (last 1000 lines)</span>
    <button class="pod-logs__btn" onclick={onRefresh} title="Refresh logs" disabled={pane.loading}>
      <Icon name="refresh" size={13} />
    </button>
  </div>

  {#if pane.loading}
    <div class="pod-logs__state">Loading…</div>
  {:else if pane.logs === null || pane.logs === ''}
    <div class="pod-logs__state pod-logs__state--empty">No logs available</div>
  {:else}
    <pre class="pod-logs__output">{pane.logs}</pre>
  {/if}
</div>

<style>
  .pod-logs {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--color-bg-base);
  }

  .pod-logs__toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-3);
    height: 30px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-surface);
  }

  .pod-logs__title {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .pod-logs__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1);
    color: var(--color-text-muted);
    border-radius: var(--radius-sm);
    transition:
      color var(--transition-fast),
      background var(--transition-fast);
  }

  .pod-logs__btn:hover:not(:disabled) {
    color: var(--color-text-primary);
    background: var(--color-bg-hover);
  }

  .pod-logs__btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .pod-logs__state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .pod-logs__output {
    flex: 1;
    overflow: auto;
    margin: 0;
    padding: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    line-height: 1.6;
    color: var(--color-text-primary);
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
