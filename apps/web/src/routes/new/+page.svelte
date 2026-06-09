<script lang="ts">
  import { getNewPageData, createProjectForm, createOrgForm } from '$lib/remote/new-project.remote'
  import Button from '$lib/components/common/Button.svelte'
  import Input from '$lib/components/common/Input.svelte'

  const { userNamespace, orgNamespaces } = await getNewPageData()

  let activeTab = $state<'project' | 'org'>('project')

  let projectNamespaceId = $state(userNamespace.id)
  let projectSlug = $state('')
  let projectDisplayName = $state('')

  let orgSlug = $state('')
  let orgDisplayName = $state('')

  const allNamespaces = $derived([
    { id: userNamespace.id, slug: userNamespace.slug, label: `${userNamespace.slug} (personal)` },
    ...orgNamespaces.map((ns) => ({ id: ns.id, slug: ns.slug, label: `${ns.slug} (org)` })),
  ])
</script>

<svelte:head>
  <title>New — Slipstream</title>
</svelte:head>

<div class="new-page">
  <div class="new-card">
    <h1 class="new-card__title">Create new</h1>

    <!-- Tab switcher -->
    <div class="tabs" role="tablist" aria-label="What to create">
      <button
        class="tab"
        class:tab--active={activeTab === 'project'}
        role="tab"
        aria-selected={activeTab === 'project'}
        onclick={() => (activeTab = 'project')}
        type="button"
      >
        Project
      </button>
      <button
        class="tab"
        class:tab--active={activeTab === 'org'}
        role="tab"
        aria-selected={activeTab === 'org'}
        onclick={() => (activeTab = 'org')}
        type="button"
      >
        Organization
      </button>
    </div>

    <!-- Project form -->
    {#if activeTab === 'project'}
      <form {...createProjectForm} class="form">
        <div class="form-field">
          <label class="form-label" for="project-namespace">Namespace</label>
          <select
            id="project-namespace"
            name="namespaceId"
            class="select"
            bind:value={projectNamespaceId}
            required
          >
            {#each allNamespaces as ns (ns.id)}
              <option value={ns.id}>{ns.label}</option>
            {/each}
          </select>
        </div>

        <Input
          label="Project slug"
          name="slug"
          bind:value={projectSlug}
          placeholder="my-project"
          required
          error={createProjectForm.fields.slug?.issues()?.[0]?.message}
        />
        <p class="field-hint">Lowercase letters, numbers, and hyphens. Used in the URL.</p>

        <Input
          label="Display name"
          name="displayName"
          bind:value={projectDisplayName}
          placeholder="My Project"
          required
          error={createProjectForm.fields.displayName?.issues()?.[0]?.message}
        />

        {#if createProjectForm.fields.namespaceId?.issues()?.[0]}
          <div class="form-error" role="alert">
            {createProjectForm.fields.namespaceId?.issues()?.[0]?.message}
          </div>
        {/if}

        <div class="form-actions">
          <a href="/" class="cancel-link">Cancel</a>
          <Button type="submit" variant="primary" loading={createProjectForm.pending > 0}>
            Create project
          </Button>
        </div>
      </form>
    {/if}

    <!-- Organization form -->
    {#if activeTab === 'org'}
      <form {...createOrgForm} class="form">
        <Input
          label="Organization slug"
          name="slug"
          bind:value={orgSlug}
          placeholder="my-org"
          required
          error={createOrgForm.fields.slug?.issues()?.[0]?.message}
        />
        <p class="field-hint">
          Lowercase letters, numbers, and hyphens. This will be your org's URL path.
        </p>

        <Input
          label="Display name"
          name="displayName"
          bind:value={orgDisplayName}
          placeholder="My Organization"
          required
          error={createOrgForm.fields.displayName?.issues()?.[0]?.message}
        />

        <div class="form-actions">
          <a href="/" class="cancel-link">Cancel</a>
          <Button type="submit" variant="primary" loading={createOrgForm.pending > 0}>
            Create organization
          </Button>
        </div>
      </form>
    {/if}
  </div>
</div>

<style>
  .new-page {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: var(--space-8) var(--space-4);
    min-height: calc(100dvh - 35px);
  }

  @media (max-width: 639px) {
    .new-page {
      padding: var(--space-4);
    }
  }

  .new-card {
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .new-card__title {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  /* Tabs */
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--color-border);
    gap: 0;
  }

  .tab {
    padding: var(--space-2) var(--space-4);
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--color-text-muted);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition:
      color var(--transition-fast),
      border-color var(--transition-fast);
    margin-bottom: -1px;
  }

  .tab:hover {
    color: var(--color-text-primary);
  }

  .tab--active {
    color: var(--color-text-primary);
    border-bottom-color: var(--color-accent);
  }

  /* Form */
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .form-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .select {
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-size-sm);
    font-family: var(--font-sans);
    height: 28px;
    width: 100%;
    cursor: pointer;
    transition: border-color var(--transition-fast);
  }

  .select:focus {
    border-color: var(--color-border-focus);
    outline: none;
  }

  .field-hint {
    margin: -var(--space-2) 0 0;
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .form-error {
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--color-danger) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-danger) 40%, transparent);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    color: var(--color-danger);
  }

  .form-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-top: var(--space-2);
  }

  .cancel-link {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-decoration: none;
  }

  .cancel-link:hover {
    color: var(--color-text-primary);
    text-decoration: underline;
  }
</style>
