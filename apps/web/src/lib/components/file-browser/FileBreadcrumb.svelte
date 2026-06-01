<script lang="ts">
  let {
    path,
    onNavigate,
  }: {
    path: string
    onNavigate: (path: string) => void
  } = $props()

  interface Segment {
    label: string
    path: string
  }

  let segments = $derived.by<Segment[]>(() => {
    const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
    if (normalized === '/') return [{ label: '/', path: '/' }]
    const parts = normalized.split('/').filter(Boolean)
    const result: Segment[] = [{ label: '/', path: '/' }]
    let accumulated = ''
    for (const part of parts) {
      accumulated += '/' + part
      result.push({ label: part, path: accumulated })
    }
    return result
  })
</script>

<nav class="breadcrumb" aria-label="File path">
  {#each segments as segment, i}
    {#if i > 0}
      <span class="breadcrumb-sep" aria-hidden="true">/</span>
    {/if}
    {#if i === segments.length - 1}
      <span class="breadcrumb-current" aria-current="location">{segment.label}</span>
    {:else}
      <button
        class="breadcrumb-link"
        onclick={() => onNavigate(segment.path)}
        title={segment.path}
      >
        {segment.label}
      </button>
    {/if}
  {/each}
</nav>

<style>
  .breadcrumb {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0;
    padding: var(--space-1) var(--space-3);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    background: var(--color-bg-surface);
    border-bottom: 1px solid var(--color-border-subtle);
    min-height: 28px;
    overflow: hidden;
  }

  .breadcrumb-sep {
    margin: 0 var(--space-1);
    color: var(--color-text-disabled);
    user-select: none;
  }

  .breadcrumb-link {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    padding: 1px var(--space-1);
    border-radius: var(--radius-sm);
    transition: color var(--transition-fast), background var(--transition-fast);
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .breadcrumb-link:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-hover);
    text-decoration: none;
  }

  .breadcrumb-current {
    color: var(--color-text-primary);
    font-weight: 500;
    padding: 1px var(--space-1);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
