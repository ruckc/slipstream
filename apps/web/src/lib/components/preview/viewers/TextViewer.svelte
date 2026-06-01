<script lang="ts">
  let { content }: { content: Uint8Array } = $props()

  let text = $derived(new TextDecoder().decode(content))
  let lineCount = $derived(text.split('\n').length)
</script>

<div class="text-viewer">
  <pre class="text-content" tabindex="0" aria-label="Text file content">{text}</pre>
  <div class="text-meta">
    {lineCount} line{lineCount !== 1 ? 's' : ''}
  </div>
</div>

<style>
  .text-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-bg-base);
    overflow: hidden;
  }

  .text-content {
    flex: 1;
    overflow: auto;
    padding: var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 2;
    line-height: 1.6;
    margin: 0;
  }

  .text-meta {
    flex-shrink: 0;
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-xs);
    color: var(--color-text-disabled);
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-bg-surface);
  }
</style>
