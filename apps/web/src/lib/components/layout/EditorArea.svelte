<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    children,
  }: {
    children: Snippet
  } = $props()
</script>

<section class="editor-area" aria-label="Editor">
  {@render children()}
</section>

<style>
  .editor-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    background: var(--color-bg-base);
  }
</style>
