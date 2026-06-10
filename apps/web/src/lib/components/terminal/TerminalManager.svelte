<script lang="ts">
  import { onMount } from 'svelte'
  import TerminalTabBar from './TerminalTabBar.svelte'
  import TerminalPane from './TerminalPane.svelte'
  import NewSessionDialog from './NewSessionDialog.svelte'
  import type { TerminalSession } from './TerminalTabBar.svelte'
  import { podFetch } from '$lib/pod-fetch'
  import { getProjectCommands, saveProjectCommand } from '$lib/remote/project-commands.remote'
  import type { ProjectCommand } from '$lib/server/db'

  let {
    projectId,
    namespaceSlug,
    projectSlug,
  }: {
    projectId: string
    namespaceSlug: string
    projectSlug: string
  } = $props()

  let sessions = $state<TerminalSession[]>([])
  let activeSessionId = $state<string | null>(null)
  let loadError = $state<string | null>(null)
  let showNewSessionDialog = $state(false)
  let savedCommands = $state<ProjectCommand[]>([])

  async function loadSavedCommands() {
    try {
      savedCommands = await getProjectCommands({ projectId })
    } catch {
      savedCommands = []
    }
  }

  async function fetchSessions() {
    try {
      const res = await podFetch(projectId, namespaceSlug, projectSlug, '/sessions')
      if (!res.ok) throw new Error('Failed to list sessions: ' + res.status)
      const data = (await res.json()) as {
        sessions: Array<{ session_id: string; label?: string }>
      }
      const loaded = (data.sessions ?? []).map((s, i) => ({
        id: s.session_id,
        label: s.label ?? `Terminal ${i + 1}`,
      }))
      if (loaded.length > 0) {
        sessions = loaded
        if (!activeSessionId || !loaded.some((s) => s.id === activeSessionId)) {
          activeSessionId = loaded[0].id
        }
      } else {
        await createSession(null, null)
      }
    } catch {
      await createSession(null, null)
    }
  }

  async function createSession(command: string | null, workingDir: string | null) {
    try {
      const body: Record<string, unknown> = {
        label: `Terminal ${sessions.length + 1}`,
      }
      if (command) body.command = command.trim().split(/\s+/)
      if (workingDir) body.working_dir = workingDir

      const res = await podFetch(projectId, namespaceSlug, projectSlug, '/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to create session: ' + res.status)
      const data = (await res.json()) as { session_id: string; label?: string }
      const newSession: TerminalSession = {
        id: data.session_id,
        label: command ?? data.label ?? `Terminal ${sessions.length + 1}`,
      }
      sessions = [...sessions, newSession]
      activeSessionId = newSession.id

      if (command) {
        try {
          const saved = await saveProjectCommand({ projectId, command })
          if (!savedCommands.some((c) => c.id === saved.id)) {
            savedCommands = [saved, ...savedCommands]
          }
        } catch {
          // best-effort
        }
      }
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to create terminal session'
    }
  }

  function handleNewSession() {
    showNewSessionDialog = true
  }

  function handleDialogConfirm(command: string | null, workingDir: string | null) {
    createSession(command, workingDir)
  }

  async function closeSession(id: string) {
    try {
      await podFetch(projectId, namespaceSlug, projectSlug, `/sessions/${id}`, { method: 'DELETE' })
    } catch {
      // Best-effort
    }
    sessions = sessions.filter((s) => s.id !== id)
    if (activeSessionId === id) {
      activeSessionId = sessions.length > 0 ? sessions[sessions.length - 1].id : null
    }
    if (sessions.length === 0) {
      await createSession(null, null)
    }
  }

  function handleRename(id: string, newLabel: string) {
    sessions = sessions.map((s) => (s.id === id ? { ...s, label: newLabel } : s))
    podFetch(projectId, namespaceSlug, projectSlug, `/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel }),
    }).catch(() => {})
  }

  onMount(() => {
    loadSavedCommands()
    fetchSessions()
  })
</script>

<div class="terminal-manager">
  {#if loadError}
    <div class="terminal-error">
      <p>{loadError}</p>
      <button
        class="terminal-error-retry"
        onclick={() => {
          loadError = null
          fetchSessions()
        }}
      >
        Retry
      </button>
    </div>
  {:else}
    <NewSessionDialog
      bind:open={showNewSessionDialog}
      {savedCommands}
      onconfirm={handleDialogConfirm}
    />
    <TerminalTabBar
      {sessions}
      bind:activeSessionId
      onNewSession={handleNewSession}
      onCloseSession={closeSession}
    />
    <div class="terminal-panes">
      {#each sessions as session (session.id)}
        <div
          class="terminal-pane-wrapper"
          class:terminal-pane-wrapper--visible={session.id === activeSessionId}
          aria-hidden={session.id !== activeSessionId}
        >
          <TerminalPane
            sessionId={session.id}
            sessionLabel={session.label}
            {projectId}
            {namespaceSlug}
            {projectSlug}
            onRename={(newLabel) => handleRename(session.id, newLabel)}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .terminal-manager {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #1e1e1e;
    overflow: hidden;
  }

  .terminal-panes {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .terminal-pane-wrapper {
    position: absolute;
    inset: 0;
    display: none;
  }

  .terminal-pane-wrapper--visible {
    display: flex;
    flex-direction: column;
  }

  .terminal-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--space-3);
    font-size: var(--font-size-sm);
    color: var(--color-danger);
  }

  .terminal-error-retry {
    color: var(--color-accent);
    font-size: var(--font-size-sm);
    text-decoration: underline;
    cursor: pointer;
  }
</style>
