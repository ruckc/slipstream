<script lang="ts">
  import { marked } from 'marked'
  import MarkdownRenderer from './markdown/MarkdownRenderer.svelte'

  let { content }: { content: Uint8Array } = $props()

  let text = $derived(new TextDecoder().decode(content))
  let tokens = $derived(marked.lexer(text))
</script>

<div class="markdown-viewer">
  <article class="markdown-body">
    <MarkdownRenderer {tokens} />
  </article>
</div>

<style>
  .markdown-viewer {
    height: 100%;
    overflow-y: auto;
    background: var(--color-bg-base);
  }

  .markdown-body {
    max-width: 800px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-8);
    font-size: var(--font-size-md);
    line-height: 1.7;
    color: var(--color-text-primary);
  }

  /* Global link styling inside markdown */
  .markdown-body :global(a) {
    color: var(--color-text-link);
    text-decoration: underline;
    text-decoration-color: rgba(78, 201, 176, 0.4);
    transition: text-decoration-color var(--transition-fast);
  }

  .markdown-body :global(a:hover) {
    text-decoration-color: var(--color-text-link);
  }

  /* Strong */
  .markdown-body :global(strong) {
    font-weight: 600;
    color: var(--color-text-primary);
  }

  /* Em */
  .markdown-body :global(em) {
    font-style: italic;
    color: var(--color-text-primary);
  }
</style>
