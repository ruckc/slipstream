<script lang="ts">
  import type { Tokens } from 'marked'
  import CodeViewer from '../CodeViewer.svelte'

  let { token }: { token: Tokens.Code } = $props()

  // Derive a pseudo-filename from the language hint so extensionToLang works
  let pseudoFilename = $derived(token.lang ? `file.${token.lang.split(' ')[0]}` : 'file.txt')
</script>

<div class="md-code-block">
  {#if token.lang}
    <div class="md-code-lang" aria-label="Language: {token.lang}">{token.lang.split(' ')[0]}</div>
  {/if}
  <CodeViewer code={token.text ?? ''} filename={pseudoFilename} />
</div>

<style>
  .md-code-block {
    margin: 1em 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--color-bg-base);
    position: relative;
  }

  .md-code-lang {
    position: absolute;
    top: var(--space-1);
    right: var(--space-2);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    color: var(--color-text-disabled);
    pointer-events: none;
    z-index: 1;
    user-select: none;
  }

  .md-code-block :global(.code-viewer-wrap) {
    max-height: 400px;
  }

  .md-code-block :global(.code-meta) {
    display: none;
  }
</style>
