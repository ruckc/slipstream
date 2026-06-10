<script lang="ts">
  import { getBillingReport } from '$lib/remote/admin-billing.remote'
  import type { BillingRow } from '$lib/remote/admin-billing.remote'

  function defaultRange() {
    const to = new Date()
    const from = new Date(to.getFullYear(), to.getMonth(), 1) // start of current month
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    }
  }

  let range = $state(defaultRange())
  let reportPromise = $state<Promise<{ rows: BillingRow[]; from: string; to: string }> | null>(null)

  function load() {
    reportPromise = getBillingReport({ from: range.from, to: range.to + 'T23:59:59Z' })
  }

  load()

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '—'
    if (bytes < 1024) return `${bytes.toFixed(0)} B`
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  }

  function formatCpu(seconds: number): string {
    if (seconds === 0) return '—'
    if (seconds < 60) return `${seconds.toFixed(1)} s`
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`
    return `${(seconds / 3600).toFixed(2)} h`
  }

  function toCSV(rows: BillingRow[]): string {
    const header =
      'namespace,project,cpu_seconds,memory_byte_seconds,disk_bytes,ingress_bytes,egress_bytes'
    const lines = rows.map((r) =>
      [
        r.namespaceSlug,
        r.projectSlug,
        r.cpuSeconds,
        r.memoryByteSeconds,
        r.diskBytes,
        r.ingressBytes,
        r.egressBytes,
      ].join(',')
    )
    return [header, ...lines].join('\n')
  }

  function downloadCSV(rows: BillingRow[]) {
    const blob = new Blob([toCSV(rows)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `billing-${range.from}-${range.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
</script>

<svelte:head>
  <title>Billing Report — Admin — Slipstream</title>
</svelte:head>

<div class="billing-page">
  <div class="billing-header">
    <h1 class="billing-title">Billing Report</h1>
    <p class="billing-desc">Aggregated resource usage per project for the selected period.</p>
  </div>

  <div class="date-controls">
    <label class="date-field">
      <span class="date-label">From</span>
      <input class="date-input" type="date" bind:value={range.from} />
    </label>
    <label class="date-field">
      <span class="date-label">To</span>
      <input class="date-input" type="date" bind:value={range.to} />
    </label>
    <button class="run-btn" onclick={load}>Run report</button>
  </div>

  {#if reportPromise}
    {#await reportPromise}
      <div class="loading">Loading…</div>
    {:then report}
      <div class="report-toolbar">
        <span class="report-count"
          >{report.rows.length} project{report.rows.length !== 1 ? 's' : ''}</span
        >
        {#if report.rows.length > 0}
          <button class="csv-btn" onclick={() => downloadCSV(report.rows)}>Export CSV</button>
        {/if}
      </div>

      {#if report.rows.length === 0}
        <div class="empty">No usage data for this period.</div>
      {:else}
        <div class="table-wrap">
          <table class="billing-table">
            <thead>
              <tr>
                <th>Namespace</th>
                <th>Project</th>
                <th class="num">CPU time</th>
                <th class="num">Mem·s</th>
                <th class="num">Disk</th>
                <th class="num">Ingress</th>
                <th class="num">Egress</th>
              </tr>
            </thead>
            <tbody>
              {#each report.rows as row (row.projectId)}
                <tr>
                  <td>
                    <a href="/{row.namespaceSlug}/metrics" class="ns-link">{row.namespaceSlug}</a>
                  </td>
                  <td>
                    <a href="/{row.namespaceSlug}/{row.projectSlug}/metrics" class="proj-link">
                      {row.projectSlug}
                    </a>
                  </td>
                  <td class="num">{formatCpu(row.cpuSeconds)}</td>
                  <td class="num">{formatBytes(row.memoryByteSeconds)}</td>
                  <td class="num">{formatBytes(row.diskBytes)}</td>
                  <td class="num">{formatBytes(row.ingressBytes)}</td>
                  <td class="num">{formatBytes(row.egressBytes)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {:catch e}
      <div class="error">{e.message ?? 'Failed to load report'}</div>
    {/await}
  {/if}
</div>

<style>
  .billing-page {
    max-width: 1000px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
  }

  .billing-header {
    margin-bottom: var(--space-6);
  }

  .billing-title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .billing-desc {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .date-controls {
    display: flex;
    align-items: flex-end;
    gap: var(--space-3);
    margin-bottom: var(--space-5);
    flex-wrap: wrap;
  }

  .date-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .date-label {
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--color-text-muted);
  }

  .date-input {
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
  }

  .date-input:focus {
    outline: none;
    border-color: var(--color-accent);
  }

  .run-btn {
    padding: var(--space-2) var(--space-4);
    background: var(--color-accent);
    color: var(--color-accent-text);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast);
  }

  .run-btn:hover {
    background: var(--color-accent-hover);
  }

  .report-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }

  .report-count {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .csv-btn {
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-elevated);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .csv-btn:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-focus);
  }

  .table-wrap {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    overflow-x: auto;
  }

  .billing-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }

  .billing-table th,
  .billing-table td {
    padding: var(--space-2) var(--space-3);
    text-align: left;
    white-space: nowrap;
  }

  .billing-table thead th {
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    background: var(--color-bg-elevated);
    border-bottom: 1px solid var(--color-border);
  }

  .billing-table tbody tr {
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .billing-table tbody tr:last-child {
    border-bottom: none;
  }

  .billing-table tbody tr:hover td {
    background: var(--color-bg-elevated);
  }

  .num {
    text-align: right !important;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
  }

  .ns-link,
  .proj-link {
    color: var(--color-accent);
    text-decoration: none;
  }

  .ns-link:hover,
  .proj-link:hover {
    text-decoration: underline;
  }

  .loading,
  .empty {
    padding: var(--space-6) 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .error {
    padding: var(--space-4);
    color: var(--color-danger);
    font-size: var(--font-size-sm);
    border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-danger) 8%, transparent);
  }

  @media (max-width: 639px) {
    .billing-page {
      padding: var(--space-4);
    }
  }
</style>
