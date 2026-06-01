<script lang="ts">
  import type { Tokens, Token } from 'marked'
  import MarkdownRenderer from './MarkdownRenderer.svelte'

  let { token }: { token: Tokens.Blockquote } = $props()
</script>

<blockquote class="md-blockquote">
  <MarkdownRenderer tokens={(token as any).tokens ?? []} />
</blockquote>

<style>
  .md-blockquote {
    margin: 1em 0;
    padding: var(--space-2) var(--space-4);
    border-left: 3px solid var(--color-accent);
    background: rgba(0, 120, 212, 0.06);
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    color: var(--color-text-muted);
  }

  .md-blockquote :global(.md-paragraph) {
    margin-bottom: 0;
  }
</style>
