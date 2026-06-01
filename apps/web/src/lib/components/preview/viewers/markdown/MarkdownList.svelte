<script lang="ts">
  import type { Tokens } from 'marked'
  import MarkdownListItem from './MarkdownListItem.svelte'

  let { token }: { token: Tokens.List } = $props()
</script>

{#if token.ordered}
  <ol class="md-list md-list--ordered" start={token.start || undefined}>
    {#each token.items as item, i (i)}
      <MarkdownListItem {item} />
    {/each}
  </ol>
{:else}
  <ul class="md-list md-list--unordered">
    {#each token.items as item, i (i)}
      <MarkdownListItem {item} />
    {/each}
  </ul>
{/if}

<style>
  .md-list {
    margin: 0.75em 0;
    padding-left: 1.8em;
    color: var(--color-text-primary);
  }

  .md-list--unordered {
    list-style: disc;
  }

  .md-list--ordered {
    list-style: decimal;
  }

  :global(.md-list .md-list) {
    margin: 0.25em 0;
  }
</style>
