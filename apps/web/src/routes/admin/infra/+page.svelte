<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity'
  import { getNamespaces, describePod, getPodLogs } from './infra.remote'

  type PodSummary = { name: string; phase: string; ready: boolean; restarts: number }
  type DeploymentSummary = { name: string; replicas: number; readyReplicas: number }
  type NamespaceSummary = { name: string; deployments: DeploymentSummary[]; pods: PodSummary[] }

  type InspectTarget = { namespace: string; pod: string }
  type DescribeResult = {
    pod: unknown
    events: {
      type?: string
      reason?: string
      message?: string
      count?: number
      lastTime?: string
    }[]
  }

  let namespaces = $state<NamespaceSummary[] | null>(null)
  let loadError = $state('')
  let expanded = new SvelteSet<string>()

  let selected = $state<InspectTarget | null>(null)
  let describeResult = $state<DescribeResult | null>(null)
  let describeLoading = $state(false)
  let describeError = $state('')

  let logs = $state<string>('')
  let logsLoading = $state(false)
  let logsError = $state('')
  let liveMode = $state(false)
  let liveSource = $state<EventSource | null>(null)

  $effect(() => {
    loadNamespaces()
  })

  async function loadNamespaces() {
    loadError = ''
    try {
      namespaces = (await getNamespaces()) as NamespaceSummary[]
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load'
    }
  }

  function toggle(ns: string) {
    if (expanded.has(ns)) expanded.delete(ns)
    else expanded.add(ns)
  }

  async function inspect(ns: string, pod: string) {
    stopLive()
    selected = { namespace: ns, pod }
    describeLoading = true
    describeError = ''
    describeResult = null
    logs = ''
    logsError = ''
    liveMode = false
    try {
      describeResult = (await describePod({ namespace: ns, pod })) as DescribeResult
    } catch (e) {
      describeError = e instanceof Error ? e.message : 'Failed to describe pod'
    } finally {
      describeLoading = false
    }
    fetchLogs(ns, pod)
  }

  async function fetchLogs(ns: string, pod: string) {
    logsLoading = true
    logsError = ''
    logs = ''
    try {
      logs = (await getPodLogs({ namespace: ns, pod, tail: 200 })) as string
    } catch (e) {
      logsError = e instanceof Error ? e.message : 'Failed to fetch logs'
    } finally {
      logsLoading = false
    }
  }

  function startLive() {
    if (!selected || liveSource) return
    logs = ''
    liveMode = true
    const es = new EventSource(
      `/api/admin/pods/${selected.namespace}/${selected.pod}/logs/stream`,
      { withCredentials: true }
    )
    es.onmessage = (e) => {
      logs += JSON.parse(e.data)
    }
    es.onerror = () => {
      liveMode = false
      liveSource = null
      es.close()
    }
    liveSource = es
  }

  function stopLive() {
    liveSource?.close()
    liveSource = null
    liveMode = false
  }

  function phaseClass(phase: string) {
    if (phase === 'Running') return 'phase--running'
    if (phase === 'Succeeded') return 'phase--success'
    if (phase === 'Failed' || phase === 'CrashLoopBackOff') return 'phase--error'
    return 'phase--pending'
  }
</script>

<svelte:head>
  <title>Infra — Admin — Slipstream</title>
</svelte:head>

<div class="infra">
  <div class="tree-pane">
    <div class="pane-header">
      <span class="pane-title">Namespaces</span>
      <button class="icon-btn" onclick={loadNamespaces} title="Refresh">↻</button>
    </div>

    {#if loadError}
      <p class="pane-error">{loadError}</p>
    {:else if namespaces === null}
      <p class="pane-loading">Loading…</p>
    {:else if namespaces.length === 0}
      <p class="pane-empty">No namespaces found.</p>
    {:else}
      <ul class="ns-list">
        {#each namespaces as ns (ns.name)}
          <li>
            <button
              class="ns-header"
              class:ns-header--expanded={expanded.has(ns.name)}
              onclick={() => toggle(ns.name)}
            >
              <span class="ns-chevron">{expanded.has(ns.name) ? '▾' : '▸'}</span>
              <span class="ns-name">{ns.name}</span>
              <span class="ns-count">{ns.pods.length}</span>
            </button>
            {#if expanded.has(ns.name)}
              <ul class="pod-list">
                {#each ns.pods as pod (pod.name)}
                  <li>
                    <button
                      class="pod-item"
                      class:pod-item--selected={selected?.namespace === ns.name &&
                        selected?.pod === pod.name}
                      onclick={() => inspect(ns.name, pod.name)}
                    >
                      <span class="pod-phase {phaseClass(pod.phase)}"></span>
                      <span class="pod-name">{pod.name}</span>
                      {#if pod.restarts > 0}
                        <span class="pod-restarts">{pod.restarts}↺</span>
                      {/if}
                    </button>
                  </li>
                {/each}
                {#if ns.pods.length === 0}
                  <li class="pod-empty">No pods</li>
                {/if}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="detail-pane">
    {#if !selected}
      <div class="detail-empty">Select a pod to inspect.</div>
    {:else}
      <div class="detail-header">
        <span class="detail-pod-name">{selected.pod}</span>
        <span class="detail-ns">({selected.namespace})</span>
      </div>

      <div class="detail-sections">
        <section class="section">
          <h2 class="section-title">Describe</h2>
          {#if describeLoading}
            <p class="section-loading">Loading…</p>
          {:else if describeError}
            <p class="section-error">{describeError}</p>
          {:else if describeResult}
            {#if describeResult.events.length > 0}
              <div class="events">
                {#each describeResult.events as ev, i (i)}
                  <div class="event" class:event--warning={ev.type === 'Warning'}>
                    <span class="event-reason">{ev.reason}</span>
                    <span class="event-message">{ev.message}</span>
                    {#if ev.count && ev.count > 1}
                      <span class="event-count">×{ev.count}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
            <pre class="yaml-block">{JSON.stringify(describeResult.pod, null, 2)}</pre>
          {/if}
        </section>

        <section class="section">
          <div class="section-header">
            <h2 class="section-title">Logs</h2>
            <div class="log-actions">
              {#if liveMode}
                <button class="log-btn log-btn--stop" onclick={stopLive}>Stop</button>
              {:else}
                <button
                  class="log-btn"
                  onclick={() => {
                    if (selected) fetchLogs(selected.namespace, selected.pod)
                  }}
                >
                  Refresh
                </button>
                <button class="log-btn log-btn--live" onclick={startLive}>Live tail</button>
              {/if}
            </div>
          </div>
          {#if logsLoading}
            <p class="section-loading">Loading…</p>
          {:else if logsError}
            <p class="section-error">{logsError}</p>
          {:else}
            <pre class="log-block">{logs || '(no output)'}</pre>
          {/if}
        </section>
      </div>
    {/if}
  </div>
</div>

<style>
  .infra {
    display: flex;
    height: calc(100vh - 35px - 2 * var(--space-6));
    gap: var(--space-4);
  }

  .tree-pane {
    width: 260px;
    flex-shrink: 0;
    background: var(--color-bg-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .pane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .pane-title {
    font-size: var(--font-size-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
  }

  .icon-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: var(--font-size-md);
    padding: 0 var(--space-1);
    line-height: 1;
  }

  .icon-btn:hover {
    color: var(--color-text-primary);
  }

  .pane-error,
  .pane-loading,
  .pane-empty {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    padding: var(--space-3);
  }

  .ns-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .ns-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-3);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    text-align: left;
  }

  .ns-header:hover {
    background: var(--color-bg-hover);
  }

  .ns-chevron {
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    width: 12px;
    flex-shrink: 0;
  }

  .ns-name {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ns-count {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    background: var(--color-bg-elevated);
    border-radius: 10px;
    padding: 0 var(--space-1);
    min-width: 18px;
    text-align: center;
  }

  .pod-list {
    list-style: none;
    margin: 0;
    padding: 0 0 0 var(--space-4);
  }

  .pod-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-3);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    text-align: left;
  }

  .pod-item:hover {
    background: var(--color-bg-hover);
    color: var(--color-text-primary);
  }

  .pod-item--selected {
    background: var(--color-bg-active);
    color: var(--color-text-primary);
  }

  .pod-phase {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--color-text-muted);
  }

  .phase--running {
    background: var(--color-success);
  }

  .phase--success {
    background: var(--color-text-muted);
  }

  .phase--error {
    background: var(--color-danger);
  }

  .phase--pending {
    background: var(--color-warning);
  }

  .pod-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pod-restarts {
    color: var(--color-warning);
  }

  .pod-empty {
    font-size: var(--font-size-xs);
    color: var(--color-text-disabled);
    padding: var(--space-1) var(--space-3);
  }

  .detail-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .detail-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .detail-header {
    padding: var(--space-2) 0 var(--space-4);
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }

  .detail-pod-name {
    font-size: var(--font-size-md);
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--color-text-primary);
  }

  .detail-ns {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .detail-sections {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-title {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 700;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .section-loading,
  .section-error {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .section-error {
    color: var(--color-danger);
  }

  .events {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }

  .event {
    display: flex;
    gap: var(--space-3);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    background: var(--color-bg-elevated);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-2);
  }

  .event--warning {
    color: var(--color-warning);
    background: rgba(204, 167, 0, 0.08);
  }

  .event-reason {
    font-weight: 700;
    white-space: nowrap;
  }

  .event-message {
    flex: 1;
  }

  .event-count {
    white-space: nowrap;
    color: var(--color-text-disabled);
  }

  .yaml-block,
  .log-block {
    background: var(--color-bg-base);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--color-text-primary);
    overflow: auto;
    white-space: pre;
    max-height: 400px;
    margin: 0;
  }

  .log-actions {
    display: flex;
    gap: var(--space-2);
  }

  .log-btn {
    height: 24px;
    padding: 0 var(--space-3);
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    cursor: pointer;
  }

  .log-btn:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-hover);
  }

  .log-btn--live {
    border-color: var(--color-success);
    color: var(--color-success);
  }

  .log-btn--stop {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
</style>
