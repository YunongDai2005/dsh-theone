#!/usr/bin/env node
// Spike 3: drive Claude Code and Codex through the Agent Client Protocol, as TheOne would. In a
// fresh temporary folder, per agent: start the adapter, open a session, ask it to create a file
// (answering its permission request from here), fork the session and check the fork remembers the
// file while the original's record is unchanged, then restart the adapter and check the session
// can be picked up again. Uses your existing Claude Code / Codex sign-in and spends a few small
// requests. The test sessions live in a temporary folder and are about nothing of yours.
//
//   npm install && node acp.mjs [--only claude|codex]
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'

const ADAPTERS = {
  claude: { pkg: '@agentclientprotocol/claude-agent-acp@latest', records: join(homedir(), '.claude', 'projects') },
  codex: { pkg: '@agentclientprotocol/codex-acp@latest', records: join(homedir(), '.codex', 'sessions') },
}
const TIMEOUT = 240000

/** One adapter process with an ACP connection; the client side answers permission requests itself. */
function connect(pkg, log) {
  const child = spawn('npx', ['-y', pkg], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const state = { text: '', updates: {}, permissions: [] }
  const client = {
    async requestPermission(request) {
      // TheOne would show this in main chat; the spike allows once and records what was asked.
      const option = request.options.find(o => o.kind === 'allow_once') ?? request.options.find(o => o.kind.startsWith('allow'))
      state.permissions.push(`${request.toolCall?.title ?? request.toolCall?.toolCallId} → ${option ? option.name : 'cancelled'}`)
      return { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } }
    },
    async sessionUpdate(notification) {
      const update = notification.update
      state.updates[update.sessionUpdate] = (state.updates[update.sessionUpdate] ?? 0) + 1
      if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') state.text += update.content.text
    },
  }
  const connection = new ClientSideConnection(() => client, ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)))
  const close = () => { try { child.kill() } catch { /* Gone already. */ } }
  child.on('exit', code => { if (code) log(`  adapter exited ${code}: ${stderr.trim().split('\n').slice(-2).join(' | ').slice(0, 200)}`) })
  return { connection, state, close, stderr: () => stderr }
}

const within = (promise, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), TIMEOUT))])

/** Ask in a session; returns the reply text and what streamed meanwhile. */
async function ask(agent, sessionId, text) {
  agent.state.text = ''; agent.state.updates = {}; agent.state.permissions = []
  const started = performance.now()
  const response = await within(agent.connection.prompt({ sessionId, prompt: [{ type: 'text', text }] }), 'prompt')
  return { reply: agent.state.text.trim(), stop: response.stopReason, ms: performance.now() - started, updates: { ...agent.state.updates }, permissions: [...agent.state.permissions] }
}

/** Size of the agent's own record of a session, found by its id in the file name or path. */
function recordSize(dir, sessionId) {
  if (!existsSync(dir)) return undefined
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) { const found = recordSize(path, sessionId); if (found !== undefined) return found }
    else if (name.includes(sessionId)) return stat.size
  }
  return undefined
}

async function trial(name, { pkg, records }) {
  const results = {}
  const log = line => console.log(line)
  const cwd = mkdtempSync(join(tmpdir(), `theone-spike-${name}-`))
  log(`\n== ${name} (${pkg}) in ${cwd}`)
  let agent = connect(pkg, log)
  try {
    const init = await within(agent.connection.initialize({ protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'theone-spike', version: '0' } }), 'initialize')
    const caps = init.agentCapabilities ?? {}
    const sessionCaps = Object.keys(caps.sessionCapabilities ?? {}).filter(key => caps.sessionCapabilities[key])
    log(`  agent: ${init.agentInfo?.name ?? '?'} ${init.agentInfo?.version ?? ''}; loadSession=${!!caps.loadSession}; session: ${sessionCaps.join(', ') || 'none'}; auth methods: ${(init.authMethods ?? []).map(m => m.id).join(', ') || 'none'}`)
    results.capabilities = { load: !!caps.loadSession, ...Object.fromEntries(sessionCaps.map(key => [key, true])) }

    const { sessionId } = await within(agent.connection.newSession({ cwd, mcpServers: [] }), 'newSession')
    const first = await ask(agent, sessionId, 'Create a file named hello.txt in the current directory containing the word hi. Then reply with just: done.')
    results.stream = first.updates
    results.permission = first.permissions
    results.fileCreated = existsSync(join(cwd, 'hello.txt')) && readFileSync(join(cwd, 'hello.txt'), 'utf8').includes('hi')
    log(`  first turn: ${(first.ms / 1000).toFixed(1)} s, stop=${first.stop}, reply "${first.reply.slice(0, 60)}"`)
    log(`  streamed: ${Object.entries(first.updates).map(([k, v]) => `${k}×${v}`).join(', ')}`)
    log(`  permission asked: ${first.permissions.join('; ') || 'none'}; file created: ${results.fileCreated}`)

    const recall = 'Without using any tools: what is the name of the file you created earlier in this conversation? Reply with the file name only.'
    if (results.capabilities.fork) try {
      // Claude Code adds a generated title to the record a few seconds after a turn; let that land first.
      await new Promise(resolve => setTimeout(resolve, 10000))
      const before = recordSize(records, sessionId)
      const fork = await within(agent.connection.unstable_forkSession({ sessionId, cwd, mcpServers: [] }), 'fork')
      // claude-agent-acp 0.87 returns the fork's id before the fork is live: it must be resumed first.
      if (results.capabilities.resume) await within(agent.connection.resumeSession({ sessionId: fork.sessionId, cwd, mcpServers: [] }), 'resume fork')
      else if (results.capabilities.load) await within(agent.connection.loadSession({ sessionId: fork.sessionId, cwd, mcpServers: [] }), 'load fork')
      const forked = await ask(agent, fork.sessionId, recall)
      const after = recordSize(records, sessionId)
      results.fork = { remembers: /hello\.txt/i.test(forked.reply), newId: fork.sessionId !== sessionId, originalUnchanged: before !== undefined ? before === after : 'record not found' }
      log(`  fork: new id ${results.fork.newId}, remembers the file ${results.fork.remembers} ("${forked.reply.slice(0, 40)}"), original record unchanged ${results.fork.originalUnchanged}`)
    } catch (error) {
      // One failing step must not hide the others.
      results.fork = { error: String(error.message ?? error), adapter: agent.stderr().trim().split('\n').at(-1)?.slice(0, 200) }
      log(`  fork failed: ${results.fork.error}; adapter: ${results.fork.adapter}`)
    } else log('  fork: not offered by this adapter')

    // Restart the adapter, as after closing TheOne, and pick the session up again.
    agent.close()
    agent = connect(pkg, log)
    await within(agent.connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }), 'initialize')
    let how
    if (results.capabilities.resume) { await within(agent.connection.resumeSession({ sessionId, cwd, mcpServers: [] }), 'resume'); how = 'resume' }
    else if (results.capabilities.load) { await within(agent.connection.loadSession({ sessionId, cwd, mcpServers: [] }), 'load'); how = 'load' }
    if (how) {
      const again = await ask(agent, sessionId, recall)
      results.reopen = { how, remembers: /hello\.txt/i.test(again.reply) }
      log(`  after restart (${how}): remembers the file ${results.reopen.remembers} ("${again.reply.slice(0, 40)}")`)
    } else log('  after restart: neither resume nor load offered')
  } catch (error) {
    results.error = String(error.message ?? error)
    log(`  stopped: ${results.error}`)
    const tail = agent.stderr().trim().split('\n').slice(-3).join(' | ')
    if (tail) log(`  adapter said: ${tail.slice(0, 300)}`)
  } finally {
    agent.close()
    rmSync(cwd, { recursive: true, force: true })
  }
  return results
}

const { values } = parseArgs({ options: { only: { type: 'string' } } })
const summary = {}
for (const [name, adapter] of Object.entries(ADAPTERS)) if (!values.only || values.only === name) summary[name] = await trial(name, adapter)
console.log('\nSummary (paste this back):')
console.log(JSON.stringify(summary, null, 2))
process.exit(0)
