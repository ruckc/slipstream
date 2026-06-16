<script lang="ts">
  import { getContext } from 'svelte'
  import { getNamespaceRegistry } from '$lib/remote/registry.remote'
  import type { WorkspaceCtx } from './WorkspaceTypes.js'
  import { WORKSPACE_CTX } from './WorkspaceTypes.js'
  import type { NamespaceRegistryData } from '$lib/remote/registry.remote'

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
  {#if loading}
    <div class="registry-loading">Loading…</div>
  {:else if loadError}
    <div class="registry-error">{loadError}</div>
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
              <span class="repo-size">{formatSize(repo.totalSize)}</span>
            </div>
            <div class="artifact-list">
              {#each repo.artifacts as artifact (artifact.digest)}
                <div class="artifact-row">
                  <span class="artifact-digest">{shortDigest(artifact.digest)}</span>
                  <span class="artifact-tags">
                    {#each artifact.tags as tag (tag)}
                      <span class="tag-badge">{tag}</span>
                    {/each}
                    {#if artifact.tags.length === 0}
                      <span class="tag-badge tag-badge--untagged">untagged</span>
                    {/if}
                  </span>
                  <span class="artifact-size">{formatSize(artifact.size)}</span>
                  <span class="artifact-time">{formatTime(artifact.pushTime)}</span>
                </div>
              {/each}
            </div>
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

<style>
  .registry-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    padding: var(--space-4);
    gap: var(--space-4);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
  }

  .registry-loading,
  .registry-error {
    padding: var(--space-6);
    text-align: center;
    color: var(--color-text-muted);
  }

  .registry-error {
    color: var(--color-danger, #d93025);
  }

  .registry-empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-4);
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

  .registry-cmd {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    background: var(--color-bg-muted, #f1f3f4);
    border-radius: var(--radius-md);
    font-family: var(--font-mono, monospace);
    font-size: var(--font-size-xs);
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--color-text-primary);
    border: 1px solid var(--color-border);
  }

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
    background: var(--color-bg-elevated, var(--color-bg-surface));
    border-bottom: 1px solid var(--color-border);
    font-weight: 600;
    font-size: var(--font-size-xs);
  }

  .repo-name {
    font-family: var(--font-mono, monospace);
  }

  .repo-size {
    color: var(--color-text-muted);
    font-weight: 400;
  }

  .artifact-list {
    display: flex;
    flex-direction: column;
  }

  .artifact-row {
    display: grid;
    grid-template-columns: 100px 1fr auto auto;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border-subtle, var(--color-border));
    font-size: var(--font-size-xs);
  }

  .artifact-row:last-child {
    border-bottom: none;
  }

  .artifact-digest {
    font-family: var(--font-mono, monospace);
    color: var(--color-text-muted);
  }

  .artifact-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .tag-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--color-accent-subtle, #e8f0fe);
    color: var(--color-accent, #1a73e8);
    font-size: var(--font-size-xs);
    font-weight: 500;
  }

  .tag-badge--untagged {
    background: var(--color-bg-muted, #f1f3f4);
    color: var(--color-text-muted);
  }

  .artifact-size {
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .artifact-time {
    color: var(--color-text-muted);
    white-space: nowrap;
  }

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
    letter-spacing: 0.04em;
  }
</style>
