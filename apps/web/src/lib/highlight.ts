/**
 * Shiki highlighter singleton for Slipstream.
 * Uses the css-variables theme so token colors are driven by CSS custom properties.
 */
import { createHighlighter, type Highlighter } from 'shiki'

let highlighterPromise: Promise<Highlighter> | null = null

// All languages we want to support — loaded lazily via the bundle
const SUPPORTED_LANGS = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'html',
  'css',
  'scss',
  'less',
  'json',
  'yaml',
  'toml',
  'markdown',
  'mdx',
  'svelte',
  'vue',
  'python',
  'rust',
  'go',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'bash',
  'sh',
  'zsh',
  'fish',
  'powershell',
  'dockerfile',
  'sql',
  'graphql',
  'proto',
  'xml',
  'ruby',
  'php',
  'lua',
  'r',
  'scala',
  'nginx',
  'ini',
  'env',
  'diff',
  'git-commit',
  'text',
] as const

export type SupportedLang = (typeof SUPPORTED_LANGS)[number]

/** Returns (and caches) the Shiki highlighter instance. */
export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['css-variables'],
      langs: [...SUPPORTED_LANGS],
    }).catch((err) => {
      // Reset so next call retries
      highlighterPromise = null
      throw err
    })
  }
  return highlighterPromise
}

/** Maps a filename (or extension) to a Shiki language id. */
export function extensionToLang(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'less',
    json: 'json',
    jsonc: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    md: 'markdown',
    mdx: 'mdx',
    svelte: 'svelte',
    vue: 'vue',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    cs: 'csharp',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'fish',
    ps1: 'powershell',
    dockerfile: 'dockerfile',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
    proto: 'proto',
    xml: 'xml',
    rb: 'ruby',
    php: 'php',
    lua: 'lua',
    r: 'r',
    scala: 'scala',
    nginx: 'nginx',
    ini: 'ini',
    env: 'env',
    diff: 'diff',
    txt: 'text',
  }
  // Special filenames
  const baseName = filename.split('/').pop()?.toLowerCase() ?? ''
  if (baseName === 'dockerfile') return 'dockerfile'
  if (baseName === '.env' || baseName.startsWith('.env.')) return 'bash'
  if (baseName === 'makefile') return 'bash'
  if (baseName === 'nginx.conf') return 'nginx'

  return map[ext] ?? 'text'
}

/** Returns true if the file extension is recognized as a code/text format. */
export function isCodeFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const codeExts = new Set([
    'ts',
    'tsx',
    'js',
    'jsx',
    'mjs',
    'cjs',
    'html',
    'htm',
    'css',
    'scss',
    'sass',
    'less',
    'json',
    'jsonc',
    'yaml',
    'yml',
    'toml',
    'md',
    'mdx',
    'svelte',
    'vue',
    'py',
    'rs',
    'go',
    'java',
    'kt',
    'kts',
    'swift',
    'c',
    'h',
    'cpp',
    'cc',
    'cxx',
    'cs',
    'sh',
    'bash',
    'zsh',
    'fish',
    'ps1',
    'dockerfile',
    'sql',
    'graphql',
    'gql',
    'proto',
    'xml',
    'rb',
    'php',
    'lua',
    'r',
    'scala',
    'nginx',
    'ini',
    'env',
    'diff',
    'txt',
  ])
  const baseName = filename.split('/').pop()?.toLowerCase() ?? ''
  if (baseName === 'dockerfile' || baseName === 'makefile' || baseName === 'nginx.conf') return true
  if (baseName.startsWith('.env')) return true
  return codeExts.has(ext)
}
