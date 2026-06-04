<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    height = $bindable(220),
    children,
  }: {
    height?: number
    children: Snippet
  } = $props()
</script>

<section class="panel-area" style="height: {height}px; min-height: {height}px;" aria-label="Panel">
  {@render children()}
</section>

<style>
  .panel-area {
    display: flex;
    flex-direction: column;
    background: var(--color-bg-surface);
    border-top: 1px solid var(--color-border);
    overflow: hidden;
    flex-shrink: 0;
  }

  @media (max-width: 639px) {
    .panel-area {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: calc(22px + env(safe-area-inset-bottom, 0px));
      z-index: 200;
      height: auto !important;
      min-height: 0 !important;
      border-top: none;
    }
  }
</style>
