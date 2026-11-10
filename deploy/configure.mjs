// First-start settings for the compose deployment, through the management API on 127.0.0.1.
// Fills only what is still empty, so anything later changed in the panel is left alone:
//   source:hxrouter  baseUrl = HX_ROUTER_BASE_URL, tokenEnv = HX_ROUTER_TOKEN, enabled, githubInstance
//   source:github    repository = SUPERAGENT_GITHUB_REPOSITORY, cli = SUPERAGENT_GITHUB_CLI or /usr/local/bin/gh-agent (only when set)
// With --github-instance it does one thing instead: set source:hxrouter githubInstance = HX_ROUTER_GITHUB_INSTANCE,
// overwriting the current value (deploy/cloud-bootstrap.sh github-user, after the gateway instance passed its check).
// --allow-github LOGIN and --show are described where they are handled.
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

// --allow-github LOGIN: put LOGIN on the GitHub Source's "accounts that may originate work" list (policy block), keeping the
// rest of the policy. Off the list, an Issue that mentions the agent is ignored (admission unlistedAddressed: ignore).
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
      const part = policy.sources?.github ?? { allowed: [] }
      if ((part.allowed ?? []).some(row => row.id.toLowerCase() === allowLogin.toLowerCase())) {
        console.log(`configure: ${allowLogin} already on the GitHub allowed list`); break
      }
      const value = { ...policy, sources: { ...policy.sources, github: { ...part, allowed: [...(part.allowed ?? []), { id: allowLogin }] } } }
      const response = await fetch(`${api}/settings/policy`, { method: 'PUT', headers, body: JSON.stringify({ value, revision: blocks.policy.revision }) })
      const body = await response.json().catch(() => ({}))
      if (response.status === 409) continue
      if (!response.ok) throw new Error(`policy: ${response.status} ${body.error ?? ''}`)
      console.log(`configure: ${allowLogin} added to the GitHub allowed list`); break
    }
    process.exit(0)
  } catch (error) { console.error(`configure: ${error.message}`); process.exit(1) }
}
if (process.argv.includes('--show')) {
  try {
    const settingsView = await view()
    const config = id => settingsView.sources?.find(row => row.id === id)?.value?.config ?? {}
    const allowed = (settingsView.blocks?.policy?.value?.sources?.github?.allowed ?? []).map(row => row.id)
    console.log(`hxrouter githubInstance: ${config('hxrouter').githubInstance ?? 0}`)
    console.log(`github repository: ${config('github').repository || '(unset)'}`)
    console.log(`github allowed: ${allowed.join(', ') || '(empty: Issues are ignored)'}`)
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
