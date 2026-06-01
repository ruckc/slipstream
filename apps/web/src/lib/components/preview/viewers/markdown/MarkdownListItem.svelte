<script lang="ts">
  import type { Tokens } from 'marked'
  import MarkdownInline from './MarkdownInline.svelte'
  // MarkdownRenderer imported lazily via dynamic import to avoid circular dep issues
  // We use a snippet-based approach instead

  let { item }: { item: Tokens.ListItem } = $props()

  // Separate block tokens (non-text/paragraph) from inline tokens
  let hasBlockContent = $derived(
    (item.tokens ?? []).some(t => t.type !== 'text' && t.type !== 'paragraph' && t.type !== 'space'),
  )

  // Inline-only tokens for tight lists
  let inlineTokens = $derived(
    item.tokens && item.tokens.length > 0 && item.tokens[0].type === 'text'
      ? (item.tokens[0] as any).tokens ?? []
      : item.tokens && item.tokens.length > 0 && item.tokens[0].type === 'paragraph'
        ? (item.tokens[0] as any).tokens ?? []
        : [],
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
    <!-- svelte-ignore avoid_inline_styles -->
    <div class="md-list-item-body">
      {#each item.tokens ?? [] as subToken}
        {#if subToken.type === 'paragraph'}
          <MarkdownInline tokens={(subToken as any).tokens ?? []} />
        {:else if subToken.type === 'text'}
          <MarkdownInline tokens={(subToken as any).tokens ?? [{ type: 'text', text: (subToken as any).text, raw: (subToken as any).raw }]} />
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
