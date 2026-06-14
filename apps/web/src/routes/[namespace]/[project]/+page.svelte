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
  let podFailureReason = $state<string | null>(null)

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

  // Poll pod start status while starting. Transitions to running or shows a
  // failure reason. Stops when the component is destroyed (navigation away).
  $effect(() => {
    if (projectStatus !== 'starting') return
    let cancelled = false
    const poll = async () => {
      if (cancelled) return
      try {
        const res = await fetch(`/api/pods/${project.id}/phase`)
        if (res.ok) {
          const data = await res.json()
          if (data.phase === 'running') {
            projectStatus = 'running'
            showStartingOverlay = false
            return
          }
          if (data.phase === 'failed' && data.failureReason) {
            podFailureReason = data.failureReason
            showStartingOverlay = true
            return
          }
        }
      } catch {
        // transient error — keep polling
      }
      if (!cancelled) setTimeout(poll, 2000)
    }
    poll()
    return () => {
      cancelled = true
    }
  })

  let workspaceManager: WorkspaceManager = $state(null!)
  let fileBrowser: FileBrowser = $state(null!)
</script>

<svelte:head>
  <title>{project.displayName} — Slipstream</title>
</svelte:head>

{#if showStartingOverlay}
  <div class="starting-overlay" aria-live="polite" aria-label="Starting environment">
    <div class="starting-overlay__card">
      {#if podFailureReason}
        <span class="starting-overlay__error-icon" aria-hidden="true">✕</span>
        <p class="starting-overlay__title">Failed to start</p>
        <p class="starting-overlay__sub">{project.displayName}</p>
        <p class="starting-overlay__reason">{podFailureReason}</p>
        <button
          class="starting-overlay__retry"
          onclick={() => {
            podFailureReason = null
            projectStatus = 'stopped'
            startAttempted = false
          }}>Retry</button
        >
      {:else}
        <span class="starting-overlay__spinner" aria-hidden="true"></span>
        <p class="starting-overlay__title">Starting environment…</p>
        <p class="starting-overlay__sub">{project.displayName}</p>
      {/if}
    </div>
  </div>
{/if}

<AppShell bind:this={appShell}>
  {#snippet sidebarContent()}
    {#if canReadFiles}
      {#if projectStatus === 'running'}
        <FileBrowser
          bind:this={fileBrowser}
          projectId={project.id}
          namespaceSlug={namespace.slug}
          projectSlug={project.slug}
          onOpenFile={(path) => workspaceManager?.openFile(path)}
          onCollapse={() => appShell?.toggleSidebar()}
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
        onCwdChange={(path) => fileBrowser?.navigateTo(path)}
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
    z-index: 300;
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

  .starting-overlay__error-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--color-danger, #e53e3e);
    color: #fff;
    font-size: 16px;
    font-weight: 700;
    line-height: 1;
  }

  .starting-overlay__reason {
    margin: 0;
    font-size: var(--font-size-xs, 0.75rem);
    font-family: monospace;
    color: var(--color-danger, #e53e3e);
  }

  .starting-overlay__retry {
    margin-top: var(--space-2);
    padding: var(--space-2) var(--space-5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-elevated);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .starting-overlay__retry:hover {
    background: var(--color-bg-hover);
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
