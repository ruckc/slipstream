<script lang="ts">
  import Modal from './Modal.svelte'
  import Button from './Button.svelte'

  let {
    open = $bindable(false),
    project,
    loading = false,
    onconfirm,
  }: {
    open?: boolean
    project: { displayName: string; slug: string }
    loading?: boolean
    onconfirm: () => void
  } = $props()

  let confirmText = $state('')

  const canDelete = $derived(confirmText === project.slug)

  $effect(() => {
    if (!open) confirmText = ''
  })
</script>

<Modal title="Delete project" bind:open>
  <div class="delete-modal">
    <p class="delete-modal__warning">
      This will permanently delete <strong>{project.displayName}</strong> and all its workspace data.
      This action cannot be undone.
    </p>
    <p class="delete-modal__confirm-label">
      Type <code class="delete-modal__slug">{project.slug}</code> to confirm:
    </p>
    <input
      class="delete-modal__input"
      type="text"
      bind:value={confirmText}
      placeholder={project.slug}
      autocomplete="off"
    />
    <div class="delete-modal__actions">
      <Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
      <Button variant="danger" disabled={!canDelete} {loading} onclick={onconfirm}>
        Delete project
      </Button>
    </div>
  </div>
</Modal>

<style>
  .delete-modal {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .delete-modal__warning {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    line-height: 1.5;
  }

  .delete-modal__confirm-label {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }

  .delete-modal__slug {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    background: var(--color-bg-active);
    padding: 1px var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
  }

  .delete-modal__input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-input);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    box-sizing: border-box;
    outline: none;
    transition: border-color var(--transition-fast);
  }

  .delete-modal__input:focus {
    border-color: var(--color-border-focus);
  }

  .delete-modal__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
</style>
