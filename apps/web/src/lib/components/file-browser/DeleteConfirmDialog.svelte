<script lang="ts">
  import Modal from '$lib/components/common/Modal.svelte'
  import Button from '$lib/components/common/Button.svelte'
  import Icon from '$lib/components/common/Icon.svelte'

  let {
    open = $bindable(false),
    path,
    type,
    onDelete,
  }: {
    open?: boolean
    path: string
    type: 'file' | 'dir'
    onDelete: (path: string) => Promise<void>
  } = $props()

  let loading = $state(false)
  let error = $state('')

  let name = $derived(path.split('/').pop() ?? path)

  function close() {
    open = false
    loading = false
    error = ''
  }

  async function handleDelete() {
    loading = true
    error = ''
    try {
      await onDelete(path)
      close()
    } catch (err) {
      error = err instanceof Error ? err.message : 'Delete failed'
    } finally {
      loading = false
    }
  }
</script>

<Modal bind:open title="Confirm Delete">
  <div class="dialog-content">
    <div class="dialog-icon">
      <Icon name="warning" size={24} />
    </div>
    <div class="dialog-message">
      <p>
        Are you sure you want to delete
        <strong class="dialog-name">{name}</strong>?
      </p>
      {#if type === 'dir'}
        <p class="dialog-warning">This will delete the folder and all its contents.</p>
      {/if}
      <p class="dialog-irreversible">This action cannot be undone.</p>
    </div>
  </div>
  {#if error}
    <p class="dialog-error">{error}</p>
  {/if}
  <div class="dialog-actions">
    <Button variant="ghost" onclick={close} disabled={loading}>Cancel</Button>
    <Button variant="danger" onclick={handleDelete} {loading}>
      Delete {type === 'dir' ? 'Folder' : 'File'}
    </Button>
  </div>
</Modal>

<style>
  .dialog-content {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
  }

  .dialog-icon {
    color: var(--color-warning);
    flex-shrink: 0;
    margin-top: 2px;
  }

  .dialog-message {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    line-height: 1.5;
  }

  .dialog-name {
    font-weight: 600;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    background: var(--color-bg-input);
    padding: 1px var(--space-1);
    border-radius: var(--radius-sm);
  }

  .dialog-warning {
    color: var(--color-warning);
    font-size: var(--font-size-xs);
  }

  .dialog-irreversible {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .dialog-error {
    font-size: var(--font-size-xs);
    color: var(--color-danger);
    margin-top: var(--space-2);
  }

  .dialog-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    margin-top: var(--space-3);
  }
</style>
