// First-start settings for the compose deployment, through the management API on 127.0.0.1.
// Fills only what is still empty, so anything later changed in the panel is left alone:
//   source:hxrouter  baseUrl = HX_ROUTER_BASE_URL, tokenEnv = HX_ROUTER_TOKEN, enabled, githubInstance
//   source:github    repository = SUPERAGENT_GITHUB_REPOSITORY, cli = /usr/local/bin/gh-agent (only when set)
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
    return { enabled: true, config: { ...config, repository, cli: '/usr/local/bin/gh-agent' } }
  }).catch(error => { failed = true; console.error(`configure: ${error.message}`) })
}
process.exit(failed ? 1 : 0)
