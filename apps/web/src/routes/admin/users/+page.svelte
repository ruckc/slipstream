<script lang="ts">
  import { page } from '$app/state'
  import { listUsers, setUserRole } from './users.remote'
  import type { UserRow } from './users.remote'

  const usersQuery = listUsers({})

  let localRoles = $state<Record<string, 'admin' | 'user'>>({})
  let saving = $state<Record<string, boolean>>({})
  let errors = $state<Record<string, string>>({})

  const currentUserId = $derived(page.data.user?.id as string)

  function roleFor(u: UserRow) {
    return localRoles[u.id] ?? (u.role as 'admin' | 'user')
  }

  async function changeRole(u: UserRow, newRole: 'admin' | 'user') {
    localRoles[u.id] = newRole
    saving[u.id] = true
    errors[u.id] = ''
    try {
      await setUserRole({ targetUserId: u.id, role: newRole })
    } catch (e: unknown) {
      errors[u.id] = e instanceof Error ? e.message : 'Failed to save'
      localRoles[u.id] = u.role as 'admin' | 'user'
    } finally {
      saving[u.id] = false
    }
  }

  function formatDate(d: Date | string) {
    return new Date(d).toLocaleDateString()
  }
</script>

<svelte:head>
  <title>Users — Admin — Slipstream</title>
</svelte:head>

<h1 class="page-title">Users</h1>

{#await usersQuery}
  <p class="loading">Loading…</p>
{:then userList}
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>User</th>
          <th>Email</th>
          <th>Joined</th>
          <th>Role</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each userList as u (u.id)}
          {@const isSelf = u.id === currentUserId}
          <tr class="row">
            <td class="cell cell--name">
              <a href="/{u.namespaceSlug}" class="user-link">
                {u.displayName}
              </a>
            </td>
            <td class="cell">{u.email}</td>
            <td class="cell cell--date">{formatDate(u.createdAt!)}</td>
            <td class="cell">
              {#if isSelf}
                <span class="role-badge role-badge--{roleFor(u)}">{roleFor(u)}</span>
                <span class="self-note" title="Cannot change your own role">you</span>
              {:else}
                <select
                  class="role-select"
                  value={roleFor(u)}
                  disabled={saving[u.id]}
                  onchange={(e) =>
                    changeRole(u, (e.currentTarget as HTMLSelectElement).value as 'admin' | 'user')}
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              {/if}
            </td>
            <td class="cell cell--status">
              {#if saving[u.id]}
                <span class="status-saving">Saving…</span>
              {:else if errors[u.id]}
                <span class="status-error">{errors[u.id]}</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:catch}
  <p class="error">Failed to load users.</p>
{/await}

<style>
  .page-title {
    margin: 0 0 var(--space-5);
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text-primary);
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
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .row:last-child {
    border-bottom: none;
  }

  .cell {
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-primary);
    vertical-align: middle;
  }

  .cell--date {
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .cell--status {
    width: 80px;
  }

  .cell--name {
    white-space: nowrap;
  }

  .user-link {
    color: var(--color-text-link);
    text-decoration: none;
  }

  .user-link:hover {
    text-decoration: underline;
  }

  .role-select {
    background: var(--color-bg-input);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    padding: 2px var(--space-2);
  }

  .role-badge {
    display: inline-block;
    padding: 2px var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
    font-weight: 600;
    background: var(--color-bg-elevated);
    color: var(--color-text-muted);
  }

  .role-badge--admin {
    background: rgba(0, 120, 212, 0.15);
    color: var(--color-accent);
  }

  .self-note {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    margin-left: var(--space-2);
  }

  .status-saving {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .status-error {
    font-size: var(--font-size-xs);
    color: var(--color-danger);
  }

  .loading,
  .error {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .error {
    color: var(--color-danger);
  }
</style>
