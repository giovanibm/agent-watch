export type AgentRec = {
  id: string
  toolUseId: string
  type: string
  description: string
  model: string
  background: boolean
  status: 'running' | 'completed' | 'failed' | 'killed'
  startedAt: number
  endedAt?: number
  lastEventAt: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  steps: number
  calls: number
  lastTool: string
  isOverBudget?: boolean
}

export type TaskRec = {
  id: string
  type: string
  status: string
  description: string
  command?: string
  firstSeen: number
}

export type CronRec = { id: string; schedule: string; recurring: boolean; prompt: string }

declare module 'claude-code' {
  interface PluginState {
    'agent-watch': { agents: Record<string, AgentRec>; tick: number; tasks: TaskRec[]; crons: CronRec[]; isOpen: boolean }
  }
}
