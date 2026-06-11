<script lang="ts">
  import TimeSeriesChart from './TimeSeriesChart.svelte'
  import type {
    MetricsRangeResult,
    TimeWindow,
    GroupBy,
    MetricSeriesData,
  } from '$lib/remote/metrics.remote'

  type Props = {
    fetchRange: (window: TimeWindow, groupBy: GroupBy) => Promise<MetricsRangeResult>
    availableGroupBy?: { value: GroupBy; label: string }[]
  }

  let { fetchRange, availableGroupBy }: Props = $props()

  type MetricTab = 'cpu' | 'memory' | 'disk' | 'network'

  const WINDOWS: { value: TimeWindow; label: string }[] = [
    { value: '1h', label: '1h' },
    { value: '6h', label: '6h' },
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
  ]

  const TABS: { value: MetricTab; label: string }[] = [
    { value: 'cpu', label: 'CPU' },
    { value: 'memory', label: 'Memory' },
    { value: 'disk', label: 'Disk' },
    { value: 'network', label: 'Network' },
  ]

  let selectedWindow = $state<TimeWindow>('24h')
  let selectedTab = $state<MetricTab>('cpu')
  let selectedGroupBy = $state<GroupBy>('total')
  let rangeData = $state<MetricsRangeResult | null>(null)
  let loading = $state(false)
  let error = $state('')

  async function load() {
    loading = true
    error = ''
    try {
      rangeData = await fetchRange(selectedWindow, selectedGroupBy)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load metrics'
    } finally {
      loading = false
    }
  }

  $effect(() => {
    void selectedWindow
    void selectedGroupBy
    load()
  })

  function formatBytes(v: number): string {
    if (v == null) return '—'
    if (v < 1024) return `${v.toFixed(0)} B`
    if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`
    if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`
    return `${(v / 1024 ** 3).toFixed(2)} GB`
  }

  function formatCpu(v: number): string {
    if (v == null) return '—'
    if (v < 60) return `${v.toFixed(1)} s`
    if (v < 3600) return `${(v / 60).toFixed(1)} min`
    return `${(v / 3600).toFixed(2)} h`
  }

  const activeSeries = $derived.by((): MetricSeriesData[] => {
    if (!rangeData) return []
    switch (selectedTab) {
      case 'cpu':
        return rangeData.cpu
      case 'memory':
        return rangeData.memory
      case 'disk':
        return rangeData.disk
      case 'network':
        return [
          ...rangeData.ingressEgress.ingress.map((s) => ({ ...s, label: `${s.label} ↓` })),
          ...rangeData.ingressEgress.egress.map((s) => ({ ...s, label: `${s.label} ↑` })),
        ]
    }
  })

  const activeFormatter = $derived.by((): ((v: number) => string) => {
    switch (selectedTab) {
      case 'cpu':
        return formatCpu
      case 'memory':
      case 'disk':
      case 'network':
        return formatBytes
    }
  })
</script>

<div class="explorer">
  <div class="explorer__toolbar">
    <div class="tab-group">
      {#each TABS as tab (tab.value)}
        <button
          class="tab"
          class:tab--active={selectedTab === tab.value}
          onclick={() => (selectedTab = tab.value)}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <div class="controls">
      {#if availableGroupBy && availableGroupBy.length > 1}
        <div class="control-group">
          <span class="control-label">Group by</span>
          <div class="btn-group">
            {#each availableGroupBy as g (g.value)}
              <button
                class="btn-group__item"
                class:btn-group__item--active={selectedGroupBy === g.value}
                onclick={() => (selectedGroupBy = g.value)}
              >
                {g.label}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <div class="btn-group">
        {#each WINDOWS as w (w.value)}
          <button
            class="btn-group__item"
            class:btn-group__item--active={selectedWindow === w.value}
            onclick={() => (selectedWindow = w.value)}
          >
            {w.label}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="explorer__chart">
    {#if loading}
      <div class="chart-loading">
        <div class="chart-loading__bar"></div>
      </div>
    {:else if error}
      <div class="chart-error">{error}</div>
    {:else}
      <TimeSeriesChart series={activeSeries} formatValue={activeFormatter} />
    {/if}
  </div>
</div>

<style>
  .explorer {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .explorer__toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--color-border);
    flex-wrap: wrap;
  }

  .tab-group {
    display: flex;
    gap: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .tab {
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--color-text-muted);
    background: var(--color-bg-elevated);
    border: none;
    border-right: 1px solid var(--color-border);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .tab:last-child {
    border-right: none;
  }

  .tab--active {
    background: var(--color-accent);
    color: var(--color-accent-text);
  }

  .tab:not(.tab--active):hover {
    background: var(--color-bg-input);
    color: var(--color-text-primary);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .control-group {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .control-label {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .btn-group {
    display: flex;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .btn-group__item {
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--color-text-muted);
    background: var(--color-bg-elevated);
    border: none;
    border-right: 1px solid var(--color-border);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .btn-group__item:last-child {
    border-right: none;
  }

  .btn-group__item--active {
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    font-weight: 600;
  }

  .btn-group__item:not(.btn-group__item--active):hover {
    color: var(--color-text-primary);
    background: var(--color-bg-input);
  }

  .explorer__chart {
    padding: var(--space-4);
  }

  .chart-loading {
    height: 220px;
    display: flex;
    align-items: flex-end;
    padding-bottom: var(--space-4);
  }

  .chart-loading__bar {
    width: 100%;
    height: 2px;
    background: var(--color-border);
    border-radius: 1px;
    overflow: hidden;
    position: relative;
  }

  .chart-loading__bar::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--color-accent);
    animation: slide 1.2s ease-in-out infinite;
    transform: translateX(-100%);
  }

  @keyframes slide {
    to {
      transform: translateX(200%);
    }
  }

  .chart-error {
    height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-sm);
    color: var(--color-danger);
  }
</style>
