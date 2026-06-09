<script lang="ts">
  import { getDashboardStats } from '$lib/remote/admin.remote'

  const stats = getDashboardStats()
</script>

<svelte:head>
  <title>Admin — Slipstream</title>
</svelte:head>

<div class="dashboard">
  <h1 class="dashboard__title">Dashboard</h1>

  {#await stats}
    <div class="cards">
      {#each [1, 2, 3] as _, i (i)}
        <div class="card card--loading"></div>
      {/each}
    </div>
  {:then s}
    <div class="cards">
      <a href="/admin/errors" class="card">
        <span class="card__value">{s.errorCount}</span>
        <span class="card__label">Errors (last 24 h)</span>
      </a>
      <a href="/admin/users" class="card">
        <span class="card__value">{s.userCount}</span>
        <span class="card__label">Total users</span>
      </a>
      <a href="/admin/infra" class="card">
        <span class="card__value">{s.activePodCount}</span>
        <span class="card__label">Active pods</span>
      </a>
    </div>
  {:catch}
    <p class="error">Failed to load stats.</p>
  {/await}
</div>

<style>
  .dashboard__title {
    margin: 0 0 var(--space-6);
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: var(--space-4);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-5);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    text-decoration: none;
    color: inherit;
    transition: border-color var(--transition-fast);
    min-height: 96px;
  }

  .card:hover {
    border-color: var(--color-accent);
    text-decoration: none;
  }

  .card--loading {
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  .card__value {
    font-size: 2rem;
    font-weight: 700;
    color: var(--color-text-primary);
    line-height: 1;
  }

  .card__label {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .error {
    color: var(--color-danger);
    font-size: var(--font-size-sm);
  }
</style>
