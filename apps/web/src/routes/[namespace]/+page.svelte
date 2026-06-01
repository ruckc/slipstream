<script lang="ts">
  import type { PageData } from './$types'
  import Icon from '$lib/components/common/Icon.svelte'
  import ProjectStatusChip from '$lib/components/project/ProjectStatusChip.svelte'

  let { data }: { data: PageData } = $props()

  const isOrg = $derived(data.namespace.type === 'org')
</script>

<svelte:head>
  <title>{data.namespace.slug} — Slipstream</title>
</svelte:head>

<div class="ns-page">
  <div class="ns-header">
    <div class="ns-header__left">
      <div class="ns-header__icon">
        <Icon name={isOrg ? 'org' : 'user'} size={20} />
      </div>
      <div>
        <div class="ns-header__title">
          {isOrg && data.orgData ? data.orgData.displayName : data.namespace.slug}
        </div>
        <div class="ns-header__meta">
          <span class="ns-badge ns-badge--{data.namespace.type}">
            {data.namespace.type === 'user' ? 'Personal' : 'Organization'}
          </span>
          <span class="ns-header__slug">{data.namespace.slug}</span>
          {#if isOrg && data.orgData}
            <span class="ns-header__members">
              <Icon name="user" size={11} />
              {data.orgData.memberCount} {data.orgData.memberCount === 1 ? 'member' : 'members'}
            </span>
          {/if}
        </div>
      </div>
    </div>

    <div class="ns-header__actions">
      {#if data.isOwner}
        <a href="/{data.namespace.slug}/settings" class="action-link">
          <Icon name="settings" size={14} />
          Settings
        </a>
      {/if}
      <a href="/new" class="action-btn">
        <Icon name="add" size={14} />
        New project
      </a>
    </div>
  </div>

  {#if data.projects.length === 0}
    <div class="empty-state">
      <div class="empty-state__icon">
        <Icon name="project" size={40} />
      </div>
      <h2 class="empty-state__title">No projects yet</h2>
      <p class="empty-state__body">Create your first project in this namespace.</p>
      <a href="/new" class="action-btn">
        <Icon name="add" size={14} />
        Create project
      </a>
    </div>
  {:else}
    <div class="project-grid">
      {#each data.projects as project (project.id)}
        <a
          href="/{data.namespace.slug}/{project.slug}"
          class="project-card"
        >
          <div class="project-card__header">
            <Icon name="project" size={14} />
            <span class="project-card__slug">{project.slug}</span>
          </div>
          <div class="project-card__name">{project.displayName}</div>
          <div class="project-card__footer">
            <ProjectStatusChip status={project.status} size="sm" />
            {#if project.updatedAt}
              <span class="project-card__date">
                {new Date(project.updatedAt).toLocaleDateString()}
              </span>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ns-page {
    max-width: 960px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
  }

  .ns-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-8);
    flex-wrap: wrap;
  }

  .ns-header__left {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .ns-header__icon {
    width: 40px;
    height: 40px;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .ns-header__title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text-primary);
    margin-bottom: var(--space-1);
  }

  .ns-header__meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .ns-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px var(--space-2);
    border-radius: 10px;
    font-size: var(--font-size-xs);
    font-weight: 500;
  }

  .ns-badge--user {
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    color: var(--color-accent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  .ns-badge--org {
    background: color-mix(in srgb, var(--color-success) 15%, transparent);
    color: var(--color-success);
    border: 1px solid color-mix(in srgb, var(--color-success) 30%, transparent);
  }

  .ns-header__slug {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  .ns-header__members {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .ns-header__actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .action-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--color-text-muted);
    text-decoration: none;
    border: 1px solid var(--color-border);
    height: 28px;
    transition: all var(--transition-fast);
    background: var(--color-bg-elevated);
  }

  .action-link:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-input);
    border-color: var(--color-border-focus);
    text-decoration: none;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-3);
    background: var(--color-accent);
    color: var(--color-accent-text);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    font-weight: 500;
    text-decoration: none;
    height: 28px;
    transition: background var(--transition-fast);
  }

  .action-btn:hover {
    background: var(--color-accent-hover);
    border-color: var(--color-accent-hover);
    text-decoration: none;
  }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-8) var(--space-6);
    text-align: center;
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-lg);
    color: var(--color-text-muted);
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
  }

  /* Project grid */
  .project-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--space-4);
  }

  .project-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    text-decoration: none;
    color: var(--color-text-primary);
    transition:
      background var(--transition-fast),
      border-color var(--transition-fast);
  }

  .project-card:hover {
    background: var(--color-bg-elevated);
    border-color: var(--color-border-focus);
    text-decoration: none;
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
</style>
