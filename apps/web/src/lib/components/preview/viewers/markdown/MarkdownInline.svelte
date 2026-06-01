<script lang="ts">
  import type { Token, Tokens } from 'marked'
  import MarkdownInline from './MarkdownInline.svelte'

  // MarkdownInline renders a list of inline tokens as DOM-safe Svelte elements.
  // Supported: text, strong, em, codespan, link, br, image (text fallback).
  // NO {@html} anywhere.

  let { tokens }: { tokens: Token[] } = $props()

  // Marked narrows token.type checks to `SpecificType | Generic`. Generic has an index
  // signature so TypeScript can't fully narrow the concrete type. This helper casts
  // after the {#if} guard has already verified the type discriminant.
  function tok<T extends Tokens.Generic>(t: Token): T {
    return t as unknown as T
  }
</script>

{#each tokens as token, ti (ti)}
  {#if token.type === 'text'}
    {tok<Tokens.Text>(token).text ?? ''}{#if tok<Tokens.Text>(token).tokens?.length}<MarkdownInline
        tokens={tok<Tokens.Text>(token).tokens ?? []}
      />{/if}
  {:else if token.type === 'strong'}
    <strong><MarkdownInline tokens={tok<Tokens.Strong>(token).tokens} /></strong>
  {:else if token.type === 'em'}
    <em><MarkdownInline tokens={tok<Tokens.Em>(token).tokens} /></em>
  {:else if token.type === 'codespan'}
    <code class="inline-code">{tok<Tokens.Codespan>(token).text}</code>
  {:else if token.type === 'link'}
    {@const link = tok<Tokens.Link>(token)}
    <a href={link.href} title={link.title ?? undefined} rel="noopener noreferrer" target="_blank"
      ><MarkdownInline
        tokens={link.tokens ?? [{ type: 'text', text: link.text, raw: link.text }]}
      /></a
    >
  {:else if token.type === 'image'}
    {@const img = tok<Tokens.Image>(token)}
    <img src={img.href} alt={img.text} title={img.title ?? undefined} class="md-image" />
  {:else if token.type === 'br'}
    <br />
  {:else if token.type === 'del'}
    <del><MarkdownInline tokens={tok<Tokens.Del>(token).tokens} /></del>
  {:else if token.type === 'escape'}
    {tok<Tokens.Escape>(token).text}
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
