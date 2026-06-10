<script lang="ts">
  import { page } from '$app/state'
  import { getProjectPage } from '$lib/remote/project-page.remote'
  import { startProject } from '$lib/remote/project.remote'
  import AppShell from '$lib/components/layout/AppShell.svelte'
  import FileBrowser from '$lib/components/file-browser/FileBrowser.svelte'
  import WorkspaceManager from '$lib/components/workspace/WorkspaceManager.svelte'
  import ProjectHeader from '$lib/components/project/ProjectHeader.svelte'
  import Icon from '$lib/components/common/Icon.svelte'

  let appShell: AppShell = $state(null!)

  const {
    project,
    namespace,
    permissions,
    podStatus: initialPodStatus,
  } = await getProjectPage({
    namespace: page.params.namespace!,
    project: page.params.project!,
  })

  const canManage = permissions.includes('project:manage')
  const canReadFiles = permissions.includes('files:read')
  const canShell = permissions.includes('shell')

  let projectStatus = $state(initialPodStatus)
  let startError = $state<string | null>(null)
  let startAttempted = $state(false)

  // Show overlay eagerly: already starting, or stopped-and-will-auto-start
  let showStartingOverlay = $state(
    initialPodStatus === 'starting' || (initialPodStatus === 'stopped' && canManage)
  )

  // Auto-start when navigating to a stopped project
  $effect(() => {
    if (projectStatus !== 'stopped' || !canManage || startAttempted) return
    startAttempted = true
    startProject({ projectId: project.id })
      .then(() => {
        projectStatus = 'starting'
      })
      .catch((e: unknown) => {
        startError = e instanceof Error ? e.message : String(e)
        showStartingOverlay = false
      })
  })

  // Poll the agent health endpoint directly while starting.
  $effect(() => {
    if (projectStatus !== 'starting') return
    const healthUrl = `/env/${encodeURIComponent(namespace.slug)}/${encodeURIComponent(project.slug)}/health`
    const interval = setInterval(async () => {
      try {
        const res = await fetch(healthUrl)
        if (res.ok) {
          projectStatus = 'running'
          showStartingOverlay = false
        }
      } catch {
        // ignore transient errors
      }
    }, 2000)
    return () => clearInterval(interval)
  })

  let workspaceManager: WorkspaceManager = $state(null!)
</script>

<svelte:head>
  <title>{project.displayName} — Slipstream</title>
</svelte:head>

{#if showStartingOverlay}
  <div class="starting-overlay" aria-live="polite" aria-label="Starting environment">
    <div class="starting-overlay__card">
      <span class="starting-overlay__spinner" aria-hidden="true"></span>
      <p class="starting-overlay__title">Starting environment…</p>
      <p class="starting-overlay__sub">{project.displayName}</p>
    </div>
  </div>
{/if}

<AppShell bind:this={appShell}>
  {#snippet sidebarContent()}
    {#if canReadFiles}
      {#if projectStatus === 'running'}
        <FileBrowser
          projectId={project.id}
          namespaceSlug={namespace.slug}
          projectSlug={project.slug}
          onOpenFile={(path) => workspaceManager?.openFile(path)}
        />
      {:else}
        <div class="sidebar-empty">
          <Icon name="files" size={24} />
          <span>Start the project to browse files</span>
        </div>
      {/if}
    {:else}
      <div class="sidebar-empty">
        <Icon name="warning" size={24} />
        <span>No file access</span>
      </div>
    {/if}
  {/snippet}

  {#snippet workspaceContent()}
    {#if projectStatus === 'running'}
      <WorkspaceManager
        bind:this={workspaceManager}
        projectId={project.id}
        namespaceSlug={namespace.slug}
        projectSlug={project.slug}
        {projectStatus}
        {canShell}
        {canReadFiles}
        onToggleSidebar={() => appShell?.toggleSidebar()}
      />
    {:else}
      <div class="workspace-idle">
        <div class="workspace-idle__icon">
          <Icon name="project" size={48} />
        </div>
        <p class="workspace-idle__title">{project.displayName}</p>
        <p class="workspace-idle__subtitle">Project is {projectStatus}</p>
        {#if startError && projectStatus === 'stopped'}
          <p class="workspace-idle__error">{startError}</p>
        {/if}
      </div>
    {/if}
  {/snippet}

  {#snippet statusLeftContent()}
    <ProjectHeader
      namespaceSlug={namespace.slug}
      namespaceType={namespace.type as 'user' | 'org'}
      projectSlug={project.slug}
      displayName={project.displayName}
      status={projectStatus}
    />
  {/snippet}
</AppShell>

<style>
  .starting-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .starting-overlay__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-8) var(--space-8);
    min-width: 260px;
  }

  .starting-overlay__spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .starting-overlay__title {
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .starting-overlay__sub {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .sidebar-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
    height: 100%;
    opacity: 0.7;
  }

  .workspace-idle {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
    padding: var(--space-6);
    height: 100%;
  }

  .workspace-idle__icon {
    opacity: 0.25;
  }

  .workspace-idle__title {
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .workspace-idle__subtitle {
    margin: 0;
    color: var(--color-text-muted);
  }

  .workspace-idle__error {
    margin: 0;
    color: var(--color-danger, #e53e3e);
    font-size: var(--font-size-xs, 0.75rem);
    max-width: 320px;
    text-align: center;
  }
</style>
