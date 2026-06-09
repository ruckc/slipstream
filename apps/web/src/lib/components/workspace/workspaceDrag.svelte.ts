class DragStore {
  dragging = $state<{ paneId: string; groupId: string } | null>(null)

  start(paneId: string, groupId: string) {
    this.dragging = { paneId, groupId }
  }

  end() {
    this.dragging = null
  }
}

export const workspaceDrag = new DragStore()
