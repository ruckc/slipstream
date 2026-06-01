<script lang="ts">
  import ContextMenu from '$lib/components/common/ContextMenu.svelte'
  import type { ContextMenuItem } from '$lib/components/common/ContextMenu.svelte'
  import type { FileEntry } from './FileTreeFile.svelte'

  let {
    open = $bindable(false),
    x,
    y,
    entry,
    path,
    onOpen,
    onDownload,
    onRename,
    onDelete,
    onNewFile,
    onNewFolder,
  }: {
    open?: boolean
    x: number
    y: number
    entry: FileEntry | null
    path: string
    onOpen: (path: string) => void
    onDownload: (path: string) => void
    onRename: (path: string) => void
    onDelete: (path: string, type: 'file' | 'dir') => void
    onNewFile: (dirPath: string) => void
    onNewFolder: (dirPath: string) => void
  } = $props()

  let items = $derived.by<ContextMenuItem[]>(() => {
    if (!entry) return []
    if (entry.type === 'file') {
      return [
        { label: 'Open', icon: 'file', action: () => onOpen(path) },
        { label: 'Download', icon: 'download', action: () => onDownload(path) },
        { label: '', separator: true, action: () => {} },
        { label: 'Rename', icon: 'edit', action: () => onRename(path) },
        { label: 'Delete', icon: 'trash', action: () => onDelete(path, 'file') },
      ]
    } else {
      return [
        { label: 'New File', icon: 'file', action: () => onNewFile(path) },
        { label: 'New Folder', icon: 'folder', action: () => onNewFolder(path) },
        { label: '', separator: true, action: () => {} },
        { label: 'Rename', icon: 'edit', action: () => onRename(path) },
        { label: 'Delete', icon: 'trash', action: () => onDelete(path, 'dir') },
      ]
    }
  })
</script>

<ContextMenu bind:open {x} {y} {items} />
