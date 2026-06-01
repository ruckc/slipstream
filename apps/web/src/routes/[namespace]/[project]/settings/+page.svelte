<script lang="ts">
  import { untrack } from 'svelte'
  import { enhance } from '$app/forms'
  import { SvelteMap } from 'svelte/reactivity'
  import type { PageData, ActionData } from './$types'
  import Button from '$lib/components/common/Button.svelte'
  import Input from '$lib/components/common/Input.svelte'
  import Icon from '$lib/components/common/Icon.svelte'
  import Modal from '$lib/components/common/Modal.svelte'

  let { data, form }: { data: PageData; form: ActionData } = $props()

  let displayName = $state(untrack(() => data.project.displayName))
  let idleTimeout = $state(untrack(() => String(data.project.idleTimeoutSeconds ?? '')))
  let updateLoading = $state(false)

  // Add user permission form
  let addUserEmail = $state('')
  let addUserPerms = $state<string[]>(['files:read'])
  let addUserLoading = $state(false)

  // Delete confirmation
  let deleteModalOpen = $state(false)
  let deleteConfirmText = $state('')
  let deleteLoading = $state(false)

  const ALL_PERMS = ['files:read', 'files:write', 'shell', 'project:manage'] as const

  const PERM_LABELS: Record<string, string> = {
    'files:read': 'Read files',
    'files:write': 'Write files',
    shell: 'Shell access',
    'project:manage': 'Manage project',
  }

  // Group grants by principal
  type GrantGroup = {
    principalType: 'user' | 'org'
    principalId: string
    permissions: string[]
  }

  const grantGroups = $derived(() => {
    const map = new SvelteMap<string, GrantGroup>()
    for (const g of data.grants) {
      const key = `${g.principalType}:${g.principalId}`
      const existing = map.get(key)
      if (existing) existing.permissions.push(g.permission)
      else
        map.set(key, {
          principalType: g.principalType as 'user' | 'org',
          principalId: g.principalId,
          permissions: [g.permission],
        })
    }
    return Array.from(map.values())
  })

  function toggleAddUserPerm(p: string) {
    if (addUserPerms.includes(p)) {
      addUserPerms = addUserPerms.filter((x) => x !== p)
    } else {
      addUserPerms = [...addUserPerms, p]
    }
  }

  const canDelete = $derived(deleteConfirmText === data.project.slug)
</script>

<svelte:head>
  <title>Settings — {data.project.displayName} — Slipstream</title>
</svelte:head>

<div class="settings-page">
  <div class="settings-header">
    <a href="/{data.namespace.slug}/{data.project.slug}" class="back-link">
      <Icon name="chevron-right" size={12} />
      {data.namespace.slug}/{data.project.slug}
    </a>
    <h1 class="settings-title">Project Settings</h1>
  </div>

  <div class="settings-sections">
    <!-- General -->
    <section class="settings-section">
      <h2 class="section-title">General</h2>
      <form
        method="POST"
        action="?/updateProject"
        class="section-form"
        use:enhance={() => {
          updateLoading = true
          return async ({ update }) => {
            updateLoading = false
            await update()
          }
        }}
      >
        <Input label="Display name" name="displayName" bind:value={displayName} required />
        <Input
          label="Idle timeout (seconds)"
          name="idleTimeoutSeconds"
          type="text"
          bind:value={idleTimeout}
          placeholder="Inherit from namespace"
        />

        {#if form?.error && !form?.addUser}
          <div class="form-error" role="alert">{form.error}</div>
        {/if}
        {#if form?.success && !form?.addUser}
          <div class="form-success" role="status">Saved.</div>
        {/if}

        <div class="form-actions">
          <Button type="submit" variant="primary" loading={updateLoading}>Save</Button>
        </div>
      </form>
    </section>

    <!-- Permissions -->
    <section class="settings-section">
      <h2 class="section-title">Access &amp; Permissions</h2>

      {#if grantGroups().length > 0}
        <div class="grants-table">
          <div class="grants-header">
            <span>Principal</span>
            {#each ALL_PERMS as perm (perm)}
              <span class="perm-col" title={PERM_LABELS[perm]}>{perm}</span>
            {/each}
            <span></span>
          </div>
          {#each grantGroups() as group (group.principalType + ':' + group.principalId)}
            <div class="grants-row">
              <span class="grants-row__principal">
                <Icon name={group.principalType === 'org' ? 'org' : 'user'} size={12} />
                <span class="grants-row__id">{group.principalId}</span>
              </span>
              {#each ALL_PERMS as perm (perm)}
                <span class="perm-cell">
                  {#if group.permissions.includes(perm)}
                    <Icon name="check" size={12} />
                  {/if}
                </span>
              {/each}
              <span class="grants-row__action">
                <form method="POST" action="?/setPermissions" use:enhance>
                  <!-- Submit with empty grants to remove this principal's access -->
                  <Button type="submit" variant="ghost" size="sm">Remove</Button>
                </form>
              </span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="grants-empty">No explicit grants. Project owner has full access.</p>
      {/if}

      <!-- Add user permission -->
      <div class="add-user-form">
        <h3 class="add-user-title">Add user access</h3>
        <form
          method="POST"
          action="?/addUserPermission"
          class="section-form"
          use:enhance={() => {
            addUserLoading = true
            return async ({ update }) => {
              addUserLoading = false
              addUserEmail = ''
              addUserPerms = ['files:read']
              await update()
            }
          }}
        >
          <Input
            label="User email"
            name="email"
            type="email"
            bind:value={addUserEmail}
            placeholder="user@example.com"
            required
            error={form?.addUser && form?.error ? form.error : undefined}
          />

          <div class="perm-checkboxes">
            <span class="perm-checkboxes__label">Permissions</span>
            <div class="perm-checkboxes__grid">
              {#each ALL_PERMS as perm (perm)}
                <label class="perm-checkbox">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={perm}
                    checked={addUserPerms.includes(perm)}
                    onchange={() => toggleAddUserPerm(perm)}
                  />
                  {PERM_LABELS[perm]}
                </label>
              {/each}
            </div>
          </div>

          {#if form?.addUser && form?.success}
            <div class="form-success" role="status">Access granted.</div>
          {/if}

          <div class="form-actions">
            <Button type="submit" variant="primary" loading={addUserLoading}>Grant access</Button>
          </div>
        </form>
      </div>
    </section>

    <!-- Danger zone -->
    <section class="settings-section settings-section--danger">
      <h2 class="section-title section-title--danger">Danger zone</h2>
      <div class="danger-row">
        <div>
          <div class="danger-label">Delete this project</div>
          <div class="danger-desc">
            Permanently deletes the project, its PVC, and all data. This cannot be undone.
          </div>
        </div>
        <Button variant="danger" onclick={() => (deleteModalOpen = true)}>Delete project</Button>
      </div>
    </section>
  </div>
</div>

<!-- Delete modal -->
<Modal title="Delete project" bind:open={deleteModalOpen}>
  <div class="delete-modal">
    <p class="delete-modal__warning">
      This will permanently delete <strong>{data.project.displayName}</strong> and all its workspace data.
      This action cannot be undone.
    </p>
    <p class="delete-modal__confirm-label">
      Type <code class="delete-modal__slug">{data.project.slug}</code> to confirm:
    </p>
    <input
      class="delete-modal__input"
      type="text"
      bind:value={deleteConfirmText}
      placeholder={data.project.slug}
      autocomplete="off"
    />
    <div class="delete-modal__actions">
      <Button variant="secondary" onclick={() => (deleteModalOpen = false)}>Cancel</Button>
      <form method="POST" action="?/deleteProject">
        <Button type="submit" variant="danger" disabled={!canDelete} loading={deleteLoading}>
          Delete project
        </Button>
      </form>
    </div>
  </div>
</Modal>

<style>
  .settings-page {
    max-width: 680px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
  }

  .settings-header {
    margin-bottom: var(--space-8);
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

  .settings-title {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .settings-sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .settings-section {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    background: var(--color-bg-surface);
  }

  .settings-section--danger {
    border-color: color-mix(in srgb, var(--color-danger) 40%, transparent);
  }

  .section-title {
    margin: 0 0 var(--space-4);
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .section-title--danger {
    color: var(--color-danger);
  }

  .section-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 420px;
  }

  .form-actions {
    display: flex;
    justify-content: flex-start;
  }

  .form-error {
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--color-danger) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-danger) 30%, transparent);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    color: var(--color-danger);
  }

  .form-success {
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--color-success) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-success) 30%, transparent);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    color: var(--color-success);
  }

  /* Grants table */
  .grants-table {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow: hidden;
    margin-bottom: var(--space-4);
    font-size: var(--font-size-xs);
  }

  .grants-header,
  .grants-row {
    display: grid;
    grid-template-columns: 2fr repeat(4, 1fr) auto;
    align-items: center;
    padding: var(--space-2) var(--space-3);
    gap: var(--space-2);
  }

  .grants-header {
    background: var(--color-bg-elevated);
    font-weight: 600;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
    font-size: var(--font-size-xs);
  }

  .grants-row {
    border-bottom: 1px solid var(--color-border-subtle);
    color: var(--color-text-primary);
  }

  .grants-row:last-child {
    border-bottom: none;
  }

  .perm-col {
    font-family: var(--font-mono);
    font-size: 10px;
    text-align: center;
  }

  .perm-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-success);
  }

  .grants-row__principal {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--color-text-muted);
    overflow: hidden;
  }

  .grants-row__id {
    font-family: var(--font-mono);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grants-empty {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    margin: 0 0 var(--space-4);
  }

  /* Add user */
  .add-user-form {
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border-subtle);
  }

  .add-user-title {
    margin: 0 0 var(--space-3);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .perm-checkboxes {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .perm-checkboxes__label {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .perm-checkboxes__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-1);
  }

  .perm-checkbox {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    cursor: pointer;
  }

  /* Danger zone */
  .danger-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .danger-label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--color-text-primary);
    margin-bottom: var(--space-1);
  }

  .danger-desc {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    max-width: 380px;
  }

  /* Delete modal */
  .delete-modal {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .delete-modal__warning {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
  }

  .delete-modal__confirm-label {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .delete-modal__slug {
    background: var(--color-bg-input);
    padding: 1px 4px;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
  }

  .delete-modal__input {
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
    height: 28px;
    width: 100%;
    transition: border-color var(--transition-fast);
  }

  .delete-modal__input:focus {
    border-color: var(--color-danger);
    outline: none;
  }

  .delete-modal__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
