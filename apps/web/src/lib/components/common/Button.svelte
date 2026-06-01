<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    variant = 'secondary',
    size = 'md',
    disabled = false,
    loading = false,
    onclick,
    children,
    type = 'button',
    title,
  }: {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    disabled?: boolean
    loading?: boolean
    onclick?: () => void
    children: Snippet
    type?: 'button' | 'submit' | 'reset'
    title?: string
  } = $props()
</script>

<button
  {type}
  class="btn btn--{variant} btn--{size}"
  disabled={disabled || loading}
  {onclick}
  {title}
  aria-busy={loading}
>
  {#if loading}
    <span class="btn-spinner" aria-hidden="true"></span>
  {/if}
  <span class="btn-content" class:btn-content--hidden={loading}>
    {@render children()}
  </span>
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast),
      opacity var(--transition-fast);
    position: relative;
    border: 1px solid transparent;
    white-space: nowrap;
    user-select: none;
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  /* Sizes */
  .btn--sm {
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-xs);
    height: 22px;
  }

  .btn--md {
    padding: var(--space-1) var(--space-3);
    height: 28px;
  }

  /* Variants */
  .btn--primary {
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-color: var(--color-accent);
  }

  .btn--primary:hover:not(:disabled) {
    background: var(--color-accent-hover);
    border-color: var(--color-accent-hover);
  }

  .btn--secondary {
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
    border-color: var(--color-border);
  }

  .btn--secondary:hover:not(:disabled) {
    background: var(--color-bg-input);
    border-color: var(--color-border-focus);
  }

  .btn--ghost {
    background: transparent;
    color: var(--color-text-primary);
    border-color: transparent;
  }

  .btn--ghost:hover:not(:disabled) {
    background: var(--color-bg-hover);
  }

  .btn--ghost:active:not(:disabled) {
    background: var(--color-bg-active);
  }

  .btn--danger {
    background: var(--color-danger);
    color: #ffffff;
    border-color: var(--color-danger);
  }

  .btn--danger:hover:not(:disabled) {
    background: var(--color-danger-hover);
    border-color: var(--color-danger-hover);
  }

  /* Spinner */
  .btn-spinner {
    position: absolute;
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: btn-spin 0.6s linear infinite;
  }

  @keyframes btn-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .btn-content--hidden {
    visibility: hidden;
  }
</style>
