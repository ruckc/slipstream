<script lang="ts">
  let {
    status,
    size = 'md',
    onStart,
    onStop,
  }: {
    status: string
    size?: 'sm' | 'md'
    onStart?: () => Promise<void>
    onStop?: () => Promise<void>
  } = $props()

  let busy = $state(false)
  let actionError = $state<string | null>(null)

  const statusConfig: Record<
    string,
    { color: string; dot: string; label: string; pulse?: boolean }
  > = {
    running: { color: 'var(--color-success)', dot: 'var(--color-success)', label: 'Running' },
    starting: {
      color: 'var(--color-warning)',
      dot: 'var(--color-warning)',
      label: 'Starting',
      pulse: true,
    },
    stopping: {
      color: 'var(--color-warning)',
      dot: 'var(--color-warning)',
      label: 'Stopping',
      pulse: true,
    },
    stopped: {
      color: 'var(--color-text-muted)',
      dot: 'var(--color-text-disabled)',
      label: 'Stopped',
    },
    error: { color: 'var(--color-danger)', dot: 'var(--color-danger)', label: 'Error' },
  }

  const cfg = $derived(statusConfig[status] ?? statusConfig.stopped)

  const canStart = $derived(status === 'stopped' || status === 'error')
  const canStop = $derived(status === 'running' || status === 'starting')
  const isBusy = $derived(busy || status === 'starting' || status === 'stopping')

  async function handleStart() {
    if (!onStart || busy) return
    busy = true
    actionError = null
    try {
      await onStart()
    } catch (err) {
      actionError = err instanceof Error ? err.message : 'Start failed'
    } finally {
      busy = false
    }
  }

  async function handleStop() {
    if (!onStop || busy) return
    busy = true
    actionError = null
    try {
      await onStop()
    } catch (err) {
      actionError = err instanceof Error ? err.message : 'Stop failed'
    } finally {
      busy = false
    }
  }
</script>

<div class="status-chip status-chip--{size}" aria-label="Project status: {cfg.label}">
  <span
    class="status-dot"
    class:status-dot--pulse={cfg.pulse || busy}
    style:background={cfg.dot}
    aria-hidden="true"
  ></span>
  <span class="status-label" style:color={cfg.color}>
    {busy ? (canStart ? 'Starting…' : 'Stopping…') : cfg.label}
  </span>
  {#if onStart && canStart && !isBusy}
    <button
      class="status-action status-action--start"
      onclick={handleStart}
      disabled={isBusy}
      title="Start project"
      aria-label="Start project"
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path
          d="M3 2.5a.5.5 0 0 1 .763-.424l10 5.5a.5.5 0 0 1 0 .848l-10 5.5A.5.5 0 0 1 3 13.5v-11z"
        />
      </svg>
    </button>
  {:else if onStop && canStop && !isBusy}
    <button
      class="status-action status-action--stop"
      onclick={handleStop}
      disabled={isBusy}
      title="Stop project"
      aria-label="Stop project"
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M3 3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H3z" />
      </svg>
    </button>
  {/if}
  {#if actionError}
    <span class="status-error" title={actionError} aria-label="Error: {actionError}">!</span>
  {/if}
</div>

<style>
  .status-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    white-space: nowrap;
  }

  .status-chip--sm {
    font-size: var(--font-size-xs);
  }

  .status-chip--md {
    font-size: var(--font-size-sm);
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background var(--transition-base);
  }

  .status-dot--pulse {
    animation: dot-pulse 1.2s ease-in-out infinite;
  }

  @keyframes dot-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(0.8);
    }
  }

  .status-label {
    font-weight: 500;
    transition: color var(--transition-fast);
  }

  .status-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1px solid currentColor;
    cursor: pointer;
    transition:
      background var(--transition-fast),
      opacity var(--transition-fast);
    opacity: 0.7;
    margin-left: 2px;
  }

  .status-action:hover:not(:disabled) {
    opacity: 1;
  }

  .status-action:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .status-action--start {
    color: var(--color-success);
  }

  .status-action--start:hover:not(:disabled) {
    background: rgba(78, 201, 148, 0.15);
  }

  .status-action--stop {
    color: var(--color-danger);
  }

  .status-action--stop:hover:not(:disabled) {
    background: rgba(241, 76, 76, 0.15);
  }

  .status-error {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-danger);
    color: white;
    font-size: 9px;
    font-weight: 700;
    cursor: help;
  }
</style>
