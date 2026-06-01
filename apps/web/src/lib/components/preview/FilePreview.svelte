<script lang="ts">
  import { resolveViewer } from './registry.js'
  import Icon from '$lib/components/common/Icon.svelte'

  let {
    filename,
    content,
    mimeType,
    loading = false,
  }: {
    filename: string
    content?: Uint8Array | null
    mimeType?: string
    loading?: boolean
  } = $props()

  let viewer = $derived(content ? resolveViewer(filename, mimeType) : null)

  // Decode to string for text-based viewers (code, markdown, text)
  let textContent = $derived.by<string>(() => {
    if (!content || !viewer) return ''
    const textViewerIds = new Set(['code', 'markdown', 'text'])
    if (textViewerIds.has(viewer.id)) {
      try {
        return new TextDecoder().decode(content)
      } catch {
        return ''
      }
    }
    return ''
  })
</script>

<div class="file-preview">
  {#if loading}
    <div class="file-preview-loading" aria-busy="true">
      <span class="loading-spinner" aria-hidden="true"></span>
      Loading {filename}…
    </div>
  {:else if !content || !viewer}
    <div class="file-preview-empty">
      <Icon name="file" size={48} />
      <span>Select a file to preview</span>
    </div>
  {:else if viewer.id === 'code'}
    <viewer.component code={textContent} {filename} />
  {:else if viewer.id === 'markdown' || viewer.id === 'text'}
    <viewer.component {content} />
  {:else}
    <viewer.component {content} {filename} />
  {/if}
</div>

<style>
  .file-preview {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--color-bg-base);
  }

  .file-preview-loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .loading-spinner {
    display: block;
    width: 16px;
    height: 16px;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .file-preview-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    color: var(--color-text-disabled);
    font-size: var(--font-size-sm);
  }
</style>
