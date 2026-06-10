<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import uPlot from 'uplot'
  import 'uplot/dist/uPlot.min.css'
  import type { MetricSeriesData } from '$lib/remote/metrics.remote'

  type Props = {
    series: MetricSeriesData[]
    formatValue?: (v: number) => string
    unit?: string
  }

  let { series, formatValue, unit = '' }: Props = $props()

  let container: HTMLDivElement = $state()!
  let chart: uPlot | null = null

  const PALETTE = [
    '#4f8ef7',
    '#f7974f',
    '#4ff79a',
    '#f74f6e',
    '#b74ff7',
    '#4fd4f7',
    '#f7e44f',
    '#f74fc8',
  ]

  function buildData(s: MetricSeriesData[]): uPlot.AlignedData {
    if (s.length === 0) return [[], []]
    const timestamps = s[0].series.timestamps
    return [timestamps, ...s.map((item) => item.series.values)]
  }

  function buildOpts(s: MetricSeriesData[], width: number): uPlot.Options {
    return {
      width,
      height: 220,
      cursor: { show: true },
      legend: { show: s.length > 1 },
      axes: [
        {
          stroke: 'var(--color-text-muted)',
          grid: { stroke: 'var(--color-border-subtle)', width: 1 },
          ticks: { stroke: 'var(--color-border-subtle)' },
        },
        {
          stroke: 'var(--color-text-muted)',
          grid: { stroke: 'var(--color-border-subtle)', width: 1 },
          ticks: { stroke: 'var(--color-border-subtle)' },
          values: formatValue
            ? (_u, vals) => vals.map((v) => (v != null ? formatValue(v) : ''))
            : undefined,
          size: 72,
        },
      ],
      series: [
        {},
        ...s.map((item, i) => ({
          label: item.label,
          stroke: PALETTE[i % PALETTE.length],
          width: 1.5,
          fill: `${PALETTE[i % PALETTE.length]}18`,
          value: formatValue
            ? (_u: uPlot, v: number) => (v != null ? formatValue(v) + unit : '—')
            : undefined,
        })),
      ],
    }
  }

  function createChart() {
    if (!container || series.length === 0) return
    chart?.destroy()
    const opts = buildOpts(series, container.clientWidth || 600)
    chart = new uPlot(opts, buildData(series), container)
  }

  $effect(() => {
    void series
    if (container) createChart()
  })

  const ro =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          if (chart && container) chart.setSize({ width: container.clientWidth, height: 220 })
        })
      : null

  onMount(() => {
    createChart()
    if (ro) ro.observe(container)
  })

  onDestroy(() => {
    chart?.destroy()
    ro?.disconnect()
  })
</script>

<div class="chart-wrap">
  {#if series.length === 0 || series[0].series.timestamps.length === 0}
    <div class="chart-empty">No data for this window</div>
  {:else}
    <div bind:this={container} class="chart-container"></div>
  {/if}
</div>

<style>
  .chart-wrap {
    width: 100%;
  }

  .chart-container {
    width: 100%;
  }

  /* Override uPlot defaults to match our theme */
  .chart-container :global(.u-wrap) {
    background: transparent;
  }

  .chart-container :global(.u-legend) {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    margin-top: var(--space-2);
  }

  .chart-empty {
    height: 220px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }
</style>
