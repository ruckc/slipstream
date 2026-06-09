<script lang="ts">
  import { page } from '$app/state'
  import {
    getNamespaceSettings,
    updateOrgName,
    updateNamespaceIdleTimeout,
    inviteMember,
    setMemberRole,
    removeMember,
    updateEgressFilterEnabled,
    updateEgressListMode,
    addNamespaceEgressRule,
    removeNamespaceEgressRule,
  } from './settings.remote'
  import Button from '$lib/components/common/Button.svelte'
  import Input from '$lib/components/common/Input.svelte'
  import Icon from '$lib/components/common/Icon.svelte'

  const data = await getNamespaceSettings(page.params.namespace!)

  const isOrg = $derived(data.type === 'org')

  let inviteEmail = $state('')
  let idleTimeout = $state(
    data.type === 'org'
      ? String(data.org?.idleTimeoutSeconds ?? '')
      : String(data.user.idleTimeoutSeconds ?? '')
  )
  let orgName = $state(data.type === 'org' ? (data.org?.displayName ?? '') : '')

  let egressAllowRules = $state(data.egressAllowRules)
  let egressDenyRules = $state(data.egressDenyRules)
  let newAllowDomain = $state('')
  let newAllowPorts = $state('80,443')
  let newDenyDomain = $state('')

  async function toggleEgressFilter() {
    await updateEgressFilterEnabled({
      namespaceSlug: page.params.namespace!,
      enabled: !data.namespace.egressFilterEnabled,
    })
    data.namespace.egressFilterEnabled = !data.namespace.egressFilterEnabled
  }

  async function setListMode(mode: 'force' | 'merge') {
    await updateEgressListMode({ namespaceSlug: page.params.namespace!, mode })
    data.namespace.egressListMode = mode
  }

  async function addAllowRule() {
    const domain = newAllowDomain.trim().toLowerCase()
    const ports = newAllowPorts
      .split(',')
      .map((p) => parseInt(p.trim(), 10))
      .filter((p) => !isNaN(p) && p > 0)
    if (!domain || ports.length === 0) return
    const rule = await addNamespaceEgressRule({
      namespaceSlug: page.params.namespace!,
      ruleType: 'allow',
      domain,
      ports,
    })
    egressAllowRules = [...egressAllowRules, rule]
    newAllowDomain = ''
    newAllowPorts = '80,443'
  }

  async function removeAllowRule(ruleId: string) {
    await removeNamespaceEgressRule({ namespaceSlug: page.params.namespace!, ruleId })
    egressAllowRules = egressAllowRules.filter((r) => r.id !== ruleId)
  }

  async function addDenyRule() {
    const domain = newDenyDomain.trim().toLowerCase()
    if (!domain) return
    const rule = await addNamespaceEgressRule({
      namespaceSlug: page.params.namespace!,
      ruleType: 'deny',
      domain,
      ports: [],
    })
    egressDenyRules = [...egressDenyRules, rule]
    newDenyDomain = ''
  }

  async function removeDenyRule(ruleId: string) {
    await removeNamespaceEgressRule({ namespaceSlug: page.params.namespace!, ruleId })
    egressDenyRules = egressDenyRules.filter((r) => r.id !== ruleId)
  }
</script>

<svelte:head>
  <title>Settings — {data.namespace.slug} — Slipstream</title>
</svelte:head>

<div class="settings-page">
  <div class="settings-header">
    <a href="/{data.namespace.slug}" class="back-link">
      <Icon name="chevron-right" size={12} />
      {data.namespace.slug}
    </a>
    <h1 class="settings-title">
      {isOrg ? 'Organization Settings' : 'Namespace Settings'}
    </h1>
  </div>

  <div class="settings-sections">
    <!-- Org display name (org only) -->
    {#if isOrg && data.org}
      <section class="settings-section">
        <h2 class="section-title">Organization</h2>
        <form {...updateOrgName} class="section-form">
          <input type="hidden" name="namespaceSlug" value={page.params.namespace!} />
          <Input
            label="Display name"
            name="displayName"
            bind:value={orgName}
            required
            error={updateOrgName.fields.displayName?.issues()?.[0]?.message}
          />
          {#if updateOrgName.result?.success}
            <div class="form-success" role="status">Saved.</div>
          {/if}
          <div class="form-actions">
            <Button type="submit" variant="primary" loading={updateOrgName.pending > 0}>Save</Button
            >
          </div>
        </form>
      </section>
    {/if}

    <!-- Idle timeout -->
    <section class="settings-section">
      <h2 class="section-title">Idle timeout</h2>
      <p class="section-desc">
        Default idle timeout for projects in this namespace (seconds). Leave blank to use the system
        default.
      </p>
      <form {...updateNamespaceIdleTimeout} class="section-form">
        <input type="hidden" name="namespaceSlug" value={page.params.namespace!} />
        <Input
          label="Idle timeout (seconds)"
          name="idleTimeoutSeconds"
          type="text"
          bind:value={idleTimeout}
          placeholder="1800 (system default)"
          error={updateNamespaceIdleTimeout.fields.idleTimeoutSeconds?.issues()?.[0]?.message}
        />
        {#if updateNamespaceIdleTimeout.result?.success}
          <div class="form-success" role="status">Saved.</div>
        {/if}
        <div class="form-actions">
          <Button type="submit" variant="primary" loading={updateNamespaceIdleTimeout.pending > 0}
            >Save</Button
          >
        </div>
      </form>
    </section>

    <!-- Members (org only) -->
    {#if isOrg && data.members}
      <section class="settings-section">
        <h2 class="section-title">Members</h2>

        <div class="member-list">
          {#each data.members as member (member.userId)}
            <div class="member-row">
              <div class="member-info">
                {#if member.user.avatarUrl}
                  <img src={member.user.avatarUrl} alt="" class="member-avatar" />
                {:else}
                  <span class="member-avatar-placeholder">
                    {member.user.displayName.charAt(0).toUpperCase()}
                  </span>
                {/if}
                <div>
                  <div class="member-name">{member.user.displayName}</div>
                  <div class="member-email">{member.user.email}</div>
                </div>
              </div>

              <div class="member-actions">
                <span class="role-badge role-badge--{member.role}">{member.role}</span>
                {#if data.isOwner && member.userId !== data.user.id}
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={setMemberRole.pending > 0}
                    onclick={() =>
                      setMemberRole({
                        namespaceSlug: page.params.namespace!,
                        userId: member.userId,
                        role: member.role === 'owner' ? 'member' : 'owner',
                      })}
                  >
                    Make {member.role === 'owner' ? 'member' : 'owner'}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={removeMember.pending > 0}
                    onclick={() =>
                      removeMember({
                        namespaceSlug: page.params.namespace!,
                        userId: member.userId,
                      })}
                  >
                    Remove
                  </Button>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- Invite form -->
        <form
          {...inviteMember}
          class="invite-form"
          {...inviteMember.enhance(() => {
            inviteEmail = ''
          })}
        >
          <input type="hidden" name="namespaceSlug" value={page.params.namespace!} />
          <Input
            label="Invite by email"
            name="email"
            type="email"
            bind:value={inviteEmail}
            placeholder="user@example.com"
            required
            error={inviteMember.fields.email?.issues()?.[0]?.message}
          />
          {#if inviteMember.result?.success}
            <div class="form-success" role="status">Invitation sent.</div>
          {/if}
          <div class="form-actions">
            <Button type="submit" variant="primary" loading={inviteMember.pending > 0}>
              <Icon name="add" size={12} />
              Invite
            </Button>
          </div>
        </form>
      </section>
    {/if}

    <!-- Egress filtering -->
    <section class="settings-section">
      <div class="section-header-row">
        <div>
          <h2 class="section-title">Egress filtering</h2>
          <p class="section-desc">
            When enabled, project pods default to deny-all outbound internet traffic. Allow specific
            domains via the list below.
          </p>
        </div>
        <button
          class="toggle"
          class:toggle--on={data.namespace.egressFilterEnabled}
          onclick={toggleEgressFilter}
          aria-label={data.namespace.egressFilterEnabled
            ? 'Disable egress filtering'
            : 'Enable egress filtering'}
        >
          <span class="toggle-thumb"></span>
        </button>
      </div>

      {#if data.namespace.egressFilterEnabled}
        <!-- List mode -->
        <div class="egress-subsection">
          <h3 class="subsection-title">Project allow-list mode</h3>
          <div class="mode-options">
            <label class="mode-option">
              <input
                type="radio"
                name="egressListMode"
                value="merge"
                checked={data.namespace.egressListMode === 'merge'}
                onchange={() => setListMode('merge')}
              />
              <span class="mode-label">
                <strong>Merge</strong> — projects can add their own allow rules on top of namespace rules
              </span>
            </label>
            <label class="mode-option">
              <input
                type="radio"
                name="egressListMode"
                value="force"
                checked={data.namespace.egressListMode === 'force'}
                onchange={() => setListMode('force')}
              />
              <span class="mode-label">
                <strong>Force</strong> — only namespace rules apply; project allow-lists are ignored
              </span>
            </label>
          </div>
        </div>

        <!-- Allow list -->
        <div class="egress-subsection">
          <h3 class="subsection-title">Allow list</h3>
          <p class="subsection-desc">
            Patterns: <code>api.example.com</code> (exact), <code>*.example.com</code> (one level),
            <code>**.example.com</code> (domain + all subdomains)
          </p>
          <div class="rule-list">
            {#each egressAllowRules as rule (rule.id)}
              <div class="rule-row">
                <code class="rule-domain">{rule.domain}</code>
                <span class="rule-ports">:{rule.ports.join(', ')}</span>
                <button
                  class="rule-remove"
                  onclick={() => removeAllowRule(rule.id)}
                  aria-label="Remove rule">×</button
                >
              </div>
            {/each}
          </div>
          <div class="rule-add-row">
            <input
              class="rule-input"
              type="text"
              placeholder="api.example.com or **.example.com"
              bind:value={newAllowDomain}
              onkeydown={(e) => e.key === 'Enter' && addAllowRule()}
            />
            <input
              class="rule-ports-input"
              type="text"
              placeholder="80,443"
              bind:value={newAllowPorts}
              onkeydown={(e) => e.key === 'Enter' && addAllowRule()}
            />
            <Button variant="secondary" size="sm" onclick={addAllowRule}>Add</Button>
          </div>
        </div>

        <!-- Deny list -->
        <div class="egress-subsection">
          <h3 class="subsection-title">Deny list</h3>
          <p class="subsection-desc">
            Always-deny patterns that override any allow rule (e.g. <code>**.cn</code> blocks all .cn
            domains). Applies to all projects in this namespace.
          </p>
          <div class="rule-list">
            {#each egressDenyRules as rule (rule.id)}
              <div class="rule-row">
                <code class="rule-domain">{rule.domain}</code>
                <span class="rule-ports rule-ports--deny">all ports</span>
                <button
                  class="rule-remove"
                  onclick={() => removeDenyRule(rule.id)}
                  aria-label="Remove rule">×</button
                >
              </div>
            {/each}
          </div>
          <div class="rule-add-row">
            <input
              class="rule-input"
              type="text"
              placeholder="**.cn or *.evil.com"
              bind:value={newDenyDomain}
              onkeydown={(e) => e.key === 'Enter' && addDenyRule()}
            />
            <Button variant="danger" size="sm" onclick={addDenyRule}>Add deny rule</Button>
          </div>
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .settings-page {
    max-width: 680px;
    margin: 0 auto;
    padding: var(--space-8) var(--space-6);
  }

  .settings-header {
    margin-bottom: var(--space-8);
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
    text-decoration: none;
    margin-bottom: var(--space-3);
    rotate: 180deg;
  }

  .back-link:hover {
    color: var(--color-text-primary);
  }

  .back-link {
    rotate: 0;
  }

  .settings-title {
    margin: 0;
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .settings-sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .settings-section {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    background: var(--color-bg-surface);
  }

  .section-title {
    margin: 0 0 var(--space-3);
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .section-desc {
    margin: 0 0 var(--space-4);
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .section-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 400px;
  }

  .form-actions {
    display: flex;
    justify-content: flex-start;
  }

  .form-success {
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--color-success) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-success) 30%, transparent);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    color: var(--color-success);
  }

  /* Members */
  .member-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-4);
  }

  .member-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-bg-elevated);
    flex-wrap: wrap;
  }

  .member-info {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .member-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .member-avatar-placeholder {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--color-accent);
    color: var(--color-accent-text);
    font-size: var(--font-size-sm);
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .member-name {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .member-email {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .member-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .role-badge {
    font-size: var(--font-size-xs);
    font-weight: 500;
    padding: 1px var(--space-2);
    border-radius: 10px;
  }

  .role-badge--owner {
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    color: var(--color-accent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
  }

  .role-badge--member {
    background: var(--color-bg-input);
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
  }

  .invite-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 400px;
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-subtle);
  }

  @media (max-width: 639px) {
    .settings-page {
      padding: var(--space-4);
    }

    .section-form {
      max-width: 100%;
    }

    .invite-form {
      max-width: 100%;
    }
  }

  /* Egress filtering */
  .section-header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
  }

  .section-header-row .section-title {
    margin-bottom: var(--space-1);
  }

  .section-header-row .section-desc {
    margin-bottom: 0;
  }

  .toggle {
    flex-shrink: 0;
    width: 40px;
    height: 22px;
    border-radius: 11px;
    border: none;
    padding: 2px;
    cursor: pointer;
    background: var(--color-border);
    transition: background 0.15s;
    position: relative;
  }

  .toggle--on {
    background: var(--color-accent);
  }

  .toggle-thumb {
    display: block;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    transition: transform 0.15s;
  }

  .toggle--on .toggle-thumb {
    transform: translateX(18px);
  }

  .egress-subsection {
    margin-top: var(--space-5);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border-subtle);
  }

  .subsection-title {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .subsection-desc {
    margin: 0 0 var(--space-3);
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .mode-options {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .mode-option {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    cursor: pointer;
  }

  .mode-label {
    font-size: var(--font-size-sm);
    color: var(--color-text-primary);
    line-height: 1.4;
  }

  .rule-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
  }

  .rule-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-bg-elevated);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
  }

  .rule-domain {
    flex: 1;
    font-size: var(--font-size-xs);
    color: var(--color-text-primary);
  }

  .rule-ports {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .rule-ports--deny {
    color: var(--color-danger, var(--color-text-muted));
    font-style: italic;
  }

  .rule-remove {
    background: none;
    border: none;
    padding: 0 var(--space-1);
    cursor: pointer;
    color: var(--color-text-muted);
    font-size: var(--font-size-md);
    line-height: 1;
    border-radius: var(--radius-sm);
  }

  .rule-remove:hover {
    color: var(--color-text-primary);
    background: var(--color-bg-input);
  }

  .rule-add-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .rule-input {
    flex: 1;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
    min-width: 0;
  }

  .rule-ports-input {
    width: 90px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-bg-input);
    color: var(--color-text-primary);
    font-size: var(--font-size-sm);
  }

  .rule-input:focus,
  .rule-ports-input:focus {
    outline: none;
    border-color: var(--color-accent);
  }
</style>
