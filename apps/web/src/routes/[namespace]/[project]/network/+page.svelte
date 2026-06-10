<script lang="ts">
  import { page } from '$app/state'
  import { getNetworkActivity } from './network.remote'
  import Icon from '$lib/components/common/Icon.svelte'

  const data = await getNetworkActivity({
    namespace: page.params.namespace!,
    project: page.params.project!,
  })

  function formatTime(d: Date | string) {
    return new Date(d).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })
  }

  function flowLabel(flow: (typeof data.flows)[number]) {
    if (flow.flowType === 'dns') return flow.dnsQuery ?? '—'
    if (flow.flowType === 'http') {
      return `${flow.httpMethod ?? ''} ${flow.httpUrl ?? ''}`.trim()
    }
    return `${flow.destIp ?? '?'}:${flow.destPort ?? '?'}`
  }

  function verdictClass(verdict: string) {
    if (verdict === 'dropped') return 'verdict--dropped'
    if (verdict === 'forwarded') return 'verdict--forwarded'
    return 'verdict--other'
  }
</script>

<svelte:head>
  <title>Network — {data.project.displayName} — Slipstream</title>
</svelte:head>

<div class="network-page">
  <div class="network-header">
    <a href="/{page.params.namespace!}/{page.params.project!}" class="back-link">
      <Icon name="chevron-right" size={12} />
      {page.params.namespace!}/{page.params.project!}
    </a>
    <h1 class="network-title">Network Activity</h1>
    <p class="network-desc">
      Egress flows observed by Hubble from this project's pod (most recent first).
    </p>
  </div>

  <div class="flows-section">
    {#if data.flows.length === 0}
      <div class="empty">No flows recorded yet.</div>
    {:else}
      <table class="flows-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Type</th>
            <th>Verdict</th>
            <th>Protocol</th>
            <th>Destination</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {#each data.flows as flow (flow.id)}
            <tr>
              <td class="col-time">{formatTime(flow.observedAt)}</td>
              <td class="col-type"
                ><span class="badge badge--{flow.flowType}">{flow.flowType.toUpperCase()}</span></td
              >
              <td class="col-verdict"
                ><span class="verdict {verdictClass(flow.verdict)}">{flow.verdict}</span></td
              >
              <td class="col-proto">{flow.protocol ?? '—'}</td>
              <td class="col-dest">
                {#if flow.destIp}
                  {flow.destIp}{flow.destPort ? `:${flow.destPort}` : ''}
                {:else}
                  —
                {/if}
              </td>
              <td class="col-detail">{flowLabel(flow)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .network-page {
    max-width: 1100px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
  }

  .network-header {
    margin-bottom: var(--space-6);
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-decoration: none;
    margin-bottom: var(--space-3);
  }

  .back-link:hover {
    color: var(--color-text-primary);
  }

  .network-title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .network-desc {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .flows-section {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-bg-surface);
    overflow: hidden;
  }

  .empty {
    padding: var(--space-8);
    text-align: center;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .flows-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }

  .flows-table thead tr {
    border-bottom: 1px solid var(--color-border);
  }

  .flows-table th {
    padding: var(--space-2) var(--space-3);
    text-align: left;
    font-weight: 600;
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .flows-table td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle, var(--color-border));
    color: var(--color-text-primary);
    vertical-align: middle;
  }

  .flows-table tr:last-child td {
    border-bottom: none;
  }

  .flows-table tr:hover td {
    background: var(--color-bg-hover, rgba(0, 0, 0, 0.03));
  }

  .col-time {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .col-type,
  .col-verdict,
  .col-proto {
    white-space: nowrap;
  }

  .col-dest {
    font-family: var(--font-mono, monospace);
    font-size: var(--font-size-xs);
    white-space: nowrap;
  }

  .col-detail {
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    font-size: var(--font-size-xs);
    color: var(--color-text-secondary, var(--color-text-muted));
  }

  .badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .badge--dns {
    background: var(--color-accent-subtle, #e8f0fe);
    color: var(--color-accent, #1a73e8);
  }

  .badge--http {
    background: var(--color-success-subtle, #e6f4ea);
    color: var(--color-success, #1e8e3e);
  }

  .badge--l4 {
    background: var(--color-bg-muted, #f1f3f4);
    color: var(--color-text-secondary, #666);
  }

  .verdict {
    font-size: var(--font-size-xs);
    font-weight: 500;
  }

  .verdict--forwarded {
    color: var(--color-success, #1e8e3e);
  }

  .verdict--dropped {
    color: var(--color-danger, #d93025);
  }

  .verdict--other {
    color: var(--color-text-muted);
  }

  @media (max-width: 639px) {
    .network-page {
      padding: var(--space-4);
    }

    .col-detail {
      display: none;
    }
  }
</style>
