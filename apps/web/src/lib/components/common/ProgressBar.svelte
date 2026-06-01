<script lang="ts">
  let {
    value,
    label,
    variant = 'default',
  }: {
    value: number
    label?: string
    variant?: 'default' | 'success' | 'error'
  } = $props()

  let clampedValue = $derived(Math.max(0, Math.min(100, value)))
</script>

<div
  class="progress-container"
  role="progressbar"
  aria-valuenow={clampedValue}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-label={label}
>
  {#if label}
    <div class="progress-label">
      <span>{label}</span>
      <span class="progress-pct">{Math.round(clampedValue)}%</span>
    </div>
  {/if}
  <div class="progress-track">
    <div class="progress-fill progress-fill--{variant}" style="width: {clampedValue}%"></div>
  </div>
</div>

<style>
  .progress-container {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
  }

  .progress-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .progress-pct {
    color: var(--color-text-disabled);
  }

  .progress-track {
    width: 100%;
    height: 4px;
    background: var(--color-bg-input);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: var(--radius-sm);
    transition: width var(--transition-base);
  }

  .progress-fill--default {
    background: var(--color-accent);
  }

  .progress-fill--success {
    background: var(--color-success);
  }

  .progress-fill--error {
    background: var(--color-danger);
  }
</style>
