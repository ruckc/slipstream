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

export type PodLogsPaneData = {
  kind: 'pod-logs'
  id: string
  label: string
  logs: string | null
  loading: boolean
}

export type PodDescribePaneData = {
  kind: 'pod-describe'
  id: string
  label: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pod: Record<string, any> | null
  loading: boolean
}

export type PaneData = FilePaneData | TerminalPaneData | PodLogsPaneData | PodDescribePaneData

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

export interface TerminalActions {
  clear: () => void
  kill: () => void
}

export interface WorkspaceCtx {
  projectId: string
  namespaceSlug: string
  projectSlug: string
  canShell: boolean
  getActiveGroupId(): string
  setActiveGroupId(id: string): void
  closePane(groupId: string, paneId: string): void
  dropPane(paneId: string, fromGroupId: string, toGroupId: string, zone: DropZone): void
  refreshPodLogs(paneId: string): void
  refreshPodDescribe(paneId: string): void
  createTerminal(): void
  openPodLogs(): void
  openPodDescribe(): void
  registerTerminalActions(paneId: string, actions: TerminalActions): void
  unregisterTerminalActions(paneId: string): void
  getTerminalActions(paneId: string): TerminalActions | undefined
  getAllPanes(): PaneData[]
  getActivePane(): PaneData | null
  setActivePaneById(paneId: string): void
}
