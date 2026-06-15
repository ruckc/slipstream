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
    updateProjectEgressFilterEnabled,
    addProjectEgressRule,
    removeProjectEgressRule,
    toggleKubeDeployAccess,
    expandStorage,
  } from '$lib/remote/project-settings.remote'
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

  let projectEgressAllowRules = $state(data.projectEgressAllowRules)
  let newAllowDomain = $state('')
  let newAllowPorts = $state('80,443')
  const egressEnabled = $derived(
    data.project.egressFilterEnabled ?? data.namespaceEgressFilterEnabled
  )
  const forceMode = $derived(
    data.namespaceEgressListMode === 'force' && data.namespaceEgressFilterEnabled
  )

  async function toggleProjectEgressFilter() {
    const current = data.project.egressFilterEnabled
    // Cycle: null (inherit) → true → false → null
    const next = current === null ? true : current === true ? false : null
    await updateProjectEgressFilterEnabled({
      namespaceSlug: page.params.namespace!,
      projectSlug: page.params.project!,
      enabled: next,
    })
    data.project.egressFilterEnabled = next
  }

  async function addAllowRule() {
    const domain = newAllowDomain.trim().toLowerCase()
    const ports = newAllowPorts
      .split(',')
      .map((p) => parseInt(p.trim(), 10))
      .filter((p) => !isNaN(p) && p > 0)
    if (!domain || ports.length === 0) return
    const rule = await addProjectEgressRule({
      namespaceSlug: page.params.namespace!,
      projectSlug: page.params.project!,
      domain,
      ports,
    })
    projectEgressAllowRules = [...projectEgressAllowRules, rule]
    newAllowDomain = ''
    newAllowPorts = '80,443'
  }

  async function removeAllowRule(ruleId: string) {
    await removeProjectEgressRule({
      namespaceSlug: page.params.namespace!,
      projectSlug: page.params.project!,
      ruleId,
    })
    projectEgressAllowRules = projectEgressAllowRules.filter((r) => r.id !== ruleId)
  }

  async function handleDelete() {
    const result = await deleteProject({
      namespaceSlug: page.params.namespace!,
      projectSlug: page.params.project!,
    })
    goto(result.redirectTo)
  }

  let newStorageGb = $state(data.project.storageSizeGb)
  let storageExpandBusy = $state(false)
  let storageExpandError = $state<string | null>(null)
  let storageExpandSuccess = $state(false)

  async function handleExpandStorage() {
    storageExpandError = null
    storageExpandSuccess = false
    if (newStorageGb <= data.project.storageSizeGb) {
      storageExpandError = 'New size must be larger than current size'
      return
    }
    storageExpandBusy = true
    try {
      await expandStorage({
        namespaceSlug: page.params.namespace!,
        projectSlug: page.params.project!,
        storageSizeGb: newStorageGb,
      })
      storageExpandSuccess = true
    } catch (e) {
      storageExpandError = e instanceof Error ? e.message : 'Failed to expand storage'
    } finally {
      storageExpandBusy = false
    }
  }

  let kubeDeployAccess = $state(data.project.kubeDeployAccess)
  let kubeDeployConfirmPending = $state<boolean | null>(null)

  async function handleKubeDeployToggle() {
    const next = !kubeDeployAccess
    if (data.projectPhase === 'Running') {
      kubeDeployConfirmPending = next
      return
    }
    await applyKubeDeployToggle(next)
  }

  async function confirmKubeDeployToggle() {
    if (kubeDeployConfirmPending === null) return
    await applyKubeDeployToggle(kubeDeployConfirmPending)
    kubeDeployConfirmPending = null
  }

  async function applyKubeDeployToggle(next: boolean) {
    await toggleKubeDeployAccess({
      namespaceSlug: page.params.namespace!,
      projectSlug: page.params.project!,
      enabled: next,
    })
    kubeDeployAccess = next
  }
</script>

<svelte:head>
  <title>Settings — {data.project.displayName} — Slipstream</title>
</svelte:head>

<div class="settings-page">
  <div class="settings-header">
    <div class="settings-header__nav">
      <a href="/{data.namespace.slug}/{data.project.slug}" class="back-link">
        <Icon name="chevron-right" size={12} />
        {data.namespace.slug}/{data.project.slug}
      </a>
      <a href="/{data.namespace.slug}/{data.project.slug}/metrics" class="back-link">
        <Icon name="metrics" size={12} />
        Metrics
      </a>
    </div>
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

    <!-- Storage -->
    <section class="settings-section">
      <h2 class="section-title">Storage</h2>
      <p class="section-desc">
        Current size: <strong>{data.project.storageSizeGb} GB</strong>. Storage can only be
        increased. The workspace (<code>/workspace</code>) and home (<code>/home/agent</code>)
        directories share this volume.
      </p>
      <div class="storage-expand">
        <div class="storage-input-row">
          <label class="storage-label" for="new-storage-gb">New size (GB)</label>
          <input
            id="new-storage-gb"
            type="number"
            min={data.project.storageSizeGb + 1}
            max="500"
            class="storage-input"
            bind:value={newStorageGb}
          />
        </div>
        {#if storageExpandError}
          <p class="form-error">{storageExpandError}</p>
        {/if}
        {#if storageExpandSuccess}
          <p class="form-success">
            Storage expansion requested. It may take a few minutes to apply.
          </p>
        {/if}
        <div class="form-actions">
          <Button
            variant="primary"
            loading={storageExpandBusy}
            onclick={handleExpandStorage}
            disabled={newStorageGb <= data.project.storageSizeGb}
          >
            Expand storage
          </Button>
        </div>
      </div>
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

    <!-- Egress filtering -->
    <section class="settings-section">
      <div class="section-header-row">
        <div>
          <h2 class="section-title">Egress filtering</h2>
          <p class="section-desc">
            {#if data.namespaceEgressFilterEnabled}
              Namespace egress filtering is <strong>on</strong>. This project inherits it.
              {data.project.egressFilterEnabled === true
                ? 'Project also explicitly enables filtering.'
                : data.project.egressFilterEnabled === false
                  ? 'Project override: disabled (has no effect while namespace filtering is on).'
                  : 'Project override: inherit (following namespace).'}
            {:else}
              Namespace egress filtering is <strong>off</strong>. Enable here to restrict this
              project only.
            {/if}
          </p>
        </div>
        <button
          class="toggle"
          class:toggle--on={egressEnabled}
          class:toggle--inherit={data.project.egressFilterEnabled === null}
          onclick={toggleProjectEgressFilter}
          title={data.project.egressFilterEnabled === null
            ? 'Inheriting from namespace — click to override'
            : data.project.egressFilterEnabled
              ? 'Filtering on — click to turn off'
              : 'Filtering off — click to inherit'}
        >
          <span class="toggle-thumb"></span>
        </button>
      </div>

      {#if egressEnabled}
        {#if forceMode}
          <p class="egress-force-notice">
            Namespace is in <strong>force</strong> mode — only namespace allow-list rules apply to this
            project. Add project-specific rules in namespace settings.
          </p>
        {:else}
          <div class="egress-subsection">
            <h3 class="subsection-title">Project allow rules</h3>
            <p class="subsection-desc">
              These rules are merged with namespace rules. Patterns: <code>api.example.com</code>,
              <code>*.example.com</code>, <code>**.example.com</code>
            </p>
            <div class="rule-list">
              {#each projectEgressAllowRules as rule (rule.id)}
                <div class="rule-row">
                  <code class="rule-domain">{rule.domain}</code>
                  <span class="rule-ports">:{rule.ports.join(', ')}</span>
                  <button
                    class="rule-remove"
                    onclick={() => removeAllowRule(rule.id)}
                    aria-label="Remove rule">×</button
                  >
                </div>
              {/each}
            </div>
            <div class="rule-add-row">
              <input
                class="rule-input"
                type="text"
                placeholder="api.example.com or **.example.com"
                bind:value={newAllowDomain}
                onkeydown={(e) => e.key === 'Enter' && addAllowRule()}
              />
              <input
                class="rule-ports-input"
                type="text"
                placeholder="80,443"
                bind:value={newAllowPorts}
                onkeydown={(e) => e.key === 'Enter' && addAllowRule()}
              />
              <Button variant="secondary" size="sm" onclick={addAllowRule}>Add</Button>
            </div>
          </div>
        {/if}
      {/if}
    </section>

    <!-- Kubernetes deploy access -->
    <section class="settings-section">
      <div class="section-header-row">
        <div>
          <h2 class="section-title">Kubernetes deploy access</h2>
          <p class="section-desc">
            Grant the agent pod a ServiceAccount that can manage Deployments, StatefulSets, and
            Services in its own project namespace. Services are restricted from using
            <code>externalIPs</code>. Privileged pods are blocked via namespace Pod Security
            Standards.
            {#if kubeDeployAccess && data.projectPhase === 'Running'}
              <br /><strong>Active</strong> — the pod has deploy access.
            {/if}
          </p>
        </div>
        <button
          class="toggle"
          class:toggle--on={kubeDeployAccess}
          onclick={handleKubeDeployToggle}
          title={kubeDeployAccess
            ? 'Deploy access on — click to disable'
            : 'Deploy access off — click to enable'}
        >
          <span class="toggle-thumb"></span>
        </button>
      </div>

      {#if kubeDeployConfirmPending !== null}
        <div class="kube-confirm-dialog">
          <p class="kube-confirm-msg">
            {kubeDeployConfirmPending
              ? 'Enabling deploy access requires restarting the pod.'
              : 'Disabling deploy access requires restarting the pod.'}
            The project is currently running — continue?
          </p>
          <div class="kube-confirm-actions">
            <Button
              variant="primary"
              size="sm"
              loading={toggleKubeDeployAccess.pending > 0}
              onclick={confirmKubeDeployToggle}
            >
              Restart and {kubeDeployConfirmPending ? 'enable' : 'disable'}
            </Button>
            <Button variant="ghost" size="sm" onclick={() => (kubeDeployConfirmPending = null)}>
              Cancel
            </Button>
          </div>
        </div>
      {/if}
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

  .settings-header__nav {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
  }

  .settings-header__nav .back-link {
    margin-bottom: 0;
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

  .storage-expand {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 300px;
  }

  .storage-input-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .storage-label {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .storage-input {
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-input);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    width: 120px;
  }
  .storage-input:focus {
    outline: none;
    border-color: var(--color-border-focus);
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

  /* Egress filtering */
  .section-header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
  }

  .section-header-row .section-title {
    margin-bottom: var(--space-1);
  }

  .section-header-row .section-desc {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    max-width: 460px;
  }

  .toggle {
    flex-shrink: 0;
    width: 40px;
    height: 22px;
    border-radius: 11px;
    border: none;
    padding: 2px;
    cursor: pointer;
    background: var(--color-border);
    transition: background 0.15s;
    position: relative;
  }

  .toggle--on {
    background: var(--color-accent);
  }

  .toggle--inherit {
    opacity: 0.7;
  }

  .toggle-thumb {
    display: block;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    transition: transform 0.15s;
  }

  .toggle--on .toggle-thumb {
    transform: translateX(18px);
  }

  .egress-force-notice {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    padding: var(--space-3);
    background: var(--color-bg-elevated);
    border-radius: var(--radius-md);
    margin: var(--space-3) 0 0;
  }

  .egress-subsection {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border-subtle);
  }

  .subsection-title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .subsection-desc {
    margin: 0 0 var(--space-3);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .rule-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
  }

  .rule-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-elevated);
    border-radius: var(--radius-md);
  }

  .rule-domain {
    flex: 1;
    font-size: var(--font-size-xs);
    color: var(--color-text-primary);
  }

  .rule-ports {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .rule-remove {
    background: none;
    border: none;
    padding: 0 var(--space-1);
    cursor: pointer;
    color: var(--color-text-muted);
    font-size: var(--font-size-md);
    line-height: 1;
    border-radius: var(--radius-sm);
  }

  .rule-remove:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-input);
  }

  .rule-add-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .rule-input {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    min-width: 0;
  }

  .rule-ports-input {
    width: 90px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
  }

  .rule-input:focus,
  .rule-ports-input:focus {
    outline: none;
    border-color: var(--color-accent);
  }

  .kube-confirm-dialog {
    margin-top: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: color-mix(in srgb, var(--color-warning, #f59e0b) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 40%, transparent);
    border-radius: var(--radius-md);
  }

  .kube-confirm-msg {
    margin: 0 0 var(--space-3);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
  }

  .kube-confirm-actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
</style>
