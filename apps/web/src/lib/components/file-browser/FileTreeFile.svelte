<script lang="ts">
  import Icon from '$lib/components/common/Icon.svelte'

  export interface FileEntry {
    name: string
    type: 'file' | 'dir'
    size: number
    modified: string
  }

  let {
    entry,
    depth,
    path,
    selected = false,
    onOpenFile,
    onContextMenu,
  }: {
    entry: FileEntry
    depth: number
    path: string
    selected?: boolean
    onOpenFile: (path: string) => void
    onContextMenu: (e: MouseEvent, entry: FileEntry, path: string) => void
  } = $props()

  function getIcon(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff'])
    const videoExts = new Set(['mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv'])
    const audioExts = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'])
    const codeExts = new Set([
      'ts', 'tsx', 'js', 'jsx', 'mjs', 'html', 'htm', 'css', 'scss', 'sass', 'less',
      'json', 'jsonc', 'yaml', 'yml', 'toml', 'svelte', 'vue', 'py', 'rs', 'go',
      'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cc', 'cs', 'sh', 'bash', 'ps1',
      'sql', 'graphql', 'proto', 'rb', 'php', 'lua', 'r', 'scala',
    ])
    const textExts = new Set(['md', 'mdx', 'txt', 'log', 'env', 'ini', 'cfg', 'conf', 'xml'])
    const baseName = name.toLowerCase()
    if (baseName === 'dockerfile' || baseName === 'makefile') return 'file-code'
    if (imageExts.has(ext)) return 'file-image'
    if (videoExts.has(ext)) return 'file-video'
    if (audioExts.has(ext)) return 'file-audio'
    if (codeExts.has(ext)) return 'file-code'
    if (textExts.has(ext)) return 'file-text'
    return 'file'
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
  }

  function formatRelative(isoDate: string): string {
    const date = new Date(isoDate)
    if (isNaN(date.getTime())) return ''
    const now = Date.now()
    const diff = now - date.getTime()
    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    const week = 7 * day
    const month = 30 * day
    if (diff < minute) return 'just now'
    if (diff < hour) return Math.floor(diff / minute) + 'm ago'
    if (diff < day) return Math.floor(diff / hour) + 'h ago'
    if (diff < week) return Math.floor(diff / day) + 'd ago'
    if (diff < month) return Math.floor(diff / week) + 'w ago'
    return date.toLocaleDateString()
  }

  let icon = $derived(getIcon(entry.name))
  let sizeLabel = $derived(formatSize(entry.size))
  let modifiedLabel = $derived(formatRelative(entry.modified))
</script>

<button
  class="file-row"
  class:file-row--selected={selected}
  style="padding-left: calc(var(--space-2) + {depth * 16}px)"
  onclick={() => onOpenFile(path)}
  oncontextmenu={(e) => { e.preventDefault(); onContextMenu(e, entry, path) }}
  title={path}
  aria-label={entry.name}
>
  <span class="file-icon">
    <Icon name={icon} size={14} />
  </span>
  <span class="file-name">{entry.name}</span>
  <span class="file-meta">
    {#if modifiedLabel}
      <span class="file-modified">{modifiedLabel}</span>
    {/if}
    <span class="file-size">{sizeLabel}</span>
  </span>
</button>

<style>
  .file-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    width: 100%;
    height: 22px;
    padding-right: var(--space-3);
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    text-align: left;
    border-radius: 0;
    cursor: pointer;
    transition: background var(--transition-fast);
    white-space: nowrap;
  }

  .file-row:hover {
    background: var(--color-bg-hover);
  }

  .file-row--selected {
    background: var(--color-bg-selection);
  }

  .file-row--selected:hover {
    background: var(--color-bg-selection);
  }

  .file-icon {
    display: flex;
    align-items: center;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
    margin-left: auto;
    padding-left: var(--space-2);
  }

  .file-modified {
    font-size: var(--font-size-xs);
    color: var(--color-text-disabled);
  }

  .file-size {
    font-size: var(--font-size-xs);
    color: var(--color-text-disabled);
    font-variant-numeric: tabular-nums;
    min-width: 48px;
    text-align: right;
  }
</style>
