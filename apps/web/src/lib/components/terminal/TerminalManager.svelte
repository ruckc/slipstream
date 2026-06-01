<script lang="ts">
  import { onMount } from 'svelte'
  import TerminalTabBar from './TerminalTabBar.svelte'
  import TerminalPane from './TerminalPane.svelte'
  import type { TerminalSession } from './TerminalTabBar.svelte'
  import { podFetch } from '$lib/pod-fetch'

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

  async function fetchSessions() {
    try {
      const res = await podFetch(projectId, namespaceSlug, projectSlug, '/sessions')
      if (!res.ok) throw new Error('Failed to list sessions: ' + res.status)
      const data = await res.json() as { sessions: Array<{ id: string; label?: string; name?: string }> }
      const loaded = (data.sessions ?? []).map((s, i) => ({
        id: s.id,
        label: s.label ?? s.name ?? `Terminal ${i + 1}`,
      }))
      if (loaded.length > 0) {
        sessions = loaded
        if (!activeSessionId || !loaded.some(s => s.id === activeSessionId)) {
          activeSessionId = loaded[0].id
        }
      } else {
        await createSession()
      }
    } catch {
      await createSession()
    }
  }

  async function createSession() {
    try {
      const res = await podFetch(projectId, namespaceSlug, projectSlug, '/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: `Terminal ${sessions.length + 1}` }),
      })
      if (!res.ok) throw new Error('Failed to create session: ' + res.status)
      const data = await res.json() as { id: string; label?: string }
      const newSession: TerminalSession = {
        id: data.id,
        label: data.label ?? `Terminal ${sessions.length + 1}`,
      }
      sessions = [...sessions, newSession]
      activeSessionId = newSession.id
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to create terminal session'
    }
  }

  async function closeSession(id: string) {
    try {
      await podFetch(projectId, namespaceSlug, projectSlug, `/sessions/${id}`, { method: 'DELETE' })
    } catch {
      // Best-effort
    }
    sessions = sessions.filter(s => s.id !== id)
    if (activeSessionId === id) {
      activeSessionId = sessions.length > 0 ? sessions[sessions.length - 1].id : null
    }
    if (sessions.length === 0) {
      await createSession()
    }
  }

  function handleRename(id: string, newLabel: string) {
    sessions = sessions.map(s => s.id === id ? { ...s, label: newLabel } : s)
    podFetch(projectId, namespaceSlug, projectSlug, `/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel }),
    }).catch(() => {})
  }

  onMount(() => {
    fetchSessions()
  })
</script>

<div class="terminal-manager">
  {#if loadError}
    <div class="terminal-error">
      <p>{loadError}</p>
      <button class="terminal-error-retry" onclick={() => { loadError = null; fetchSessions() }}>
        Retry
      </button>
    </div>
  {:else}
    <TerminalTabBar
      {sessions}
      bind:activeSessionId
      onNewSession={createSession}
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
