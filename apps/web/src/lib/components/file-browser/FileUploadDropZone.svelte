<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from '$lib/components/common/Icon.svelte'
  import { uploadsFromDataTransfer } from './file-upload'

  let {
    targetPath,
    onUpload,
    children,
  }: {
    targetPath: string
    onUpload: (uploads: import('./file-upload').FileUpload[], targetPath: string) => void
    children: Snippet
  } = $props()

  let dragOver = $state(false)
  let dragCounter = $state(0)

  function handleDragEnter(e: DragEvent) {
    e.preventDefault()
    dragCounter++
    if (e.dataTransfer?.types.includes('Files')) {
      dragOver = true
    }
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault()
    dragCounter--
    if (dragCounter === 0) {
      dragOver = false
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault()
    dragOver = false
    dragCounter = 0
    if (!e.dataTransfer) return
    const uploads = await uploadsFromDataTransfer(e.dataTransfer)
    if (uploads.length > 0) {
      onUpload(uploads, targetPath)
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="drop-zone"
  class:drop-zone--active={dragOver}
  ondragenter={handleDragEnter}
  ondragleave={handleDragLeave}
  ondragover={handleDragOver}
  ondrop={handleDrop}
>
  {@render children()}
  {#if dragOver}
    <div class="drop-overlay" aria-live="polite" aria-label="Drop files to upload">
      <div class="drop-hint">
        <Icon name="upload" size={32} />
        <span>Drop files to upload to {targetPath}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .drop-zone {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .drop-zone--active {
    outline: 2px dashed var(--color-accent);
    outline-offset: -2px;
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 120, 212, 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 5;
  }

  .drop-hint {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    color: var(--color-accent);
    font-size: var(--font-size-md);
    font-weight: 500;
    text-align: center;
    padding: var(--space-4);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-lg);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }
</style>
