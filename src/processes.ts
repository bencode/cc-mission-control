import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'

import type { AgentKind } from './types.ts'

const execFileAsync = promisify(execFile)

export type AgentProcessMap = Map<string, Exclude<AgentKind, 'shell'>>

const AGENT_COMMANDS: Record<string, Exclude<AgentKind, 'shell'>> = {
  claude: 'claude',
  codex: 'codex',
}

export const normalizeTty = (tty: string): string =>
  tty.replace(/^\/dev\//, '').trim()

const commandName = (comm: string): string => basename(comm.trim())

export const parseAgentProcesses = (output: string): AgentProcessMap => {
  const agents = new Map<string, Exclude<AgentKind, 'shell'>>()
  const leaderTtys = new Set<string>()
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    if (!match) continue
    const [, pid, pgid, tty0, comm] = match
    if (!pid || !tty0 || !comm) continue
    const tty = normalizeTty(tty0)
    if (tty === '??' || tty === '-') continue
    const agent = AGENT_COMMANDS[commandName(comm)]
    if (!agent) continue
    // One tty can host claude plus a codex subprocess it spawned (code mode).
    // The foreground process-group leader (pid === pgid) is the interactive
    // agent, so it wins; a non-leader only fills a tty no leader has claimed.
    if (pid === pgid) {
      agents.set(tty, agent)
      leaderTtys.add(tty)
    } else if (!leaderTtys.has(tty) && !agents.has(tty)) {
      agents.set(tty, agent)
    }
  }
  return agents
}

export const listAgentProcesses = async (): Promise<AgentProcessMap> => {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,pgid=,tty=,comm='])
  return parseAgentProcesses(stdout)
}
