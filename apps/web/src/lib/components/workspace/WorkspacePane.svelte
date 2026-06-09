<script lang="ts">
  import { getContext } from 'svelte'
  import type { PaneData, WorkspaceCtx } from './WorkspaceTypes.js'
  import { WORKSPACE_CTX } from './WorkspaceTypes.js'
  import FilePreview from '$lib/components/preview/FilePreview.svelte'
  import TerminalPane from '$lib/components/terminal/TerminalPane.svelte'

  let { pane, active }: { pane: PaneData; active: boolean } = $props()

  const ctx = getContext<WorkspaceCtx>(WORKSPACE_CTX)
</script>

<div class="workspace-pane" class:workspace-pane--active={active} aria-hidden={!active}>
  {#if pane.kind === 'file'}
    <FilePreview filename={pane.label} content={pane.content} loading={pane.loading} />
  {:else}
    <TerminalPane
      sessionId={pane.sessionId}
      sessionLabel={pane.label}
      projectId={ctx.projectId}
      namespaceSlug={ctx.namespaceSlug}
      projectSlug={ctx.projectSlug}
      onRename={(label) => {
        pane.label = label
      }}
    />
  {/if}
</div>

<style>
  .workspace-pane {
    display: none;
    flex-direction: column;
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .workspace-pane--active {
    display: flex;
  }
</style>
