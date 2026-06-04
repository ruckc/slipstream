<script lang="ts">
  import { untrack } from 'svelte'
  import { enhance } from '$app/forms'
  import type { PageData } from './$types'
  import AppShell from '$lib/components/layout/AppShell.svelte'
  import FileBrowser from '$lib/components/file-browser/FileBrowser.svelte'
  import FilePreview from '$lib/components/preview/FilePreview.svelte'
  import TerminalManager from '$lib/components/terminal/TerminalManager.svelte'
  import ProjectHeader from '$lib/components/project/ProjectHeader.svelte'
  import EditorTabBar from '$lib/components/layout/EditorTabBar.svelte'
  import Icon from '$lib/components/common/Icon.svelte'

  let { data }: { data: PageData } = $props()

  // Permission helpers
  const canReadFiles = $derived(data.permissions.includes('files:read'))
  const canShell = $derived(data.permissions.includes('shell'))
  const canManage = $derived(data.permissions.includes('project:manage'))

  // Show overlay when the page loaded with an auto-started project
  let showStartingOverlay = $state(
    untrack(() => data.project.status === 'starting' && !data.startError)
  )

  // Editor tabs state
  type OpenFile = {
    id: string
    path: string
    label: string
    content?: Uint8Array | null
    loading: boolean
  }

  let openFiles = $state<OpenFile[]>([])
  let activeFileId = $state<string | null>(null)
  let projectStatus = $state(untrack(() => data.project.status))

  // Poll for status while starting; dismiss overlay when running
  $effect(() => {
    if (projectStatus !== 'starting') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/project/${data.project.id}/status`, {
          credentials: 'same-origin',
        })
        if (!res.ok) return
        const { status } = await res.json()
        if (status !== 'starting') {
          projectStatus = status
          showStartingOverlay = false
        }
      } catch {
        // ignore transient errors
      }
    }, 2000)
    return () => clearInterval(interval)
  })

  const activeFile = $derived(openFiles.find((f) => f.id === activeFileId) ?? null)

  const editorTabs = $derived(
    openFiles.map((f) => ({
      id: f.id,
      label: f.label,
      icon: 'file',
    }))
  )

  async function openFile(path: string) {
    // Check if already open
    const existing = openFiles.find((f) => f.path === path)
    if (existing) {
      activeFileId = existing.id
      return
    }

    const id = crypto.randomUUID()
    const label = path.split('/').pop() ?? path

    // Add tab in loading state
    openFiles = [...openFiles, { id, path, label, content: null, loading: true }]
    activeFileId = id

    try {
      const res = await fetch(
        `/env/${encodeURIComponent(data.namespace.slug)}/${encodeURIComponent(data.project.slug)}/fs/read?path=${encodeURIComponent(path)}`,
        { credentials: 'same-origin' }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      openFiles = openFiles.map((f) =>
        f.id === id ? { ...f, content: new Uint8Array(buf), loading: false } : f
      )
    } catch {
      openFiles = openFiles.map((f) => (f.id === id ? { ...f, loading: false } : f))
    }
  }

  function closeFile(id: string) {
    openFiles = openFiles.filter((f) => f.id !== id)
    if (activeFileId === id) {
      activeFileId = openFiles[openFiles.length - 1]?.id ?? null
    }
  }

  // Project start/stop
  let actionLoading = $state(false)

  // Activity items for AppShell
  const activityItems = $derived([
    ...(canReadFiles ? [{ id: 'files', icon: 'files', label: 'Explorer', onClick: () => {} }] : []),
    ...(canShell
      ? [{ id: 'terminal', icon: 'terminal', label: 'Terminal', onClick: () => {} }]
      : []),
    ...(canManage
      ? [{ id: 'settings', icon: 'settings', label: 'Settings', onClick: () => {} }]
      : []),
  ])
</script>

<svelte:head>
  <title>{data.project.displayName} — Slipstream</title>
</svelte:head>

{#if showStartingOverlay}
  <div class="starting-overlay" aria-live="polite" aria-label="Starting environment">
    <div class="starting-overlay__card">
      <span class="starting-overlay__spinner" aria-hidden="true"></span>
      <p class="starting-overlay__title">Starting environment…</p>
      <p class="starting-overlay__sub">{data.project.displayName}</p>
    </div>
  </div>
{/if}

<AppShell {activityItems}>
  {#snippet sidebarContent()}
    {#if canReadFiles}
      {#if projectStatus === 'running'}
        <FileBrowser
          projectId={data.project.id}
          namespaceSlug={data.namespace.slug}
          projectSlug={data.project.slug}
          onOpenFile={openFile}
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

  {#snippet editorContent()}
    <div class="editor-column">
      {#if editorTabs.length > 0}
        <EditorTabBar tabs={editorTabs} bind:activeTab={activeFileId} onClose={closeFile} />
      {/if}

      {#if activeFile}
        <FilePreview
          filename={activeFile.label}
          content={activeFile.content}
          loading={activeFile.loading}
        />
      {:else}
        <div class="editor-empty">
          {#if projectStatus !== 'running'}
            <div class="editor-empty__icon">
              <Icon name="project" size={48} />
            </div>
            <p class="editor-empty__title">{data.project.displayName}</p>
            <p class="editor-empty__subtitle">Project is {projectStatus}</p>
            {#if data.startError && projectStatus === 'stopped'}
              <p class="editor-empty__error">{data.startError}</p>
            {/if}
            {#if canManage && projectStatus === 'stopped'}
              <form
                method="POST"
                action="?/start"
                use:enhance={() => {
                  actionLoading = true
                  projectStatus = 'starting'
                  return async ({ update }) => {
                    actionLoading = false
                    await update({ reset: false })
                  }
                }}
              >
                <button
                  type="submit"
                  class="start-btn"
                  disabled={actionLoading}
                  aria-busy={actionLoading}
                >
                  <Icon name="play" size={14} />
                  Start project
                </button>
              </form>
            {/if}
          {:else}
            <div class="editor-empty__icon">
              <Icon name="files" size={48} />
            </div>
            <p class="editor-empty__subtitle">
              {canReadFiles ? 'Select a file from the explorer' : 'No file access permissions'}
            </p>
          {/if}
        </div>
      {/if}
    </div>
  {/snippet}

  {#snippet panelContent()}
    {#if canShell}
      {#if projectStatus === 'running'}
        <TerminalManager
          projectId={data.project.id}
          namespaceSlug={data.namespace.slug}
          projectSlug={data.project.slug}
        />
      {:else}
        <div class="panel-empty">
          <Icon name="terminal" size={24} />
          <span>Start the project to open a terminal</span>
        </div>
      {/if}
    {:else}
      <div class="panel-empty">
        <Icon name="warning" size={24} />
        <span>No shell access</span>
      </div>
    {/if}
  {/snippet}

  {#snippet statusLeftContent()}
    <ProjectHeader
      namespaceSlug={data.namespace.slug}
      namespaceType={data.namespace.type as 'user' | 'org'}
      projectSlug={data.project.slug}
      displayName={data.project.displayName}
      status={projectStatus}
      onStart={canManage && projectStatus === 'stopped'
        ? async () => {
            const form = document.querySelector<HTMLFormElement>('[data-action="start"]')
            form?.requestSubmit()
          }
        : undefined}
      onStop={canManage && (projectStatus === 'running' || projectStatus === 'starting')
        ? async () => {
            const form = document.querySelector<HTMLFormElement>('[data-action="stop"]')
            form?.requestSubmit()
          }
        : undefined}
    />

    <!-- Hidden forms for start/stop from ProjectHeader buttons -->
    <form
      method="POST"
      action="?/start"
      data-action="start"
      style="display: none"
      use:enhance={() => {
        actionLoading = true
        projectStatus = 'starting'
        return async ({ update }) => {
          actionLoading = false
          await update({ reset: false })
        }
      }}
    ></form>
    <form
      method="POST"
      action="?/stop"
      data-action="stop"
      style="display: none"
      use:enhance={() => {
        actionLoading = true
        projectStatus = 'stopping'
        return async ({ update }) => {
          actionLoading = false
          projectStatus = 'stopped'
          await update({ reset: false })
        }
      }}
    ></form>
  {/snippet}
</AppShell>

<style>
  .editor-column {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .editor-empty {
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
  }

  .editor-empty__icon {
    opacity: 0.25;
  }

  .editor-empty__title {
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .editor-empty__subtitle {
    margin: 0;
    color: var(--color-text-muted);
  }

  .editor-empty__error {
    margin: 0;
    color: var(--color-danger, #e53e3e);
    font-size: var(--font-size-xs, 0.75rem);
    max-width: 320px;
    text-align: center;
  }

  .start-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--color-accent);
    color: var(--color-accent-text);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--transition-fast);
    margin-top: var(--space-2);
  }

  .start-btn:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }

  .start-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

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

  .sidebar-empty,
  .panel-empty {
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
</style>
