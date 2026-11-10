// First-start settings for the compose deployment, through the management API on 127.0.0.1.
// Fills only what is still empty, so anything later changed in the panel is left alone:
//   source:hxrouter  baseUrl = HX_ROUTER_BASE_URL, tokenEnv = HX_ROUTER_TOKEN, enabled, githubInstance
//   source:github    repository = SUPERAGENT_GITHUB_REPOSITORY, cli = SUPERAGENT_GITHUB_CLI or /usr/local/bin/gh-agent (only when set)
// With --github-instance it does one thing instead: set source:hxrouter githubInstance = HX_ROUTER_GITHUB_INSTANCE,
// overwriting the current value (deploy/cloud-bootstrap.sh github-user, after the gateway instance passed its check).
// --allow-github LOGIN, --repositories and --show are described where they are handled.
const port = process.env.SUPERAGENT_PORT || '3082'
const api = process.env.SUPERAGENT_API || `http://127.0.0.1:${port}/orchestrator/api`
const headers = { 'x-orchestrator-request': '1', 'content-type': 'application/json' }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function settings(timeoutMs = Number(process.env.CONFIGURE_TIMEOUT_MS || 180_000)) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(`${api}/settings`, { headers })
      if (response.ok) return await response.json()
    } catch {}
    if (Date.now() > deadline) throw new Error(`management API at ${api} not ready`)
    await sleep(2000)
  }
}

async function update(id, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const view = await settings()
    const source = view.sources?.find(row => row.id === id)
    if (!source) { console.log(`configure: no ${id} Source in this build; skipped`); return }
    const value = change(source.value)
    if (!value) { console.log(`configure: source:${id} already set; left alone`); return }
    const response = await fetch(`${api}/settings/source:${id}`, { method: 'PUT', headers, body: JSON.stringify({ value, revision: source.revision }) })
    const body = await response.json().catch(() => ({}))
    if (response.status === 409) continue
    if (!response.ok) throw new Error(`source:${id}: ${response.status} ${body.error ?? ''} ${body.setup ? JSON.stringify(body.setup) : ''}`)
    console.log(`configure: source:${id} saved${body.restarting ? ' (restarting)' : ''}`)
    if (body.restarting) await sleep(3000)
    return
  }
  throw new Error(`source:${id}: settings kept changing (409)`)
}

const baseUrl = (process.env.HX_ROUTER_BASE_URL || '').trim()
const githubInstance = Number(process.env.HX_ROUTER_GITHUB_INSTANCE || 0)
const repository = (process.env.SUPERAGENT_GITHUB_REPOSITORY || '').trim()
const cli = (process.env.SUPERAGENT_GITHUB_CLI || '/usr/local/bin/gh-agent').trim()

// --allow-github LOGIN: put LOGIN on the "accounts that may originate work" list of every GitHub instance (one per repository,
// policy block), keeping the rest of the policy. Off the list, an Issue that mentions the agent is ignored (admission unlistedAddressed: ignore).
// --repositories [a/b,c/d]: add each repository (or SUPERAGENT_GITHUB_REPOSITORIES, comma or space separated) that no GitHub
// instance watches yet as a new instance, starting from the default instance's allowed list; existing instances are kept.
// --show: print what the deployment checks read back: hxrouter githubInstance, the GitHub repository, the allowed list.
async function view() {
  const response = await fetch(`${api}/settings`, { headers })
  if (!response.ok) throw new Error(`GET settings: ${response.status}`)
  return response.json()
}
const flag = name => { const at = process.argv.indexOf(name); return at < 0 ? undefined : (process.argv[at + 1] || '').trim() }
const allowLogin = flag('--allow-github')
if (allowLogin !== undefined) {
  if (!/^[A-Za-z0-9-]+$/.test(allowLogin)) { console.error('configure: --allow-github needs a GitHub login'); process.exit(1) }
  try {
    await settings()
    for (let attempt = 0; ; attempt++) {
      if (attempt === 5) throw new Error('policy: settings kept changing (409)')
      const { blocks } = await view()
      const policy = blocks.policy.value
      const ids = (await view()).sources.filter(row => row.kind === 'github').map(row => row.id)
      const listed = id => (policy.sources?.[id]?.allowed ?? []).some(row => row.id.toLowerCase() === allowLogin.toLowerCase())
      const missing = ids.filter(id => !listed(id))
      if (!missing.length) { console.log(`configure: ${allowLogin} already on the GitHub allowed lists`); break }
      const sources = { ...policy.sources }
      for (const id of missing) { const part = sources[id] ?? { allowed: [] }; sources[id] = { ...part, allowed: [...(part.allowed ?? []), { id: allowLogin }] } }
      const value = { ...policy, sources }
      const response = await fetch(`${api}/settings/policy`, { method: 'PUT', headers, body: JSON.stringify({ value, revision: blocks.policy.revision }) })
      const body = await response.json().catch(() => ({}))
      if (response.status === 409) continue
      if (!response.ok) throw new Error(`policy: ${response.status} ${body.error ?? ''}`)
      console.log(`configure: ${allowLogin} added to the GitHub allowed list of ${missing.join(', ')}`); break
    }
    process.exit(0)
  } catch (error) { console.error(`configure: ${error.message}`); process.exit(1) }
}
if (process.argv.includes('--show')) {
  try {
    const settingsView = await view()
    const config = id => settingsView.sources?.find(row => row.id === id)?.value?.config ?? {}
    const allowed = id => (settingsView.blocks?.policy?.value?.sources?.[id]?.allowed ?? []).map(row => row.id)
    console.log(`hxrouter githubInstance: ${config('hxrouter').githubInstance ?? 0}`)
    console.log(`github repository: ${config('github').repository || '(unset)'}`)
    console.log(`github allowed: ${allowed('github').join(', ') || '(empty: Issues are ignored)'}`)
    for (const row of settingsView.sources?.filter(item => item.kind === 'github' && item.extra) ?? []) {
      console.log(`${row.id} repository: ${row.value.config.repository}${row.value.enabled ? '' : ' (off)'}; gateway ${row.value.config.gatewayInstance ?? 0}; allowed: ${allowed(row.id).join(', ') || '(empty)'}${row.problem ? `; ${row.problem.detail}` : ''}`)
    }
    process.exit(0)
  } catch (error) { console.error(`configure: ${error.message}`); process.exit(1) }
}

if (process.argv.includes('--repositories')) {
  const given = flag('--repositories')
  const names = (given && !given.startsWith('--') ? given : process.env.SUPERAGENT_GITHUB_REPOSITORIES || '').split(/[\s,]+/).filter(Boolean)
  const bad = names.filter(name => !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name))
  if (!names.length || bad.length) { console.error(`configure: --repositories needs owner/name entries${bad.length ? `; not one: ${bad.join(', ')}` : ''}`); process.exit(1) }
  try {
    await settings()
    for (let attempt = 0; ; attempt++) {
      if (attempt === 5) throw new Error('instances: settings kept changing (409)')
      const current = await view()
      const github = current.sources.filter(row => row.kind === 'github')
      const known = new Set(github.map(row => String(row.value.config.repository).toLowerCase()))
      const added = [...new Set(names)].filter(name => !known.has(name.toLowerCase()))
      if (!added.length) { console.log('configure: every repository already has a GitHub instance'); break }
      const rows = [...github.filter(row => row.extra).map(row => ({ id: row.id, enabled: row.value.enabled, config: row.value.config })),
        ...added.map(repository => ({ enabled: true, config: { repository }, policyFrom: 'github' }))]
      const response = await fetch(`${api}/sources/github/instances`, { method: 'PUT', headers, body: JSON.stringify({ rows, revision: current.instances.github.revision }) })
      const body = await response.json().catch(() => ({}))
      if (response.status === 409) continue
      if (!response.ok) throw new Error(`instances: ${response.status} ${body.error ?? ''}`)
      console.log(`configure: added ${added.join(', ')}${body.restarting ? ' (restarting)' : ''}`); break
    }
    process.exit(0)
  } catch (error) { console.error(`configure: ${error.message}`); process.exit(1) }
}
if (process.argv.includes('--github-instance')) {
  if (!(githubInstance > 0)) { console.error('configure: HX_ROUTER_GITHUB_INSTANCE must be a positive instance id'); process.exit(1) }
  await update('hxrouter', ({ enabled, config }) => config.githubInstance === githubInstance ? undefined : { enabled, config: { ...config, githubInstance } })
    .then(() => process.exit(0), error => { console.error(`configure: ${error.message}`); process.exit(1) })
}

let failed = false
if (baseUrl) {
  await update('hxrouter', ({ enabled, config }) => {
    if (config.baseUrl) return undefined
    return { enabled: true, config: { ...config, baseUrl, tokenEnv: 'HX_ROUTER_TOKEN', ...githubInstance > 0 ? { githubInstance } : {} } }
  }).catch(error => { failed = true; console.error(`configure: ${error.message}`) })
}
if (repository) {
  await update('github', ({ enabled, config }) => {
    if (config.repository) return undefined
    return { enabled: true, config: { ...config, repository, cli } }
  }).catch(error => { failed = true; console.error(`configure: ${error.message}`) })
}
process.exit(failed ? 1 : 0)
