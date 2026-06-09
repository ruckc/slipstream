<script lang="ts">
  import { page } from '$app/state'
  import { goto } from '$app/navigation'
  import { SvelteMap } from 'svelte/reactivity'
  import {
    getProjectSettings,
    updateProject,
    addUserPermission,
    removePermission,
    deleteProject,
  } from './settings.remote'
  import Button from '$lib/components/common/Button.svelte'
  import Input from '$lib/components/common/Input.svelte'
  import Icon from '$lib/components/common/Icon.svelte'
  import DeleteProjectModal from '$lib/components/common/DeleteProjectModal.svelte'

  const data = await getProjectSettings({
    namespace: page.params.namespace!,
    project: page.params.project!,
  })

  let addUserEmail = $state('')
  let addUserPerms = $state<string[]>(['files:read'])
  let deleteModalOpen = $state(false)

  const ALL_PERMS = ['files:read', 'files:write', 'shell', 'project:manage'] as const

  const PERM_LABELS: Record<string, string> = {
    'files:read': 'Read files',
    'files:write': 'Write files',
    shell: 'Shell access',
    'project:manage': 'Manage project',
  }

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

  async function handleDelete() {
    const result = await deleteProject({
      namespaceSlug: page.params.namespace!,
      projectSlug: page.params.project!,
    })
    goto(result.redirectTo)
  }
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
      <form {...updateProject} class="section-form">
        <input type="hidden" name="namespaceSlug" value={page.params.namespace!} />
        <input type="hidden" name="projectSlug" value={page.params.project!} />
        <Input
          label="Display name"
          name="displayName"
          value={data.project.displayName}
          required
          error={updateProject.fields.displayName?.issues()?.[0]?.message}
        />
        <Input
          label="Idle timeout (seconds)"
          name="idleTimeoutSeconds"
          type="text"
          value={String(data.project.idleTimeoutSeconds ?? '')}
          placeholder="Inherit from namespace"
          error={updateProject.fields.idleTimeoutSeconds?.issues()?.[0]?.message}
        />

        {#if updateProject.result?.success}
          <div class="form-success" role="status">Saved.</div>
        {/if}

        <div class="form-actions">
          <Button type="submit" variant="primary" loading={updateProject.pending > 0}>Save</Button>
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
                <Button
                  variant="ghost"
                  size="sm"
                  loading={removePermission.pending > 0}
                  onclick={() =>
                    removePermission({
                      namespaceSlug: page.params.namespace!,
                      projectSlug: page.params.project!,
                      principalType: group.principalType,
                      principalId: group.principalId,
                    })}
                >
                  Remove
                </Button>
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
          {...addUserPermission}
          class="section-form"
          {...addUserPermission.enhance(() => {
            addUserEmail = ''
            addUserPerms = ['files:read']
          })}
        >
          <input type="hidden" name="namespaceSlug" value={page.params.namespace!} />
          <input type="hidden" name="projectSlug" value={page.params.project!} />
          <Input
            label="User email"
            name="email"
            type="email"
            bind:value={addUserEmail}
            placeholder="user@example.com"
            required
            error={addUserPermission.fields.email?.issues()?.[0]?.message}
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

          {#if addUserPermission.result?.success}
            <div class="form-success" role="status">Access granted.</div>
          {/if}

          <div class="form-actions">
            <Button type="submit" variant="primary" loading={addUserPermission.pending > 0}>
              Grant access
            </Button>
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

<DeleteProjectModal
  bind:open={deleteModalOpen}
  project={data.project}
  loading={deleteProject.pending > 0}
  onconfirm={handleDelete}
/>

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

  @media (max-width: 639px) {
    .settings-page {
      padding: var(--space-4);
    }

    .section-form {
      max-width: 100%;
    }

    .perm-checkboxes__grid {
      grid-template-columns: 1fr;
    }
  }
</style>
