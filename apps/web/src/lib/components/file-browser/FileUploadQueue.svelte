<script lang="ts">
  import FileUploadItem from './FileUploadItem.svelte'

  export interface UploadItem {
    id: string
    filename: string
    progress: number
    error: string | null
    cancel: () => void
  }

  let {
    items,
    onDismiss,
  }: {
    items: UploadItem[]
    onDismiss: (id: string) => void
  } = $props()

  let activeCount = $derived(items.filter(i => i.progress < 100 && !i.error).length)
</script>

<div class="upload-queue" aria-label="Upload queue">
  <div class="upload-queue-header">
    <span class="upload-queue-title">
      {#if activeCount > 0}
        Uploading {activeCount} file{activeCount !== 1 ? 's' : ''}…
      {:else}
        Uploads complete
      {/if}
    </span>
  </div>
  <div class="upload-queue-list">
    {#each items as item (item.id)}
      <FileUploadItem
        filename={item.filename}
        progress={item.progress}
        error={item.error}
        onCancel={() => {
          if (item.progress < 100 && !item.error) {
            item.cancel()
          }
          onDismiss(item.id)
        }}
      />
    {/each}
  </div>
</div>

<style>
  .upload-queue {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--color-bg-elevated);
    border-top: 1px solid var(--color-border);
    max-height: 200px;
    display: flex;
    flex-direction: column;
    z-index: 10;
  }

  .upload-queue-header {
    display: flex;
    align-items: center;
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
    flex-shrink: 0;
  }

  .upload-queue-title {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .upload-queue-list {
    overflow-y: auto;
    flex: 1;
  }
</style>
