<script lang="ts">
  import FileTreeDirectory from './FileTreeDirectory.svelte'
  import FileTreeFile from './FileTreeFile.svelte'
  import FileTreeNode from './FileTreeNode.svelte'
  import type { FileEntry } from './FileTreeFile.svelte'
  import { podFetch } from '$lib/pod-fetch'

  let {
    entry,
    depth,
    path,
    projectId,
    namespaceSlug,
    projectSlug,
    selectedPath,
    onOpenFile,
    onContextMenu,
  }: {
    entry: FileEntry
    depth: number
    path: string
    projectId: string
    namespaceSlug: string
    projectSlug: string
    selectedPath: string
    onOpenFile: (path: string) => void
    onContextMenu: (e: MouseEvent, entry: FileEntry, path: string) => void
  } = $props()

  let expanded = $state(false)
  let loadingChildren = $state(false)
  let children = $state<FileEntry[]>([])
  let loadError = $state<string | null>(null)
  let hasLoaded = $state(false)

  async function loadChildren() {
    if (hasLoaded) return
    loadingChildren = true
    loadError = null
    try {
      const res = await podFetch(
        projectId,
        namespaceSlug,
        projectSlug,
        '/fs?path=' + encodeURIComponent(path)
      )
      if (!res.ok) throw new Error('Failed to load directory: ' + res.status)
      const data = (await res.json()) as { entries: FileEntry[] }
      children = (data.entries ?? []).slice().sort((a, b) => {
        // Directories first, then alphabetical
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      hasLoaded = true
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Load failed'
    } finally {
      loadingChildren = false
    }
  }

  async function handleToggle() {
    if (!expanded) {
      expanded = true
      await loadChildren()
    } else {
      expanded = false
    }
  }

  function childPath(child: FileEntry): string {
    return (path === '/' ? '' : path) + '/' + child.name
  }
</script>

{#if entry.type === 'dir'}
  <FileTreeDirectory
    {entry}
    {depth}
    {path}
    {expanded}
    loading={loadingChildren}
    selected={selectedPath === path}
    onToggle={handleToggle}
    {onContextMenu}
  />
  {#if expanded}
    <div class="children" aria-label="Contents of {entry.name}">
      {#if loadError}
        <div class="load-error" style="padding-left: calc(var(--space-2) + {(depth + 1) * 16}px)">
          {loadError}
        </div>
      {:else if hasLoaded && children.length === 0}
        <div class="empty-dir" style="padding-left: calc(var(--space-2) + {(depth + 1) * 16}px)">
          Empty folder
        </div>
      {:else}
        {#each children as child (child.name)}
          <FileTreeNode
            entry={child}
            depth={depth + 1}
            path={childPath(child)}
            {projectId}
            {namespaceSlug}
            {projectSlug}
            {selectedPath}
            {onOpenFile}
            {onContextMenu}
          />
        {/each}
      {/if}
    </div>
  {/if}
{:else}
  <FileTreeFile
    {entry}
    {depth}
    {path}
    selected={selectedPath === path}
    {onOpenFile}
    {onContextMenu}
  />
{/if}

<style>
  .children {
    display: flex;
    flex-direction: column;
  }

  .load-error {
    font-size: var(--font-size-xs);
    color: var(--color-danger);
    padding-top: 2px;
    padding-bottom: 2px;
    padding-right: var(--space-3);
  }

  .empty-dir {
    font-size: var(--font-size-xs);
    color: var(--color-text-disabled);
    padding-top: 2px;
    padding-bottom: 2px;
    padding-right: var(--space-3);
    font-style: italic;
  }
</style>
