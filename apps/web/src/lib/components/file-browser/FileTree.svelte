<script lang="ts">
  import FileTreeNode from './FileTreeNode.svelte'
  import type { FileEntry } from './FileTreeFile.svelte'

  let {
    entries,
    currentPath,
    projectId,
    namespaceSlug,
    projectSlug,
    selectedPath = '',
    onOpenFile,
    onContextMenu,
  }: {
    entries: FileEntry[]
    currentPath: string
    projectId: string
    namespaceSlug: string
    projectSlug: string
    selectedPath?: string
    onOpenFile: (path: string) => void
    onContextMenu: (e: MouseEvent, entry: FileEntry, path: string) => void
  } = $props()

  let containerEl = $state<HTMLDivElement | undefined>(undefined)

  // Sorted entries: dirs first, then files, alphabetically
  let sorted = $derived(
    [...entries].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  )

  function entryPath(entry: FileEntry): string {
    const base = currentPath === '/' ? '' : currentPath
    return base + '/' + entry.name
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!containerEl) return
    const rows = Array.from(
      containerEl.querySelectorAll<HTMLButtonElement>('button.file-row, button.dir-row')
    )
    const focused = document.activeElement as HTMLButtonElement | null
    const idx = focused ? rows.indexOf(focused) : -1

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = rows[idx + 1]
      if (next) next.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = rows[idx - 1]
      if (prev) prev.focus()
    } else if (e.key === 'Enter' && focused) {
      e.preventDefault()
      focused.click()
    }
  }
</script>

<div
  class="file-tree"
  role="tree"
  aria-label="File tree"
  tabindex="0"
  bind:this={containerEl}
  onkeydown={handleKeydown}
>
  {#if entries.length === 0}
    <div class="file-tree-empty">No files</div>
  {:else}
    {#each sorted as entry (entry.name)}
      <FileTreeNode
        {entry}
        depth={0}
        path={entryPath(entry)}
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

<style>
  .file-tree {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .file-tree-empty {
    padding: var(--space-4) var(--space-3);
    font-size: var(--font-size-sm);
    color: var(--color-text-disabled);
    text-align: center;
    font-style: italic;
  }
</style>
