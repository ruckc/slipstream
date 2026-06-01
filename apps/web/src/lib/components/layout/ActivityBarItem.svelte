<script lang="ts">
  import Icon from '$lib/components/common/Icon.svelte'
  import Tooltip from '$lib/components/common/Tooltip.svelte'

  let {
    icon,
    label,
    active,
    onclick,
  }: {
    icon: string
    label: string
    active: boolean
    onclick: () => void
  } = $props()
</script>

<Tooltip text={label} position="right" delay={400}>
  <button
    class="activity-item"
    class:activity-item--active={active}
    {onclick}
    aria-label={label}
    aria-pressed={active}
    type="button"
  >
    <Icon name={icon} size={24} />
  </button>
</Tooltip>

<style>
  .activity-item {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    color: var(--color-activitybar-fg);
    border-left: 2px solid transparent;
    transition: color var(--transition-fast);
    position: relative;
  }

  .activity-item:hover {
    color: var(--color-activitybar-active-fg);
  }

  .activity-item--active {
    color: var(--color-activitybar-active-fg);
    border-left-color: var(--color-activitybar-active-border);
  }
</style>
