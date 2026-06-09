<script lang="ts">
  import type { Snippet } from 'svelte'
  import ActivityBar from './ActivityBar.svelte'
  import Sidebar from './Sidebar.svelte'
  import StatusBar from './StatusBar.svelte'
  import ResizableDivider from './ResizableDivider.svelte'

  let {
    sidebarContent,
    workspaceContent,
    statusLeftContent,
    statusRightContent,
    activityItems = [],
  }: {
    sidebarContent?: Snippet
    workspaceContent?: Snippet
    statusLeftContent?: Snippet
    statusRightContent?: Snippet
    activityItems?: Array<{ id: string; icon: string; label: string; onClick: () => void }>
  } = $props()

  let sidebarWidth = $state(240)
  const _initiallyMobile =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
  let isMobile = $state(_initiallyMobile)
  let sidebarVisible = $state(!_initiallyMobile)
  let activeActivityItem = $state<string | null>('files')

  $effect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    isMobile = mq.matches
    const handler = (e: MediaQueryListEvent) => {
      isMobile = e.matches
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  })

  // On mobile, activity item taps toggle the sidebar
  const wrappedItems = $derived(
    activityItems.map((item) => ({
      ...item,
      onClick: () => {
        item.onClick()
        if (isMobile) {
          if (activeActivityItem === item.id && sidebarVisible) {
            sidebarVisible = false
          } else {
            sidebarVisible = true
          }
        }
      },
    }))
  )
</script>

<div class="app-shell">
  <!-- Mobile backdrop: closes sidebar when tapped -->
  {#if sidebarVisible && isMobile}
    <button
      class="mobile-backdrop"
      onclick={() => {
        sidebarVisible = false
      }}
      aria-label="Close sidebar"
      tabindex="-1"
    ></button>
  {/if}

  <!-- Main content (activity bar + sidebar + divider + editor/panel column) -->
  <div class="app-shell-main">
    <!-- Activity Bar -->
    <ActivityBar items={wrappedItems} bind:activeId={activeActivityItem} />

    <!-- Sidebar -->
    {#if sidebarVisible}
      <Sidebar
        bind:width={sidebarWidth}
        title={activityItems.find((i) => i.id === activeActivityItem)?.label}
      >
        {#if sidebarContent}
          {@render sidebarContent()}
        {/if}
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
    position: fixed;
    inset: 0;
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

  .mobile-backdrop {
    display: none;
  }

  @media (max-width: 639px) {
    .mobile-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 99;
      background: rgba(0, 0, 0, 0.4);
      border: none;
      padding: 0;
      cursor: default;
    }
  }
</style>
