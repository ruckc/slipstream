<script lang="ts">
  import type { Token, Tokens } from 'marked'
  import MarkdownInline from './MarkdownInline.svelte'

  let { item }: { item: Tokens.ListItem } = $props()

  function tok<T extends Tokens.Generic>(t: Token): T {
    return t as unknown as T
  }

  // Separate block tokens (non-text/paragraph) from inline tokens
  let hasBlockContent = $derived(
    (item.tokens ?? []).some(
      (t) => t.type !== 'text' && t.type !== 'paragraph' && t.type !== 'space'
    )
  )

  // Inline-only tokens for tight lists
  let inlineTokens = $derived(
    item.tokens && item.tokens.length > 0 && item.tokens[0].type === 'text'
      ? (tok<Tokens.Text>(item.tokens[0]).tokens ?? [])
      : item.tokens && item.tokens.length > 0 && item.tokens[0].type === 'paragraph'
        ? (tok<Tokens.Paragraph>(item.tokens[0]).tokens ?? [])
        : []
  )
</script>

<li class="md-list-item" class:md-list-item--task={item.task}>
  {#if item.task}
    <input
      type="checkbox"
      checked={item.checked}
      disabled
      class="md-task-checkbox"
      aria-label={item.checked ? 'Completed' : 'Not completed'}
    />
  {/if}
  {#if hasBlockContent}
    <div class="md-list-item-body">
      {#each item.tokens ?? [] as subToken, i (i)}
        {#if subToken.type === 'paragraph'}
          <MarkdownInline tokens={tok<Tokens.Paragraph>(subToken).tokens} />
        {:else if subToken.type === 'text'}
          {@const t = tok<Tokens.Text>(subToken)}
          <MarkdownInline tokens={t.tokens ?? [{ type: 'text', text: t.text, raw: t.raw }]} />
        {/if}
      {/each}
    </div>
  {:else}
    <MarkdownInline tokens={inlineTokens} />
  {/if}
</li>

<style>
  .md-list-item {
    line-height: 1.7;
    color: var(--color-text-primary);
    padding: 0.1em 0;
  }

  .md-list-item--task {
    list-style: none;
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .md-task-checkbox {
    flex-shrink: 0;
    margin-top: 0.25em;
    accent-color: var(--color-accent);
    cursor: default;
  }

  .md-list-item-body {
    display: inline;
  }
</style>
