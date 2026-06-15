<script lang="ts">
  import { getContext } from 'svelte'
  import { podFetch } from '$lib/pod-fetch'
  import type { WorkspaceCtx } from './WorkspaceTypes.js'
  import { WORKSPACE_CTX } from './WorkspaceTypes.js'
  import Icon from '$lib/components/common/Icon.svelte'

  const ctx = getContext<WorkspaceCtx>(WORKSPACE_CTX)

  type TmuxSession = {
    name: string
    created: number
    activity: number
    windows: number
    persistent: boolean
  }

  let sessions = $state<TmuxSession[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let loadSeq = 0

  let showForm = $state(false)
  let formName = $state('')
  let formCommand = $state('')
  let formWorkingDir = $state('')
  let formPersistent = $state(false)
  let formError = $state<string | null>(null)
  let formBusy = $state(false)

  async function load() {
    const seq = ++loadSeq
    loading = true
    error = null
    try {
      const res = await podFetch(ctx.projectId, ctx.namespaceSlug, ctx.projectSlug, '/tmux')
      if (seq !== loadSeq) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { sessions: TmuxSession[] }
      sessions = data.sessions ?? []
    } catch (e) {
      if (seq !== loadSeq) return
      error = e instanceof Error ? e.message : 'Failed to load processes'
    } finally {
      if (seq === loadSeq) loading = false
    }
  }

  async function spawn() {
    formError = null
    if (!formName.trim()) {
      formError = 'Name is required'
      return
    }
    if (!formCommand.trim()) {
      formError = 'Command is required'
      return
    }
    formBusy = true
    const name = formName.trim()
    try {
      const res = await podFetch(ctx.projectId, ctx.namespaceSlug, ctx.projectSlug, '/tmux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          command: formCommand.trim(),
          working_dir: formWorkingDir.trim() || undefined,
          persistent: formPersistent,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      formName = ''
      formCommand = ''
      formWorkingDir = ''
      formPersistent = false
      showForm = false
      load()
      // Jump straight to the process output so the user sees it running —
      // and can spot it immediately if the command fails on startup.
      await attach(name)
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Failed to spawn process'
    } finally {
      formBusy = false
    }
  }

  async function kill(name: string) {
    try {
      await podFetch(
        ctx.projectId,
        ctx.namespaceSlug,
        ctx.projectSlug,
        `/tmux/${encodeURIComponent(name)}`,
        { method: 'DELETE' }
      )
      await load()
    } catch {
      // best effort
    }
  }

  async function unpin(name: string) {
    try {
      await podFetch(
        ctx.projectId,
        ctx.namespaceSlug,
        ctx.projectSlug,
        `/tmux/${encodeURIComponent(name)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ persistent: false }),
        }
      )
      await load()
    } catch {
      // best effort
    }
  }

  async function attach(name: string) {
    const res = await podFetch(ctx.projectId, ctx.namespaceSlug, ctx.projectSlug, '/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: ['tmux', 'attach-session', '-t', name] }),
    })
    if (!res.ok) throw new Error(`Failed to attach to ${name} (HTTP ${res.status})`)
    const { session_id } = (await res.json()) as { session_id: string }
    ctx.openTmuxAttach(session_id, name)
  }

  function formatAge(unixSecs: number): string {
    if (!unixSecs) return '—'
    const secs = Math.floor(Date.now() / 1000) - unixSecs
    if (secs < 60) return `${secs}s ago`
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
    return `${Math.floor(secs / 86400)}d ago`
  }

  $effect(() => {
    load()
  })
</script>

<div class="processes-pane">
  <div class="processes-toolbar">
    <span class="processes-title">Persistent Processes</span>
    <button class="toolbar-btn" onclick={load} title="Refresh" aria-label="Refresh">
      <Icon name="refresh" size={14} />
    </button>
    {#if ctx.canShell}
      <button
        class="toolbar-btn toolbar-btn--primary"
        onclick={() => (showForm = !showForm)}
        title="New process"
        aria-label="New process"
      >
        <Icon name="add" size={14} />
        <span>New</span>
      </button>
    {/if}
  </div>

  {#if showForm}
    <div class="spawn-form">
      <div class="form-row">
        <label class="form-label" for="proc-name">Name</label>
        <input
          id="proc-name"
          class="form-input"
          type="text"
          placeholder="e.g. dev-server"
          pattern="[a-zA-Z0-9_\-]+"
          maxlength={64}
          bind:value={formName}
          onkeydown={(e) => e.key === 'Enter' && spawn()}
        />
      </div>
      <div class="form-row">
        <label class="form-label" for="proc-cmd">Command</label>
        <input
          id="proc-cmd"
          class="form-input"
          type="text"
          placeholder="e.g. npm run dev"
          bind:value={formCommand}
          onkeydown={(e) => e.key === 'Enter' && spawn()}
        />
      </div>
      <div class="form-row">
        <label class="form-label" for="proc-cwd"
          >Working directory <span class="form-label--opt">(optional)</span></label
        >
        <input
          id="proc-cwd"
          class="form-input"
          type="text"
          placeholder="/workspace"
          bind:value={formWorkingDir}
          onkeydown={(e) => e.key === 'Enter' && spawn()}
        />
      </div>
      <label class="form-checkbox">
        <input type="checkbox" bind:checked={formPersistent} />
        <span>Autostart on agent restart</span>
      </label>
      {#if formError}
        <p class="form-error">{formError}</p>
      {/if}
      <div class="form-actions">
        <button class="btn btn--secondary" onclick={() => (showForm = false)}>Cancel</button>
        <button class="btn btn--primary" onclick={spawn} disabled={formBusy}>
          {formBusy ? 'Starting…' : 'Start'}
        </button>
      </div>
    </div>
  {/if}

  <div class="processes-body">
    {#if loading}
      <div class="processes-empty">Loading…</div>
    {:else if error}
      <div class="processes-empty processes-empty--error">{error}</div>
    {:else if sessions.length === 0}
      <div class="processes-empty">
        <Icon name="play" size={32} />
        <p>No persistent processes running.</p>
        {#if ctx.canShell}
          <button class="btn btn--secondary" onclick={() => (showForm = true)}>New process</button>
        {/if}
      </div>
    {:else}
      <table class="sessions-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Windows</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each sessions as s (s.name)}
            <tr>
              <td class="cell-name">
                {s.name}
                {#if s.persistent}
                  <span class="pin-badge" title="Autostarts on agent restart">⭐</span>
                {/if}
              </td>
              <td class="cell-windows">{s.windows}</td>
              <td class="cell-age">{formatAge(s.activity)}</td>
              <td class="cell-actions">
                {#if ctx.canShell}
                  <button
                    class="action-btn action-btn--attach"
                    title="Attach in new terminal"
                    onclick={() => attach(s.name).catch(() => {})}
                  >
                    <Icon name="terminal" size={13} />
                  </button>
                  {#if s.persistent}
                    <button
                      class="action-btn action-btn--unpin"
                      title="Remove autostart"
                      onclick={() => unpin(s.name)}
                      aria-label="Remove autostart"
                    >
                      ⭐
                    </button>
                  {/if}
                  <button
                    class="action-btn action-btn--kill"
                    title="Kill session"
                    onclick={() => kill(s.name)}
                  >
                    <Icon name="stop" size={13} />
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .processes-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-bg-default);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    overflow: hidden;
  }

  .processes-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .processes-title {
    flex: 1;
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    border: 1px solid transparent;
  }
  .toolbar-btn:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }
  .toolbar-btn--primary {
    border-color: var(--color-border);
    color: var(--color-text-primary);
  }

  .spawn-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-surface);
    flex-shrink: 0;
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .form-label {
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--color-text-muted);
  }
  .form-label--opt {
    font-weight: 400;
    opacity: 0.7;
  }

  .form-input {
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-input);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    font-family: var(--font-mono);
  }
  .form-input:focus {
    outline: none;
    border-color: var(--color-border-focus);
  }

  .form-checkbox {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    cursor: pointer;
    user-select: none;
  }
  .form-checkbox input {
    cursor: pointer;
    accent-color: var(--color-accent);
  }

  .form-error {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--color-danger, #e53e3e);
  }

  .form-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
  }

  .btn {
    padding: var(--space-1) var(--space-4);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
  }
  .btn--primary {
    background: var(--color-accent);
    color: #fff;
    border: 1px solid transparent;
  }
  .btn--primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .btn--secondary {
    background: transparent;
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
  }
  .btn--secondary:hover {
    background: var(--color-bg-hover);
  }

  .processes-body {
    flex: 1;
    overflow-y: auto;
  }

  .processes-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    height: 100%;
    padding: var(--space-8);
    color: var(--color-text-muted);
    text-align: center;
  }
  .processes-empty p {
    margin: 0;
  }
  .processes-empty--error {
    color: var(--color-danger, #e53e3e);
  }

  .sessions-table {
    width: 100%;
    border-collapse: collapse;
  }

  .sessions-table th {
    padding: var(--space-2) var(--space-3);
    text-align: left;
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
  }

  .sessions-table td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
    vertical-align: middle;
  }

  .sessions-table tbody tr:hover {
    background: var(--color-bg-hover);
  }

  .cell-name {
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    font-weight: 500;
  }

  .pin-badge {
    font-size: 10px;
    margin-left: var(--space-1);
    opacity: 0.7;
  }

  .cell-windows,
  .cell-age {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    white-space: nowrap;
  }

  .cell-actions {
    display: flex;
    gap: var(--space-1);
    justify-content: flex-end;
    white-space: nowrap;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    color: var(--color-text-muted);
  }
  .action-btn:hover {
    background: var(--color-bg-hover);
    border-color: var(--color-border);
    color: var(--color-text-primary);
  }
  .action-btn--unpin:hover {
    color: var(--color-warning, #d97706);
  }
  .action-btn--kill:hover {
    color: var(--color-danger, #e53e3e);
  }
</style>
