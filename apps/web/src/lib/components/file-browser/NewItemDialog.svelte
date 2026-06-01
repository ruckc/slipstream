<script lang="ts">
  import Modal from '$lib/components/common/Modal.svelte'
  import Input from '$lib/components/common/Input.svelte'
  import Button from '$lib/components/common/Button.svelte'

  let {
    open = $bindable(false),
    mode,
    parentPath,
    onCreate,
  }: {
    open?: boolean
    mode: 'file' | 'folder'
    parentPath: string
    onCreate: (path: string) => Promise<void>
  } = $props()

  let name = $state('')
  let error = $state('')
  let loading = $state(false)

  function close() {
    open = false
    name = ''
    error = ''
    loading = false
  }

  function validate(value: string): string | null {
    if (!value.trim()) return 'Name is required'
    if (/[/\\]/.test(value)) return 'Name cannot contain / or \\'
    if (value === '.' || value === '..') return 'Invalid name'
    return null
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    const validationError = validate(trimmed)
    if (validationError) {
      error = validationError
      return
    }
    error = ''
    loading = true
    try {
      const sep = parentPath.endsWith('/') ? '' : '/'
      await onCreate(parentPath + sep + trimmed)
      close()
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to create ' + mode
    } finally {
      loading = false
    }
  }
</script>

<Modal
  bind:open
  title={mode === 'file' ? 'New File' : 'New Folder'}
>
  <form class="dialog-form" onsubmit={handleSubmit}>
    <p class="dialog-hint">
      Creating in: <code class="dialog-path">{parentPath}</code>
    </p>
    <Input
      label={mode === 'file' ? 'File name' : 'Folder name'}
      bind:value={name}
      error={error}
      placeholder={mode === 'file' ? 'untitled.txt' : 'new-folder'}
      required
    />
    <div class="dialog-actions">
      <Button variant="ghost" onclick={close}>Cancel</Button>
      <Button variant="primary" type="submit" {loading}>
        Create {mode === 'file' ? 'File' : 'Folder'}
      </Button>
    </div>
  </form>
</Modal>

<style>
  .dialog-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .dialog-hint {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .dialog-path {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--color-text-primary);
    background: var(--color-bg-input);
    padding: 1px var(--space-1);
    border-radius: var(--radius-sm);
  }

  .dialog-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    padding-top: var(--space-1);
  }
</style>
