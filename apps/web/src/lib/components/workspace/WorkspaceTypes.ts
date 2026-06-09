export type FilePaneData = {
  kind: 'file'
  id: string
  path: string
  label: string
  content?: Uint8Array | null
  loading: boolean
}

export type TerminalPaneData = {
  kind: 'terminal'
  id: string
  sessionId: string
  label: string
}

export type PaneData = FilePaneData | TerminalPaneData

export interface Group {
  id: string
  panes: PaneData[]
  activeId: string | null
}

export type Layout =
  | { type: 'leaf'; groupId: string }
  | { type: 'split'; id: string; direction: 'h' | 'v'; children: Layout[]; sizes: number[] }

export type DropZone = 'top' | 'bottom' | 'left' | 'right' | 'center'

export const WORKSPACE_CTX = Symbol('workspace')

export interface WorkspaceCtx {
  projectId: string
  namespaceSlug: string
  projectSlug: string
  getActiveGroupId(): string
  setActiveGroupId(id: string): void
  closePane(groupId: string, paneId: string): void
  dropPane(paneId: string, fromGroupId: string, toGroupId: string, zone: DropZone): void
}
