import type { Component } from 'svelte'
import ImageViewer from './viewers/ImageViewer.svelte'
import VideoViewer from './viewers/VideoViewer.svelte'
import AudioViewer from './viewers/AudioViewer.svelte'
import MarkdownViewer from './viewers/MarkdownViewer.svelte'
import CodeViewer from './viewers/CodeViewer.svelte'
import TextViewer from './viewers/TextViewer.svelte'
import FallbackViewer from './viewers/FallbackViewer.svelte'

export interface FileViewer {
  id: string
  canPreview: (filename: string, mimeType?: string) => boolean
  component: Component<any>
  /** Maximum bytes to load for preview. Omit = load full file. */
  maxPreviewBytes?: number
}

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff', 'avif',
])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogv', 'mov', 'avi', 'mkv', 'm4v'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus'])
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'json', 'jsonc', 'yaml', 'yml', 'toml',
  'svelte', 'vue',
  'py', 'rs', 'go', 'java', 'kt', 'kts', 'swift',
  'c', 'h', 'hpp', 'cpp', 'cc', 'cxx', 'cs',
  'sh', 'bash', 'zsh', 'fish', 'ps1',
  'sql', 'graphql', 'gql', 'proto', 'xml',
  'rb', 'php', 'lua', 'r', 'scala',
  'nginx', 'ini', 'cfg', 'conf', 'env', 'diff',
])
const TEXT_EXTS = new Set([
  'txt', 'log', 'csv', 'tsv', 'rst', 'adoc', 'tex',
])

function ext(filename: string): string {
  const base = filename.split('/').pop() ?? filename
  return base.split('.').pop()?.toLowerCase() ?? ''
}

function baseName(filename: string): string {
  return (filename.split('/').pop() ?? filename).toLowerCase()
}

function mimeStartsWith(prefix: string, mimeType?: string): boolean {
  return !!mimeType && mimeType.startsWith(prefix)
}

// Internal registry array — first match wins
const _viewers: FileViewer[] = [
  {
    id: 'image',
    canPreview: (f, m) => IMAGE_EXTS.has(ext(f)) || mimeStartsWith('image/', m),
    component: ImageViewer as Component<any>,
    maxPreviewBytes: 20 * 1024 * 1024, // 20 MB
  },
  {
    id: 'video',
    canPreview: (f, m) => VIDEO_EXTS.has(ext(f)) || mimeStartsWith('video/', m),
    component: VideoViewer as Component<any>,
    maxPreviewBytes: 200 * 1024 * 1024, // 200 MB
  },
  {
    id: 'audio',
    canPreview: (f, m) => AUDIO_EXTS.has(ext(f)) || mimeStartsWith('audio/', m),
    component: AudioViewer as Component<any>,
    maxPreviewBytes: 50 * 1024 * 1024, // 50 MB
  },
  {
    id: 'markdown',
    canPreview: (f) => ext(f) === 'md' || ext(f) === 'mdx',
    component: MarkdownViewer as Component<any>,
    maxPreviewBytes: 2 * 1024 * 1024, // 2 MB
  },
  {
    id: 'code',
    canPreview: (f) => CODE_EXTS.has(ext(f)) || baseName(f) === 'dockerfile' || baseName(f) === 'makefile' || baseName(f).startsWith('.env'),
    component: CodeViewer as Component<any>,
    maxPreviewBytes: 1 * 1024 * 1024, // 1 MB
  },
  {
    id: 'text',
    canPreview: (f, m) => TEXT_EXTS.has(ext(f)) || (!!m && m === 'text/plain'),
    component: TextViewer as Component<any>,
    maxPreviewBytes: 2 * 1024 * 1024,
  },
]

// Fallback — always last
const _fallback: FileViewer = {
  id: 'fallback',
  canPreview: () => true,
  component: FallbackViewer as Component<any>,
  maxPreviewBytes: 512, // hex dump only shows 512 bytes
}

/**
 * Register an additional viewer.
 * @param viewer The viewer to register.
 * @param index  Insert at this position (0 = highest priority). Omit to append before fallback.
 */
export function registerViewer(viewer: FileViewer, index?: number): void {
  if (index !== undefined) {
    _viewers.splice(index, 0, viewer)
  } else {
    _viewers.push(viewer)
  }
}

/**
 * Resolve the best viewer for a given filename + optional MIME type.
 * Returns fallback viewer if nothing else matches.
 */
export function resolveViewer(filename: string, mimeType?: string): FileViewer {
  return _viewers.find((v) => v.canPreview(filename, mimeType)) ?? _fallback
}

export { CodeViewer, MarkdownViewer, ImageViewer, VideoViewer, AudioViewer, TextViewer, FallbackViewer }
