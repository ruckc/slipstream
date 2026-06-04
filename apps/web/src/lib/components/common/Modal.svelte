<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    open = $bindable(false),
    title,
    children,
    footer,
  }: {
    open?: boolean
    title: string
    children: Snippet
    footer?: Snippet
  } = $props()

  let dialogEl = $state<HTMLElement | null>(null)

  function close() {
    open = false
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close()
  }

  function getFocusable(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.closest('[aria-hidden="true"]'))
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'Tab' && dialogEl) {
      const focusable = getFocusable(dialogEl)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
  }

  $effect(() => {
    if (open) {
      // Focus first focusable element when opened
      const raf = requestAnimationFrame(() => {
        if (dialogEl) {
          const focusable = getFocusable(dialogEl)
          if (focusable.length > 0) focusable[0].focus()
        }
      })
      return () => cancelAnimationFrame(raf)
    }
  })
</script>

{#if open}
  <div
    class="modal-backdrop"
    onclick={handleBackdropClick}
    onkeydown={handleKeydown}
    role="presentation"
    aria-hidden="false"
  >
    <div
      class="modal-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      bind:this={dialogEl}
    >
      <div class="modal-header">
        <h2 id="modal-title" class="modal-title">{title}</h2>
        <button class="modal-close" onclick={close} aria-label="Close dialog" type="button">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path
              d="M3.293 3.293a1 1 0 0 1 1.414 0L8 6.586l3.293-3.293a1 1 0 1 1 1.414 1.414L9.414 8l3.293 3.293a1 1 0 0 1-1.414 1.414L8 9.414l-3.293 3.293a1 1 0 0 1-1.414-1.414L6.586 8 3.293 4.707a1 1 0 0 1 0-1.414z"
            />
          </svg>
        </button>
      </div>
      <div class="modal-body">
        {@render children()}
      </div>
      {#if footer}
        <div class="modal-footer">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: backdrop-fade var(--transition-base) ease forwards;
  }

  @keyframes backdrop-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .modal-dialog {
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    width: 480px;
    max-width: calc(100vw - var(--space-8));
    max-height: calc(100dvh - var(--space-8));
    display: flex;
    flex-direction: column;
    animation: dialog-slide var(--transition-base) ease forwards;
  }

  @media (max-width: 639px) {
    .modal-dialog {
      width: calc(100vw - var(--space-4));
      max-height: 90dvh;
    }
  }

  @keyframes dialog-slide {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .modal-title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .modal-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    transition:
      background var(--transition-fast),
      color var(--transition-fast);
  }

  .modal-close:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  .modal-body {
    padding: var(--space-4);
    overflow-y: auto;
    flex: 1;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--color-border);
    flex-shrink: 0;
  }
</style>
