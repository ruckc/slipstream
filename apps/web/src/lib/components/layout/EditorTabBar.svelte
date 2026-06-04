<script lang="ts">
  import EditorTab from './EditorTab.svelte'

  let {
    tabs,
    activeTab = $bindable(null as string | null),
    onClose,
  }: {
    tabs: Array<{ id: string; label: string; icon?: string; dirty?: boolean }>
    activeTab?: string | null
    onClose: (id: string) => void
  } = $props()

  function activateTab(id: string) {
    activeTab = id
  }
</script>

<div class="tab-bar" role="tablist" aria-label="Open editors">
  {#each tabs as tab (tab.id)}
    <EditorTab
      id={tab.id}
      label={tab.label}
      icon={tab.icon}
      dirty={tab.dirty ?? false}
      active={activeTab === tab.id}
      onActivate={activateTab}
      {onClose}
    />
  {/each}
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: flex-end;
    height: 35px;
    background: var(--color-tab-bg);
    overflow-x: auto;
    overflow-y: hidden;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  /* Hide scrollbar but keep functionality */
  .tab-bar::-webkit-scrollbar {
    height: 3px;
  }

  .tab-bar::-webkit-scrollbar-track {
    background: transparent;
  }

  .tab-bar::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 0;
  }

  @media (max-width: 639px) {
    .tab-bar {
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }

    .tab-bar::-webkit-scrollbar {
      display: none;
    }
  }
</style>
