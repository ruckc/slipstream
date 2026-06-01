<script lang="ts">
  import type { Snippet } from 'svelte'
  import ActivityBar from './ActivityBar.svelte'
  import Sidebar from './Sidebar.svelte'
  import EditorArea from './EditorArea.svelte'
  import PanelArea from './PanelArea.svelte'
  import StatusBar from './StatusBar.svelte'
  import ResizableDivider from './ResizableDivider.svelte'

  let {
    sidebarContent,
    editorContent,
    panelContent,
    statusLeftContent,
    statusRightContent,
    activityItems = [],
  }: {
    sidebarContent?: Snippet
    editorContent?: Snippet
    panelContent?: Snippet
    statusLeftContent?: Snippet
    statusRightContent?: Snippet
    activityItems?: Array<{ id: string; icon: string; label: string; onClick: () => void }>
  } = $props()

  let sidebarWidth = $state(240)
  let panelHeight = $state(220)
  let sidebarVisible = $state(true)
  let panelVisible = $state(true)
  let activeActivityItem = $state<string | null>('files')
</script>

<div class="app-shell">
  <!-- Activity Bar -->
  <ActivityBar items={activityItems} bind:activeId={activeActivityItem} />

  <!-- Main content (sidebar + divider + editor/panel column) -->
  <div class="app-shell-main">
    <!-- Sidebar -->
    {#if sidebarVisible}
      <Sidebar bind:width={sidebarWidth} title={activityItems.find(i => i.id === activeActivityItem)?.label}>
        {#if sidebarContent}
          {@render sidebarContent()}
        {/if}
      </Sidebar>
      <ResizableDivider direction="horizontal" bind:size={sidebarWidth} minSize={150} maxSize={600} />
    {/if}

    <!-- Editor + Panel column -->
    <div class="app-shell-center">
      <!-- Editor area -->
      <EditorArea>
        {#if editorContent}
          {@render editorContent()}
        {:else}
          <div class="app-shell-empty">No editor content</div>
        {/if}
      </EditorArea>

      <!-- Panel area -->
      {#if panelVisible}
        <ResizableDivider direction="vertical" bind:size={panelHeight} minSize={80} maxSize={600} inverted={true} />
        <PanelArea bind:height={panelHeight}>
          {#if panelContent}
            {@render panelContent()}
          {/if}
        </PanelArea>
      {/if}
    </div>
  </div>

  <!-- Status bar -->
  <StatusBar bind:panelVisible leftContent={statusLeftContent} rightContent={statusRightContent} />
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: var(--color-bg-base);
  }

  .app-shell-main {
    display: flex;
    flex-direction: row;
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }

  .app-shell-center {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    min-width: 0;
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
