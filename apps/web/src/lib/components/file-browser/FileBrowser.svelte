<script lang="ts">
  import { onMount } from 'svelte'
  import FileBreadcrumb from './FileBreadcrumb.svelte'
  import FileTree from './FileTree.svelte'
  import FileUploadDropZone from './FileUploadDropZone.svelte'
  import FileUploadQueue from './FileUploadQueue.svelte'
  import FileContextMenu from './FileContextMenu.svelte'
  import NewItemDialog from './NewItemDialog.svelte'
  import RenameDialog from './RenameDialog.svelte'
  import DeleteConfirmDialog from './DeleteConfirmDialog.svelte'
  import type { FileEntry } from './FileTreeFile.svelte'
  import type { UploadItem } from './FileUploadQueue.svelte'
  import { podFetch, podWsUrl } from '$lib/pod-fetch'
  import { tokenStore } from '$lib/token-store'
  import Icon from '$lib/components/common/Icon.svelte'
  import Button from '$lib/components/common/Button.svelte'
  import { uploadsFromFileList, type FileUpload } from './file-upload'

  const CHUNK_SIZE = 1024 * 1024 // 1 MB

  let {
    projectId,
    namespaceSlug,
    projectSlug,
    onOpenFile,
  }: {
    projectId: string
    namespaceSlug: string
    projectSlug: string
    onOpenFile: (path: string) => void
  } = $props()

  // Navigation state
  let currentPath = $state('/')
  let rootEntries = $state<FileEntry[]>([])
  let loading = $state(false)
  let loadError = $state<string | null>(null)
  let selectedPath = $state('')

  // Context menu state
  let ctxOpen = $state(false)
  let ctxX = $state(0)
  let ctxY = $state(0)
  let ctxEntry = $state<FileEntry | null>(null)
  let ctxPath = $state('')

  // Dialog state
  let newItemOpen = $state(false)
  let newItemMode = $state<'file' | 'folder'>('file')
  let newItemParent = $state('/')
  let renameOpen = $state(false)
  let renamePath = $state('')
  let deleteOpen = $state(false)
  let deletePath = $state('')
  let deleteType = $state<'file' | 'dir'>('file')

  // Upload queue
  let uploadItems = $state<UploadItem[]>([])

  async function loadDirectory(path: string) {
    loading = true
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
      rootEntries = data.entries ?? []
      currentPath = path
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load directory'
    } finally {
      loading = false
    }
  }

  let watchWs: WebSocket | null = null
  let reloadTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleReload() {
    if (reloadTimer !== null) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      loadDirectory(currentPath)
    }, 150)
  }

  async function connectWatchWs(path: string) {
    watchWs?.close()
    watchWs = null
    try {
      const token = await tokenStore.get(projectId)
      const url = podWsUrl(
        namespaceSlug,
        projectSlug,
        '/fs/watch?path=' + encodeURIComponent(path),
        token
      )
      const ws = new WebSocket(url)
      ws.onmessage = () => scheduleReload()
      ws.onclose = () => {
        if (watchWs === ws) watchWs = null
      }
      watchWs = ws
    } catch {
      // watch is best-effort; polling still works via manual refresh
    }
  }

  onMount(() => {
    loadDirectory('/')
  })

  $effect(() => {
    connectWatchWs(currentPath)
    return () => {
      watchWs?.close()
      watchWs = null
      if (reloadTimer !== null) {
        clearTimeout(reloadTimer)
        reloadTimer = null
      }
    }
  })

  function handleNavigate(path: string) {
    loadDirectory(path)
  }

  function handleOpenFile(path: string) {
    selectedPath = path
    onOpenFile(path)
  }

  function handleContextMenu(e: MouseEvent, entry: FileEntry, path: string) {
    ctxEntry = entry
    ctxPath = path
    ctxX = e.clientX
    ctxY = e.clientY
    ctxOpen = true
  }

  function handleCtxOpen(path: string) {
    handleOpenFile(path)
  }

  async function handleCtxDownload(path: string) {
    const filename = path.split('/').pop() ?? 'download'
    const res = await podFetch(
      projectId,
      namespaceSlug,
      projectSlug,
      '/fs/download?path=' + encodeURIComponent(path)
    )
    if (!res.ok) throw new Error('Download failed: ' + res.status)

    if ('showSaveFilePicker' in window && res.body) {
      try {
        const handle = await (
          window as Window & { showSaveFilePicker: (o: object) => Promise<FileSystemFileHandle> }
        ).showSaveFilePicker({ suggestedName: filename })
        const writable = await handle.createWritable()
        await res.body.pipeTo(writable)
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
        // API failed — fall through to blob
      }
    }

    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    a.click()
    URL.revokeObjectURL(blobUrl)
  }

  function handleCtxRename(path: string) {
    renamePath = path
    renameOpen = true
  }

  function handleCtxDelete(path: string, type: 'file' | 'dir') {
    deletePath = path
    deleteType = type
    deleteOpen = true
  }

  function handleCtxNewFile(dirPath: string) {
    newItemMode = 'file'
    newItemParent = dirPath
    newItemOpen = true
  }

  function handleCtxNewFolder(dirPath: string) {
    newItemMode = 'folder'
    newItemParent = dirPath
    newItemOpen = true
  }

  async function handleCreate(path: string) {
    const isFolder = newItemMode === 'folder'
    if (isFolder) {
      const res = await podFetch(
        projectId,
        namespaceSlug,
        projectSlug,
        '/fs/mkdir?path=' + encodeURIComponent(path),
        { method: 'POST' }
      )
      if (!res.ok) throw new Error('Create folder failed: ' + res.status)
    } else {
      const res = await podFetch(
        projectId,
        namespaceSlug,
        projectSlug,
        '/fs/write?path=' + encodeURIComponent(path),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Uint8Array(0),
        }
      )
      if (!res.ok) throw new Error('Create file failed: ' + res.status)
    }
    await loadDirectory(currentPath)
  }

  async function handleRename(oldPath: string, newPath: string) {
    const res = await podFetch(projectId, namespaceSlug, projectSlug, '/fs/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: oldPath, to: newPath }),
    })
    if (!res.ok) throw new Error('Rename failed: ' + res.status)
    await loadDirectory(currentPath)
  }

  async function handleDelete(path: string) {
    const res = await podFetch(
      projectId,
      namespaceSlug,
      projectSlug,
      '/fs/delete?path=' + encodeURIComponent(path),
      {
        method: 'DELETE',
      }
    )
    if (!res.ok) throw new Error('Delete failed: ' + res.status)
    await loadDirectory(currentPath)
  }

  function handleUpload(uploads: FileUpload[], targetPath: string) {
    const base = targetPath.endsWith('/') ? targetPath : targetPath + '/'
    for (const upload of uploads) {
      const id = Math.random().toString(36).slice(2)
      let cancelled = false
      const item: UploadItem = {
        id,
        filename: upload.relativePath,
        progress: 0,
        error: null,
        cancel: () => {
          cancelled = true
        },
      }
      uploadItems = [...uploadItems, item]
      const dest = base + upload.relativePath
      uploadFile(upload.file, dest, id, () => cancelled)
    }
  }

  async function uploadFile(file: File, destPath: string, id: string, isCancelled: () => boolean) {
    const total = file.size
    let offset = 0
    try {
      while (offset < total || total === 0) {
        if (isCancelled()) {
          updateUpload(id, { error: 'Cancelled' })
          return
        }
        const end = Math.min(offset + CHUNK_SIZE, total)
        const chunk = file.slice(offset, end)
        const res = await podFetch(
          projectId,
          namespaceSlug,
          projectSlug,
          '/fs/write?path=' + encodeURIComponent(destPath),
          {
            method: 'PUT',
            headers: {
              'Content-Range': `bytes ${offset}-${end - 1}/${total}`,
              'Content-Type': 'application/octet-stream',
            },
            body: chunk,
          }
        )
        if (!res.ok) throw new Error('Upload failed: ' + res.status)
        offset = end
        const progress = total === 0 ? 100 : Math.round((offset / total) * 100)
        updateUpload(id, { progress })
        if (total === 0 || offset >= total) break
      }
      updateUpload(id, { progress: 100 })
      await loadDirectory(currentPath)
    } catch (err) {
      if (!isCancelled()) {
        updateUpload(id, { error: err instanceof Error ? err.message : 'Upload failed' })
      }
    }
  }

  function updateUpload(id: string, patch: Partial<Pick<UploadItem, 'progress' | 'error'>>) {
    uploadItems = uploadItems.map((item) => (item.id === id ? { ...item, ...patch } : item))
  }

  function dismissUpload(id: string) {
    uploadItems = uploadItems.filter((i) => i.id !== id)
  }

  let hasActiveUploads = $derived(uploadItems.length > 0)

  function handleNewItemHere() {
    newItemMode = 'file'
    newItemParent = currentPath
    newItemOpen = true
  }

  function handleNewFolderHere() {
    newItemMode = 'folder'
    newItemParent = currentPath
    newItemOpen = true
  }

  let fileInputEl = $state<HTMLInputElement | undefined>(undefined)
  let dirInputEl = $state<HTMLInputElement | undefined>(undefined)

  function handleUploadButton() {
    fileInputEl?.click()
  }

  function handleUploadDirButton() {
    dirInputEl?.click()
  }

  function handleFileInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    if (input.files && input.files.length > 0) {
      handleUpload(uploadsFromFileList(input.files), currentPath)
    }
    input.value = ''
  }
</script>

<div class="file-browser">
  <div class="file-browser-toolbar">
    <FileBreadcrumb path={currentPath} onNavigate={handleNavigate} />
    <div class="file-browser-actions">
      <Button variant="ghost" size="sm" onclick={() => loadDirectory(currentPath)} title="Refresh">
        <Icon name="refresh" size={12} />
      </Button>
      <Button variant="ghost" size="sm" onclick={handleNewItemHere} title="New File">
        <Icon name="file" size={12} />
      </Button>
      <Button variant="ghost" size="sm" onclick={handleNewFolderHere} title="New Folder">
        <Icon name="folder" size={12} />
      </Button>
      <Button variant="ghost" size="sm" onclick={handleUploadButton} title="Upload Files">
        <Icon name="upload" size={12} />
      </Button>
      <Button variant="ghost" size="sm" onclick={handleUploadDirButton} title="Upload Folder">
        <Icon name="folder" size={12} />
      </Button>
    </div>
  </div>
  <input
    bind:this={fileInputEl}
    type="file"
    multiple
    class="upload-input-hidden"
    onchange={handleFileInputChange}
  />
  <input
    bind:this={dirInputEl}
    type="file"
    webkitdirectory
    class="upload-input-hidden"
    onchange={handleFileInputChange}
  />

  <div class="file-browser-body">
    {#if loading}
      <div class="file-browser-loading">
        <span class="loading-spinner" aria-label="Loading"></span>
      </div>
    {:else if loadError}
      <div class="file-browser-error">
        <Icon name="warning" size={16} />
        <span>{loadError}</span>
        <Button variant="ghost" size="sm" onclick={() => loadDirectory(currentPath)}>Retry</Button>
      </div>
    {:else}
      <FileUploadDropZone targetPath={currentPath} onUpload={handleUpload}>
        <FileTree
          entries={rootEntries}
          {currentPath}
          {projectId}
          {namespaceSlug}
          {projectSlug}
          {selectedPath}
          onOpenFile={handleOpenFile}
          onContextMenu={handleContextMenu}
          onUpload={handleUpload}
        />
      </FileUploadDropZone>
    {/if}

    {#if hasActiveUploads}
      <FileUploadQueue items={uploadItems} onDismiss={dismissUpload} />
    {/if}
  </div>
</div>

<FileContextMenu
  bind:open={ctxOpen}
  x={ctxX}
  y={ctxY}
  entry={ctxEntry}
  path={ctxPath}
  onOpen={handleCtxOpen}
  onDownload={handleCtxDownload}
  onRename={handleCtxRename}
  onDelete={handleCtxDelete}
  onNewFile={handleCtxNewFile}
  onNewFolder={handleCtxNewFolder}
/>

<NewItemDialog
  bind:open={newItemOpen}
  mode={newItemMode}
  parentPath={newItemParent}
  onCreate={handleCreate}
/>

<RenameDialog bind:open={renameOpen} currentPath={renamePath} onRename={handleRename} />

<DeleteConfirmDialog
  bind:open={deleteOpen}
  path={deletePath}
  type={deleteType}
  onDelete={handleDelete}
/>

<style>
  .file-browser {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-bg-surface);
    overflow: hidden;
  }

  .file-browser-toolbar {
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .file-browser-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 var(--space-1);
    flex-shrink: 0;
  }

  .file-browser-body {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .file-browser-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }

  .loading-spinner {
    display: block;
    width: 20px;
    height: 20px;
    border: 2px solid var(--color-border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .file-browser-error {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-3);
    font-size: var(--font-size-sm);
    color: var(--color-danger);
  }

  .upload-input-hidden {
    display: none;
  }
</style>
