<script lang="ts">
  import type { Token } from 'marked'
  import MarkdownParagraph from './MarkdownParagraph.svelte'
  import MarkdownHeading from './MarkdownHeading.svelte'
  import MarkdownCodeBlock from './MarkdownCodeBlock.svelte'
  import MarkdownBlockquote from './MarkdownBlockquote.svelte'
  import MarkdownList from './MarkdownList.svelte'
  import MarkdownTable from './MarkdownTable.svelte'

  let { tokens }: { tokens: Token[] } = $props()
</script>

{#each tokens as token}
  {#if token.type === 'paragraph'}
    <MarkdownParagraph {token} />
  {:else if token.type === 'heading'}
    <MarkdownHeading {token} />
  {:else if token.type === 'code'}
    <MarkdownCodeBlock {token} />
  {:else if token.type === 'blockquote'}
    <MarkdownBlockquote {token} />
  {:else if token.type === 'list'}
    <MarkdownList {token} />
  {:else if token.type === 'table'}
    <MarkdownTable {token} />
  {:else if token.type === 'hr'}
    <hr class="md-hr" />
  {:else if token.type === 'space'}
    <!-- skip whitespace tokens -->
  {:else if token.type === 'html'}
    <!-- raw HTML intentionally dropped for security — no {@html} used -->
  {/if}
{/each}

<style>
  .md-hr {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 1.5em 0;
  }
</style>
