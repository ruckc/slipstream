<script lang="ts">
  import { getAdminMetrics, getAdminMetricsRange } from '$lib/remote/metrics.remote'
  import MetricsPanel from '$lib/components/common/MetricsPanel.svelte'
  import MetricsExplorer from '$lib/components/common/MetricsExplorer.svelte'
  import type { TimeWindow, GroupBy } from '$lib/remote/metrics.remote'

  const data = await getAdminMetrics()

  const GROUP_BY = [
    { value: 'total' as GroupBy, label: 'Total' },
    { value: 'namespace' as GroupBy, label: 'By namespace' },
    { value: 'project' as GroupBy, label: 'By project' },
  ]

  function fetchRange(window: TimeWindow, groupBy: GroupBy) {
    return getAdminMetricsRange({ window, groupBy })
  }
</script>

<svelte:head>
  <title>Metrics — Admin — Slipstream</title>
</svelte:head>

<div class="metrics-page">
  <div class="metrics-header">
    <h1 class="metrics-title">Resource Usage</h1>
    <p class="metrics-desc">Resource metrics aggregated per namespace across the entire cluster.</p>
  </div>

  <div class="metrics-section">
    <MetricsPanel rows={data.rows} />
  </div>

  <div class="metrics-section">
    <MetricsExplorer {fetchRange} availableGroupBy={GROUP_BY} />
  </div>
</div>

<style>
  .metrics-page {
    max-width: 900px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
  }

  .metrics-header {
    margin-bottom: var(--space-6);
  }

  .metrics-title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .metrics-desc {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .metrics-section {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg-surface);
    overflow: hidden;
  }

  @media (max-width: 639px) {
    .metrics-page {
      padding: var(--space-4);
    }
  }
</style>
