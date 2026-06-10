<script lang="ts">
  import { getDashboard } from '$lib/remote/dashboard.remote'
  import Icon from '$lib/components/common/Icon.svelte'
  import ContextMenu from '$lib/components/common/ContextMenu.svelte'
  import DeleteProjectModal from '$lib/components/common/DeleteProjectModal.svelte'
  import { deleteProject } from '$lib/remote/project.remote'
  import { goto } from '$app/navigation'

  const { user, projects } = await getDashboard()

  const statusColors: Record<string, string> = {
    running: 'var(--color-success)',
    starting: 'var(--color-warning)',
    stopping: 'var(--color-warning)',
    stopped: 'var(--color-text-muted)',
  }

  let menuOpen = $state(false)
  let menuX = $state(0)
  let menuY = $state(0)
  let menuProject = $state<(typeof projects)[number] | null>(null)
  let deleteModalOpen = $state(false)

  function openMenu(e: MouseEvent, project: (typeof projects)[number]) {
    e.preventDefault()
    e.stopPropagation()
    const btn = e.currentTarget as HTMLElement
    const rect = btn.getBoundingClientRect()
    menuX = rect.right
    menuY = rect.bottom + 4
    menuProject = project
    menuOpen = true
  }

  async function handleDelete() {
    if (!menuProject) return
    const p = menuProject
    deleteModalOpen = false
    await deleteProject({ actorUserId: user.id, projectId: p.id })
  }

  let menuItems = $derived(
    menuProject
      ? [
          {
            label: 'Settings',
            icon: 'settings',
            action: () => {
              goto(`/${menuProject!.namespaceSlug}/${menuProject!.slug}/settings`)
              menuOpen = false
            },
          },
          {
            label: 'Delete',
            icon: 'trash',
            action: () => {
              menuOpen = false
              deleteModalOpen = true
            },
          },
        ]
      : []
  )
</script>

<svelte:head>
  <title>Dashboard — Slipstream</title>
</svelte:head>

<div class="dashboard">
  <div class="dashboard__header">
    <div>
      <h1 class="dashboard__title">
        Welcome back, {user.displayName}
      </h1>
      <p class="dashboard__subtitle">Your cloud dev environments</p>
    </div>

    <div class="dashboard__actions">
      <a href="/new" class="cta-btn cta-btn--secondary">
        <Icon name="org" size={14} />
        New organization
      </a>
      <a href="/new" class="cta-btn cta-btn--primary">
        <Icon name="add" size={14} />
        New project
      </a>
    </div>
  </div>

  {#if projects.length === 0}
    <div class="empty-state">
      <div class="empty-state__icon">
        <Icon name="project" size={48} />
      </div>
      <h2 class="empty-state__title">No projects yet</h2>
      <p class="empty-state__body">Create your first project to get a cloud dev environment.</p>
      <a href="/new" class="cta-btn cta-btn--primary">
        <Icon name="add" size={14} />
        Create your first project
      </a>
    </div>
  {:else}
    <div class="project-grid">
      {#each projects as project (project.id)}
        <div class="project-card">
          <a href="/{project.namespaceSlug}/{project.slug}" class="project-card__link">
            <div class="project-card__header">
              <Icon name="project" size={16} />
              <span class="project-card__slug">{project.namespaceSlug}/{project.slug}</span>
            </div>

            <div class="project-card__name">{project.displayName}</div>

            <div class="project-card__footer">
              <span
                class="status-chip"
                style:color={statusColors[project.status] ?? 'var(--color-text-muted)'}
              >
                <span
                  class="status-dot"
                  style:background={statusColors[project.status] ?? 'var(--color-text-muted)'}
                ></span>
                {project.status}
              </span>
              {#if project.updatedAt}
                <span class="project-card__date">
                  {new Date(project.updatedAt).toLocaleDateString()}
                </span>
              {/if}
            </div>
          </a>

          <button
            class="project-card__menu-btn"
            aria-label="Project options"
            onclick={(e) => openMenu(e, project)}
          >
            <Icon name="ellipsis" size={14} />
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<ContextMenu items={menuItems} x={menuX} y={menuY} bind:open={menuOpen} />

{#if menuProject}
  <DeleteProjectModal
    bind:open={deleteModalOpen}
    project={menuProject}
    loading={deleteProject.pending > 0}
    onconfirm={handleDelete}
  />
{/if}

<style>
  .dashboard {
    max-width: 960px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
  }

  .dashboard__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-8);
    flex-wrap: wrap;
  }

  .dashboard__title {
    margin: 0 0 var(--space-1);
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .dashboard__subtitle {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .dashboard__actions {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .cta-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    border: 1px solid transparent;
    height: 28px;
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast);
  }

  .cta-btn--primary {
    background: var(--color-accent);
    color: var(--color-accent-text);
    border-color: var(--color-accent);
  }

  .cta-btn--primary:hover {
    background: var(--color-accent-hover);
    border-color: var(--color-accent-hover);
    text-decoration: none;
  }

  .cta-btn--secondary {
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
    border-color: var(--color-border);
  }

  .cta-btn--secondary:hover {
    background: var(--color-bg-input);
    border-color: var(--color-border-focus);
    text-decoration: none;
  }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-6);
    text-align: center;
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-lg);
    color: var(--color-text-muted);
    margin-top: var(--space-8);
  }

  .empty-state__icon {
    opacity: 0.3;
  }

  .empty-state__title {
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .empty-state__body {
    margin: 0;
    font-size: var(--font-size-sm);
    max-width: 300px;
  }

  /* Project grid */
  .project-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--space-4);
  }

  .project-card {
    position: relative;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast);
  }

  .project-card:hover {
    background: var(--color-bg-elevated);
    border-color: var(--color-border-focus);
  }

  .project-card__link {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    padding-right: var(--space-8);
    text-decoration: none;
    color: var(--color-text-primary);
  }

  .project-card__link:hover {
    text-decoration: none;
  }

  .project-card__menu-btn {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity var(--transition-fast),
      background var(--transition-fast),
      color var(--transition-fast);
  }

  .project-card:hover .project-card__menu-btn {
    opacity: 1;
  }

  .project-card__menu-btn:hover {
    background: var(--color-bg-active);
    color: var(--color-text-primary);
  }

  .project-card__header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
  }

  .project-card__slug {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-card__name {
    font-size: var(--font-size-md);
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .project-card__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: auto;
  }

  .project-card__date {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .status-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--font-size-xs);
    font-weight: 500;
    text-transform: capitalize;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
