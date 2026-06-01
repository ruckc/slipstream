<script lang="ts">
  import Modal from '$lib/components/common/Modal.svelte'
  import Input from '$lib/components/common/Input.svelte'
  import Button from '$lib/components/common/Button.svelte'

  let {
    open = $bindable(false),
    currentPath,
    onRename,
  }: {
    open?: boolean
    currentPath: string
    onRename: (oldPath: string, newPath: string) => Promise<void>
  } = $props()

  let currentName = $derived(currentPath.split('/').pop() ?? '')
  let name = $state('')
  let error = $state('')
  let loading = $state(false)

  // Sync name from currentPath when dialog opens
  $effect(() => {
    if (open) {
      name = currentPath.split('/').pop() ?? ''
      error = ''
    }
  })

  function close() {
    open = false
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
    if (trimmed === currentName) {
      close()
      return
    }
    error = ''
    loading = true
    try {
      const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/'
      const newPath = (parent === '/' ? '' : parent) + '/' + trimmed
      await onRename(currentPath, newPath)
      close()
    } catch (err) {
      error = err instanceof Error ? err.message : 'Rename failed'
    } finally {
      loading = false
    }
  }
</script>

<Modal bind:open title="Rename">
  <form class="dialog-form" onsubmit={handleSubmit}>
    <Input
      label="New name"
      bind:value={name}
      error={error}
      placeholder={currentName}
      required
    />
    <div class="dialog-actions">
      <Button variant="ghost" onclick={close}>Cancel</Button>
      <Button variant="primary" type="submit" {loading}>Rename</Button>
    </div>
  </form>
</Modal>

<style>
  .dialog-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .dialog-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
    padding-top: var(--space-1);
  }
</style>
