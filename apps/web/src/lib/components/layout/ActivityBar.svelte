<script lang="ts">
  import ActivityBarItem from './ActivityBarItem.svelte'
  import Tooltip from '$lib/components/common/Tooltip.svelte'
  import Icon from '$lib/components/common/Icon.svelte'

  let {
    items,
    activeId = $bindable<string | null>(null),
  }: {
    items: Array<{ id: string; icon: string; label: string; onClick: () => void }>
    activeId?: string | null
  } = $props()
</script>

<nav class="activity-bar" aria-label="Activity bar">
  <div class="activity-bar-top">
    {#each items as item}
      <ActivityBarItem
        icon={item.icon}
        label={item.label}
        active={activeId === item.id}
        onclick={() => {
          item.onClick()
          activeId = item.id
        }}
      />
    {/each}
  </div>

  <div class="activity-bar-bottom">
    <Tooltip text="Accounts" position="right" delay={400}>
      <button class="activity-item" aria-label="Accounts" type="button">
        <Icon name="user" size={24} />
      </button>
    </Tooltip>
    <Tooltip text="Settings" position="right" delay={400}>
      <button class="activity-item" aria-label="Settings" type="button">
        <Icon name="settings" size={24} />
      </button>
    </Tooltip>
  </div>
</nav>

<style>
  .activity-bar {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    width: 48px;
    min-width: 48px;
    height: 100%;
    background: var(--color-activitybar-bg);
    flex-shrink: 0;
  }

  .activity-bar-top {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .activity-bar-bottom {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-bottom: var(--space-2);
  }

  .activity-item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    color: var(--color-activitybar-fg);
    border-left: 2px solid transparent;
    transition: color var(--transition-fast);
  }

  .activity-item:hover {
    color: var(--color-activitybar-active-fg);
  }
</style>
