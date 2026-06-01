<script lang="ts">
  import ProgressBar from '$lib/components/common/ProgressBar.svelte'
  import Icon from '$lib/components/common/Icon.svelte'

  let {
    filename,
    progress,
    error,
    onCancel,
  }: {
    filename: string
    progress: number
    error: string | null
    onCancel: () => void
  } = $props()

  let variant = $derived.by<'default' | 'success' | 'error'>(() => {
    if (error) return 'error'
    if (progress >= 100) return 'success'
    return 'default'
  })
</script>

<div class="upload-item" class:upload-item--error={!!error}>
  <div class="upload-item-header">
    <span class="upload-item-name" title={filename}>{filename}</span>
    <div class="upload-item-actions">
      {#if progress < 100 && !error}
        <span class="upload-item-pct">{Math.round(progress)}%</span>
      {/if}
      {#if error}
        <Icon name="warning" size={12} />
      {:else if progress >= 100}
        <Icon name="check" size={12} />
      {/if}
      <button
        class="upload-item-cancel"
        onclick={onCancel}
        title={progress >= 100 ? 'Dismiss' : 'Cancel upload'}
        aria-label={progress >= 100 ? 'Dismiss' : 'Cancel upload'}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  </div>
  {#if error}
    <p class="upload-item-error">{error}</p>
  {:else}
    <ProgressBar value={progress} {variant} />
  {/if}
</div>

<style>
  .upload-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .upload-item:last-child {
    border-bottom: none;
  }

  .upload-item--error {
    background: rgba(241, 76, 76, 0.05);
  }

  .upload-item-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .upload-item-name {
    flex: 1;
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .upload-item-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    color: var(--color-text-muted);
  }

  .upload-item-pct {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .upload-item-cancel {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
  }

  .upload-item-cancel:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  .upload-item-error {
    font-size: var(--font-size-xs);
    color: var(--color-danger);
    line-height: 1.3;
  }
</style>
