<script lang="ts">
  import { getContext } from 'svelte'
  import { getNamespaceRegistry } from '$lib/remote/registry.remote'
  import type { WorkspaceCtx } from './WorkspaceTypes.js'
  import { WORKSPACE_CTX } from './WorkspaceTypes.js'
  import type { NamespaceRegistryData } from '$lib/remote/registry.remote'
  import Icon from '$lib/components/common/Icon.svelte'

  const ctx = getContext<WorkspaceCtx>(WORKSPACE_CTX)

  let data = $state<NamespaceRegistryData | null>(null)
  let loading = $state(true)
  let loadError = $state<string | null>(null)

  async function load() {
    loading = true
    loadError = null
    try {
      data = await getNamespaceRegistry({
        namespace: ctx.namespaceSlug,
        project: ctx.projectSlug,
      })
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load registry'
    } finally {
      loading = false
    }
  }

  $effect(() => {
    load()
  })

  function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function shortDigest(digest: string) {
    return digest.startsWith('sha256:') ? digest.slice(7, 19) : digest.slice(0, 12)
  }
</script>

<div class="registry-pane">
  <div class="registry-toolbar">
    <span class="registry-title">Container Registry</span>
    <button class="toolbar-btn" onclick={load} title="Refresh" aria-label="Refresh">
      <Icon name="refresh" size={14} />
    </button>
  </div>

  <div class="registry-body">
    {#if loading}
      <div class="registry-empty">Loading…</div>
    {:else if loadError}
      <div class="registry-empty registry-empty--error">{loadError}</div>
    {:else if data && !data.enabled}
      <div class="registry-empty">
        <p class="registry-empty__title">Registry not configured</p>
        <p class="registry-empty__sub">
          No container registry is connected to this cluster. Contact your administrator.
        </p>
      </div>
    {:else if data}
      {#if data.repos.length === 0}
        <div class="registry-empty">
          <p class="registry-empty__title">No images pushed yet</p>
          <p class="registry-empty__sub">Build and push your first image from the terminal:</p>
          <pre class="registry-cmd">{data.pushExample}</pre>
        </div>
      {:else}
        <div class="registry-list">
          {#each data.repos as repo (repo.repoName)}
            <div class="repo-card">
              <div class="repo-header">
                <span class="repo-name">{repo.shortName}</span>
                <span class="repo-meta">{formatSize(repo.totalSize)}</span>
              </div>
              <table class="artifact-table">
                <thead>
                  <tr>
                    <th>Digest</th>
                    <th>Tags</th>
                    <th>Size</th>
                    <th>Pushed</th>
                  </tr>
                </thead>
                <tbody>
                  {#each repo.artifacts as artifact (artifact.digest)}
                    <tr>
                      <td class="cell-digest">{shortDigest(artifact.digest)}</td>
                      <td class="cell-tags">
                        {#each artifact.tags as tag (tag)}
                          <span class="tag-badge">{tag}</span>
                        {/each}
                        {#if artifact.tags.length === 0}
                          <span class="tag-badge tag-badge--untagged">untagged</span>
                        {/if}
                      </td>
                      <td class="cell-size">{formatSize(artifact.size)}</td>
                      <td class="cell-time">{formatTime(artifact.pushTime)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/each}
        </div>
      {/if}

      <div class="push-instructions">
        <p class="push-instructions__label">Push an image</p>
        <pre class="registry-cmd">{data.pushExample}</pre>
      </div>
    {/if}
  </div>
</div>

<style>
  .registry-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-bg-base);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    overflow: hidden;
  }

  /* ── Toolbar ── matches .processes-toolbar */
  .registry-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .registry-title {
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
    background: transparent;
    cursor: pointer;
  }
  .toolbar-btn:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  /* ── Scrollable body ── matches .processes-body */
  .registry-body {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  /* ── Empty / error states ── matches .processes-empty */
  .registry-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    flex: 1;
    padding: var(--space-8);
    color: var(--color-text-muted);
    text-align: center;
  }
  .registry-empty--error {
    color: var(--color-danger);
  }

  .registry-empty__title {
    margin: 0;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .registry-empty__sub {
    margin: 0;
    color: var(--color-text-muted);
  }

  /* ── Command block ── */
  .registry-cmd {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--color-text-primary);
    width: 100%;
    box-sizing: border-box;
  }

  /* ── Repository list ── */
  .registry-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .repo-card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    overflow: hidden;
  }

  .repo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-elevated);
    border-bottom: 1px solid var(--color-border);
  }

  .repo-name {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .repo-meta {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  /* ── Artifact table ── matches .sessions-table */
  .artifact-table {
    width: 100%;
    border-collapse: collapse;
  }

  .artifact-table th {
    padding: var(--space-2) var(--space-3);
    text-align: left;
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
    white-space: nowrap;
  }

  .artifact-table td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle);
    vertical-align: middle;
    font-size: var(--font-size-xs);
  }

  .artifact-table tbody tr:last-child td {
    border-bottom: none;
  }

  .artifact-table tbody tr:hover {
    background: var(--color-bg-hover);
  }

  .cell-digest {
    font-family: var(--font-mono);
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .cell-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .tag-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--color-bg-selection);
    color: var(--color-text-primary);
    font-size: var(--font-size-xs);
    font-weight: 500;
    border: 1px solid var(--color-border);
  }

  .tag-badge--untagged {
    background: var(--color-bg-elevated);
    color: var(--color-text-muted);
    font-style: italic;
  }

  .cell-size,
  .cell-time {
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  /* ── Push instructions footer ── */
  .push-instructions {
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-surface);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .push-instructions__label {
    margin: 0;
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
