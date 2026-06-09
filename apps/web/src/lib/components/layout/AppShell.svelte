<script lang="ts">
  import type { Snippet } from 'svelte'
  import Sidebar from './Sidebar.svelte'
  import StatusBar from './StatusBar.svelte'
  import ResizableDivider from './ResizableDivider.svelte'

  let {
    sidebarContent,
    workspaceContent,
    statusLeftContent,
    statusRightContent,
  }: {
    sidebarContent?: Snippet
    workspaceContent?: Snippet
    statusLeftContent?: Snippet
    statusRightContent?: Snippet
  } = $props()

  let sidebarWidth = $state(240)
</script>

<div class="app-shell">
  <!-- Main content (sidebar + divider + editor/panel column) -->
  <div class="app-shell-main">
    <!-- Sidebar -->
    {#if sidebarContent}
      <Sidebar bind:width={sidebarWidth}>
        {@render sidebarContent()}
      </Sidebar>
      <ResizableDivider
        direction="horizontal"
        bind:size={sidebarWidth}
        minSize={150}
        maxSize={600}
      />
    {/if}

    <!-- Workspace column -->
    <div class="app-shell-center">
      {#if workspaceContent}
        {@render workspaceContent()}
      {:else}
        <div class="app-shell-empty">No workspace content</div>
      {/if}
    </div>
  </div>

  <!-- Status bar -->
  <StatusBar leftContent={statusLeftContent} rightContent={statusRightContent} />
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--color-bg-base);
  }

  .app-shell-main {
    display: flex;
    flex-direction: row;
    flex: 1;
    overflow: hidden;
    min-height: 0;
    position: relative;
  }

  .app-shell-center {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }

  .app-shell-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-disabled);
    font-size: var(--font-size-md);
  }
</style>
