<script lang="ts">
  import type { Tokens } from 'marked'
  import MarkdownInline from './MarkdownInline.svelte'

  let { token }: { token: Tokens.Paragraph } = $props()
</script>

<p class="md-paragraph">
  <MarkdownInline tokens={token.tokens ?? []} />
</p>

<style>
  .md-paragraph {
    margin: 0 0 1em;
    line-height: 1.7;
    color: var(--color-text-primary);
  }

  .md-paragraph:last-child {
    margin-bottom: 0;
  }
</style>
