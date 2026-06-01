<script lang="ts">
  import type { Token, Tokens } from 'marked'
  import MarkdownParagraph from './MarkdownParagraph.svelte'
  import MarkdownHeading from './MarkdownHeading.svelte'
  import MarkdownCodeBlock from './MarkdownCodeBlock.svelte'
  import MarkdownBlockquote from './MarkdownBlockquote.svelte'
  import MarkdownList from './MarkdownList.svelte'
  import MarkdownTable from './MarkdownTable.svelte'

  let { tokens }: { tokens: Token[] } = $props()

  function asTokenType<T extends Tokens.Generic>(t: Token): T {
    return t as unknown as T
  }
</script>

{#each tokens as token, i (i)}
  {#if token.type === 'paragraph'}
    <MarkdownParagraph token={asTokenType<Tokens.Paragraph>(token)} />
  {:else if token.type === 'heading'}
    <MarkdownHeading token={asTokenType<Tokens.Heading>(token)} />
  {:else if token.type === 'code'}
    <MarkdownCodeBlock token={asTokenType<Tokens.Code>(token)} />
  {:else if token.type === 'blockquote'}
    <MarkdownBlockquote token={asTokenType<Tokens.Blockquote>(token)} />
  {:else if token.type === 'list'}
    <MarkdownList token={asTokenType<Tokens.List>(token)} />
  {:else if token.type === 'table'}
    <MarkdownTable token={asTokenType<Tokens.Table>(token)} />
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
