<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    text,
    position = 'top',
    delay = 500,
    children,
  }: {
    text: string
    position?: 'top' | 'bottom' | 'left' | 'right'
    delay?: number
    children: Snippet
  } = $props()

  let visible = $state(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  function show() {
    timer = setTimeout(() => {
      visible = true
    }, delay)
  }

  function hide() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    visible = false
  }
</script>

<div
  class="tooltip-wrapper"
  onmouseenter={show}
  onmouseleave={hide}
  onfocus={show}
  onblur={hide}
  role="presentation"
>
  {@render children()}
  {#if visible && text}
    <div class="tooltip tooltip--{position}" role="tooltip">
      {text}
    </div>
  {/if}
</div>

<style>
  .tooltip-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .tooltip {
    position: absolute;
    z-index: 9999;
    pointer-events: none;
    white-space: nowrap;
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-xs);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    animation: tooltip-fade var(--transition-fast) ease forwards;
  }

  @keyframes tooltip-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .tooltip--top {
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
  }

  .tooltip--bottom {
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
  }

  .tooltip--left {
    right: calc(100% + 6px);
    top: 50%;
    transform: translateY(-50%);
  }

  .tooltip--right {
    left: calc(100% + 6px);
    top: 50%;
    transform: translateY(-50%);
  }
</style>
