<script lang="ts">
  import type { MetricsRow } from '$lib/remote/metrics.remote'

  type Props = {
    rows: MetricsRow[]
  }

  let { rows }: Props = $props()

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '—'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  function formatCpu(seconds: number): string {
    if (seconds === 0) return '—'
    if (seconds < 60) return `${seconds.toFixed(1)} s`
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`
    return `${(seconds / 3600).toFixed(2)} h`
  }

  const totals = $derived({
    cpu: rows.reduce((s, r) => s + r.cpu, 0),
    memory: rows.reduce((s, r) => s + r.memory, 0),
    disk: rows.reduce((s, r) => s + r.disk, 0),
    ingress: rows.reduce((s, r) => s + r.ingress, 0),
    egress: rows.reduce((s, r) => s + r.egress, 0),
  })
</script>

{#if rows.length === 0}
  <div class="empty">No metrics data available.</div>
{:else}
  <div class="metrics-wrap">
    <table class="metrics-table">
      <thead>
        <tr>
          <th class="col-name">Name</th>
          <th class="col-num">CPU time</th>
          <th class="col-num">Memory</th>
          <th class="col-num">Disk</th>
          <th class="col-num">Ingress</th>
          <th class="col-num">Egress</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr>
            <td class="col-name">
              {#if row.href}
                <a href={row.href} class="row-link">{row.label}</a>
              {:else}
                {row.label}
              {/if}
            </td>
            <td class="col-num">{formatCpu(row.cpu)}</td>
            <td class="col-num">{formatBytes(row.memory)}</td>
            <td class="col-num">{formatBytes(row.disk)}</td>
            <td class="col-num">{formatBytes(row.ingress)}</td>
            <td class="col-num">{formatBytes(row.egress)}</td>
          </tr>
        {/each}
      </tbody>
      {#if rows.length > 1}
        <tfoot>
          <tr class="totals-row">
            <td class="col-name">Total</td>
            <td class="col-num">{formatCpu(totals.cpu)}</td>
            <td class="col-num">{formatBytes(totals.memory)}</td>
            <td class="col-num">{formatBytes(totals.disk)}</td>
            <td class="col-num">{formatBytes(totals.ingress)}</td>
            <td class="col-num">{formatBytes(totals.egress)}</td>
          </tr>
        </tfoot>
      {/if}
    </table>
  </div>
{/if}

<style>
  .empty {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    padding: var(--space-4) 0;
  }

  .metrics-wrap {
    overflow-x: auto;
  }

  .metrics-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }

  .metrics-table th,
  .metrics-table td {
    padding: var(--space-2) var(--space-3);
    text-align: left;
    white-space: nowrap;
  }

  .metrics-table thead th {
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
  }

  .metrics-table thead th:first-child {
    border-radius: var(--radius-sm) 0 0 0;
  }

  .metrics-table thead th:last-child {
    border-radius: 0 var(--radius-sm) 0 0;
  }

  .metrics-table tbody tr {
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .metrics-table tbody tr:last-child {
    border-bottom: none;
  }

  .metrics-table tbody tr:hover td {
    background: var(--color-bg-elevated);
  }

  .col-name {
    min-width: 140px;
    color: var(--color-text-primary);
    font-weight: 500;
  }

  .col-num {
    text-align: right !important;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
    min-width: 90px;
  }

  .row-link {
    color: var(--color-accent);
    text-decoration: none;
  }

  .row-link:hover {
    text-decoration: underline;
  }

  .totals-row td {
    border-top: 2px solid var(--color-border);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .totals-row .col-num {
    color: var(--color-text-primary);
  }
</style>
