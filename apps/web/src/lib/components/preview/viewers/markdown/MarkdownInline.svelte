<script lang="ts">
  import type { Token } from 'marked'

  // MarkdownInline renders a list of inline tokens as DOM-safe Svelte elements.
  // Supported: text, strong, em, codespan, link, br, image (text fallback).
  // NO {@html} anywhere.

  let { tokens }: { tokens: Token[] } = $props()
</script>

{#each tokens as token}
  {#if token.type === 'text'}
    {token.text ?? ''}{#if (token as any).tokens?.length}<svelte:self tokens={(token as any).tokens} />{/if}
  {:else if token.type === 'strong'}
    <strong><svelte:self tokens={(token as any).tokens ?? []} /></strong>
  {:else if token.type === 'em'}
    <em><svelte:self tokens={(token as any).tokens ?? []} /></em>
  {:else if token.type === 'codespan'}
    <code class="inline-code">{(token as any).text}</code>
  {:else if token.type === 'link'}
    <a
      href={(token as any).href}
      title={(token as any).title ?? undefined}
      rel="noopener noreferrer"
      target="_blank"
    ><svelte:self tokens={(token as any).tokens ?? [{ type: 'text', text: (token as any).text, raw: (token as any).text }]} /></a>
  {:else if token.type === 'image'}
    <img
      src={(token as any).href}
      alt={(token as any).text}
      title={(token as any).title ?? undefined}
      class="md-image"
    />
  {:else if token.type === 'br'}
    <br />
  {:else if token.type === 'del'}
    <del><svelte:self tokens={(token as any).tokens ?? []} /></del>
  {:else if token.type === 'escape'}
    {(token as any).text}
  {:else if token.type === 'html'}
    <!-- raw inline HTML intentionally dropped for security -->
  {/if}
{/each}

<style>
  .inline-code {
    font-family: var(--font-mono);
    font-size: 0.9em;
    background: var(--color-bg-input);
    color: var(--shiki-token-string, var(--color-text-primary));
    padding: 1px 4px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .md-image {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-md);
    display: inline-block;
    vertical-align: middle;
  }
</style>
