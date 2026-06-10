<script lang="ts">
  import ProjectStatusChip from './ProjectStatusChip.svelte'
  import Icon from '$lib/components/common/Icon.svelte'

  let {
    namespaceSlug,
    namespaceType = 'user',
    projectSlug,
    displayName,
    status = 'stopped',
  }: {
    namespaceSlug: string
    namespaceType?: 'user' | 'org'
    projectSlug: string
    displayName: string
    status?: string
  } = $props()
</script>

<div class="project-header">
  <a href="/{namespaceSlug}" class="project-header-ns" aria-label="Namespace: {namespaceSlug}">
    <Icon name={namespaceType === 'org' ? 'org' : 'user'} size={12} />
    <span>{namespaceSlug}</span>
  </a>
  <span class="project-header-sep" aria-hidden="true">/</span>
  <a
    href="/{namespaceSlug}/{projectSlug}"
    class="project-header-project"
    aria-label="Project: {displayName}"
  >
    <Icon name="project" size={12} />
    <span class="project-header-name">{displayName}</span>
  </a>
  <div class="project-header-status">
    <ProjectStatusChip {status} size="sm" />
  </div>
  <div class="project-header-actions">
    <a
      href="/{namespaceSlug}/{projectSlug}/network"
      class="header-action-btn"
      title="Network activity"
      aria-label="Network activity"
    >
      <Icon name="network" size={12} />
    </a>
    <a
      href="/{namespaceSlug}/{projectSlug}/settings"
      class="header-action-btn"
      title="Project settings"
      aria-label="Project settings"
    >
      <Icon name="settings" size={12} />
    </a>
  </div>
</div>

<style>
  .project-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-xs);
    color: var(--color-statusbar-fg);
    overflow: hidden;
    min-width: 0;
    height: 100%;
    padding: 0 var(--space-3);
  }

  .project-header-ns {
    display: flex;
    align-items: center;
    gap: 3px;
    color: inherit;
    opacity: 0.8;
    text-decoration: none;
    flex-shrink: 0;
    transition: opacity var(--transition-fast);
  }

  .project-header-ns:hover {
    opacity: 1;
    text-decoration: none;
  }

  .project-header-sep {
    opacity: 0.5;
    flex-shrink: 0;
    user-select: none;
  }

  .project-header-project {
    display: flex;
    align-items: center;
    gap: 3px;
    color: inherit;
    text-decoration: none;
    min-width: 0;
    transition: opacity var(--transition-fast);
  }

  .project-header-project:hover {
    opacity: 0.85;
    text-decoration: none;
  }

  .project-header-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .project-header-status {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    margin-left: var(--space-1);
  }

  .project-header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
    flex-shrink: 0;
  }

  .header-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sm);
    color: var(--color-statusbar-fg);
    opacity: 0.7;
    text-decoration: none;
    transition:
      opacity var(--transition-fast),
      background var(--transition-fast);
  }

  .header-action-btn:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.15);
    text-decoration: none;
  }
</style>
