<script lang="ts">
  import type { Tokens } from 'marked'
  import MarkdownInline from './MarkdownInline.svelte'

  let { token }: { token: Tokens.Heading } = $props()

  // Generate a slug for anchor links
  let slug = $derived(
    (token.text ?? '')
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-'),
  )
</script>

{#if token.depth === 1}
  <h1 class="md-heading md-h1" id={slug}><MarkdownInline tokens={token.tokens ?? []} /></h1>
{:else if token.depth === 2}
  <h2 class="md-heading md-h2" id={slug}><MarkdownInline tokens={token.tokens ?? []} /></h2>
{:else if token.depth === 3}
  <h3 class="md-heading md-h3" id={slug}><MarkdownInline tokens={token.tokens ?? []} /></h3>
{:else if token.depth === 4}
  <h4 class="md-heading md-h4" id={slug}><MarkdownInline tokens={token.tokens ?? []} /></h4>
{:else if token.depth === 5}
  <h5 class="md-heading md-h5" id={slug}><MarkdownInline tokens={token.tokens ?? []} /></h5>
{:else}
  <h6 class="md-heading md-h6" id={slug}><MarkdownInline tokens={token.tokens ?? []} /></h6>
{/if}

<style>
  .md-heading {
    color: var(--color-text-primary);
    font-weight: 600;
    line-height: 1.3;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
  }

  .md-heading:first-child {
    margin-top: 0;
  }

  .md-h1 {
    font-size: 1.8em;
    border-bottom: 1px solid var(--color-border);
    padding-bottom: 0.3em;
  }

  .md-h2 {
    font-size: 1.4em;
    border-bottom: 1px solid var(--color-border-subtle);
    padding-bottom: 0.2em;
  }

  .md-h3 {
    font-size: 1.2em;
  }

  .md-h4 {
    font-size: 1.05em;
  }

  .md-h5 {
    font-size: 0.95em;
  }

  .md-h6 {
    font-size: 0.9em;
    color: var(--color-text-muted);
  }
</style>
