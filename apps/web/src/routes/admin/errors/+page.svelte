<script lang="ts">
  import { getErrors, getErrorRoutes } from './errors.remote'

  let fromDate = $state('')
  let toDate = $state('')
  let route = $state('')
  let offset = $state(0)
  const LIMIT = 50

  let queryKey = $state(0)
  function applyFilters() {
    offset = 0
    queryKey++
  }

  const routes = getErrorRoutes({})

  let expandedId = $state<string | null>(null)

  function formatDate(d: Date | string) {
    return new Date(d).toLocaleString()
  }
</script>

<svelte:head>
  <title>Errors — Admin — Slipstream</title>
</svelte:head>

<h1 class="page-title">Server Errors</h1>

<div class="filters">
  <label class="filter">
    <span>From</span>
    <input type="date" bind:value={fromDate} />
  </label>
  <label class="filter">
    <span>To</span>
    <input type="date" bind:value={toDate} />
  </label>
  <label class="filter">
    <span>Route</span>
    {#await routes}
      <select disabled><option>Loading…</option></select>
    {:then routeList}
      <select bind:value={route}>
        <option value="">All routes</option>
        {#each routeList as r (r)}
          <option value={r}>{r}</option>
        {/each}
      </select>
    {/await}
  </label>
  <button class="btn" onclick={applyFilters}>Apply</button>
  <button
    class="btn btn--ghost"
    onclick={() => {
      fromDate = ''
      toDate = ''
      route = ''
      applyFilters()
    }}
  >
    Clear
  </button>
</div>

{#key queryKey}
  {#await getErrors( { fromDate: fromDate || undefined, toDate: toDate || undefined, route: route || undefined, limit: LIMIT, offset } )}
    <p class="loading">Loading…</p>
  {:then result}
    {#if result.rows.length === 0}
      <p class="empty">No errors found.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Route</th>
              <th>Message</th>
              <th>User</th>
            </tr>
          </thead>
          <tbody>
            {#each result.rows as row (row.id)}
              <tr
                class="row"
                class:row--expanded={expandedId === row.id}
                onclick={() => (expandedId = expandedId === row.id ? null : row.id)}
              >
                <td class="cell cell--time">{formatDate(row.occurredAt)}</td>
                <td class="cell cell--route">{row.route ?? '—'}</td>
                <td class="cell cell--message">{row.message}</td>
                <td class="cell cell--user">{row.userEmail ?? '—'}</td>
              </tr>
              {#if expandedId === row.id}
                <tr class="detail-row">
                  <td colspan="4">
                    {#if row.stack}
                      <pre class="detail-block">{row.stack}</pre>
                    {/if}
                    {#if row.context}
                      <pre class="detail-block detail-block--context">{JSON.stringify(
                          JSON.parse(row.context),
                          null,
                          2
                        )}</pre>
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>

      <div class="pagination">
        <button
          class="btn btn--ghost"
          disabled={offset === 0}
          onclick={() => {
            offset = Math.max(0, offset - LIMIT)
            queryKey++
          }}
        >
          Previous
        </button>
        <span class="pagination__info">
          {offset + 1}–{Math.min(offset + LIMIT, result.total)} of {result.total}
        </span>
        <button
          class="btn btn--ghost"
          disabled={offset + LIMIT >= result.total}
          onclick={() => {
            offset += LIMIT
            queryKey++
          }}
        >
          Next
        </button>
      </div>
    {/if}
  {:catch}
    <p class="error">Failed to load errors.</p>
  {/await}
{/key}

<style>
  .page-title {
    margin: 0 0 var(--space-5);
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: flex-end;
    margin-bottom: var(--space-5);
  }

  .filter {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .filter input,
  .filter select {
    background: var(--color-bg-input);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    height: 28px;
  }

  .btn {
    height: 28px;
    padding: 0 var(--space-3);
    background: var(--color-accent);
    color: var(--color-accent-text);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    cursor: pointer;
    align-self: flex-end;
  }

  .btn--ghost {
    background: transparent;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
  }

  .btn--ghost:hover:not(:disabled) {
    color: var(--color-text-primary);
    background: var(--color-bg-hover);
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-sm);
  }

  th {
    text-align: left;
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-elevated);
    color: var(--color-text-muted);
    font-weight: 600;
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
  }

  .row {
    cursor: pointer;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .row:hover,
  .row--expanded {
    background: var(--color-bg-hover);
  }

  .cell {
    padding: var(--space-2) var(--space-3);
    vertical-align: top;
    color: var(--color-text-primary);
  }

  .cell--time {
    white-space: nowrap;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .cell--route {
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--color-text-link);
  }

  .cell--message {
    max-width: 400px;
    word-break: break-word;
  }

  .cell--user {
    white-space: nowrap;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
  }

  .detail-row td {
    padding: 0 var(--space-3) var(--space-3);
    background: var(--color-bg-elevated);
  }

  .detail-block {
    margin: var(--space-2) 0 0;
    padding: var(--space-3);
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--color-text-primary);
    overflow-x: auto;
    white-space: pre;
    max-height: 320px;
  }

  .detail-block--context {
    color: var(--color-text-link);
  }

  .pagination {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }

  .pagination__info {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .loading,
  .empty,
  .error {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .error {
    color: var(--color-danger);
  }
</style>
