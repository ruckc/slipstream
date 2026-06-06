<script lang="ts">
  let {
    status,
    size = 'md',
  }: {
    status: string
    size?: 'sm' | 'md'
  } = $props()

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
</script>

<div class="status-chip status-chip--{size}" aria-label="Project status: {cfg.label}">
  <span
    class="status-dot"
    class:status-dot--pulse={cfg.pulse}
    style:background={cfg.dot}
    aria-hidden="true"
  ></span>
  <span class="status-label" style:color={cfg.color}>
    {cfg.label}
  </span>
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
</style>
