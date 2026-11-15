import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRec, CronRec, TaskRec } from '../types'

const agents = atom({ plugin: 'agent-watch', key: 'agents' } as const, {} as Record<string, AgentRec>)
const tasks = atom({ plugin: 'agent-watch', key: 'tasks' } as const, [] as TaskRec[])
const crons = atom({ plugin: 'agent-watch', key: 'crons' } as const, [] as CronRec[])
const isOpen = atom({ plugin: 'agent-watch', key: 'isOpen' } as const, false)
const tick = atom({ plugin: 'agent-watch', key: 'tick' } as const, 0)

// Tabela de preços (US$ por milhão de tokens), conferida em 03/11/2026 na tabela
// de modelos da API da Anthropic. O engine só informa o custo total da sessão,
// não o de cada agente, por isso estimamos: tokens × preço.
// `cr` = cache lido (preço publicado quando conhecido; senão 10% da entrada).
// Cache gravado = 125% da entrada (TTL de 5 min). Ordem importa: o primeiro que casa vence.
type Price = { in: number; out: number; cr?: number }
const PRICES: Array<[RegExp, Price]> = [
  [/fable-5-2|mythos-5-2/, { in: 8, out: 40, cr: 0.2 }],
  [/fable|mythos/, { in: 10, out: 50 }],
  [/opus-5-5/, { in: 4, out: 20, cr: 0.2 }],
  [/opus-5|opus-4-[678]/, { in: 5, out: 25 }],
  [/sonnet-5-5/, { in: 2, out: 10, cr: 0.1 }],
  [/sonnet-5/, { in: 2, out: 10 }],
  [/sonnet-4/, { in: 3, out: 15 }],
  [/haiku-5/, { in: 0.1, out: 0.5 }],
  [/haiku-4/, { in: 1, out: 5 }],
]

// Limitação conhecida: o Haiku 5.5 cobra mais (US$ 0,50/2,50) em prompts acima de
// 100 mil tokens por chamada; aqui usamos sempre a faixa base, então subestima nesse caso.
const cost = (a: AgentRec): number | null => {
  const p = PRICES.find(([re]) => re.test(a.model))?.[1]
  if (!p) return null
  const cr = p.cr ?? p.in * 0.1
  return (a.input * p.in + a.output * p.out + a.cacheRead * cr + a.cacheWrite * p.in * 1.25) / 1e6
}

// Valores abaixo de 1 centavo ganham 3 casas para não aparecerem como 0,00.
const usd = (v: number | null) =>
  v === null ? 'US$ —' : `US$ ${(v > 0 && v < 0.01 ? v.toFixed(3) : v.toFixed(2)).replace('.', ',')}`
const n = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)
const dur = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}
let lastDone: { text: string; at: number } | null = null
const oneLine = (v: string) => { const x = v.replace(/\s+/g, ' ').trim(); return x.length > 60 ? `${x.slice(0, 57)}…` : x }
const shortModel = (m: string) => m.replace(/^claude-/, '')

// Atualiza um agente já conhecido; ignora ids que o plugin não viu nascer.
async function patch($: EngineInterface, id: string, fn: (a: AgentRec) => AgentRec) {
  await update($, agents, cur => (cur[id] ? { ...cur, [id]: fn(cur[id]) } : cur))
}

// Referência de custo: faixa (mín–máx) e média do custo final dos agentes do mesmo
// tipo já concluídos nesta sessão. Não é uma previsão pontual: um agente pode custar
// muito mais ou menos que os anteriores, então mostramos a faixa típica e quanto do
// valor médio o agente atual já consumiu. Sem histórico, sem referência.
const forecast = (a: AgentRec, all: AgentRec[]) => {
  if (a.status !== 'running') return null
  const done = all.filter(h => h.type === a.type && h.status === 'completed').map(cost).filter((c): c is number => c !== null)
  const own = cost(a)
  if (done.length === 0 || own === null) return null
  const avg = done.reduce((s, c) => s + c, 0) / done.length
  return { min: Math.min(...done), max: Math.max(...done), avg, samples: done.length, pct: Math.round((100 * own) / avg), isAbove: own > Math.max(...done) }
}
const refText = (f: NonNullable<ReturnType<typeof forecast>>) =>
  f.isAbove ? `acima do histórico (máx ${usd(f.max)}, ${f.samples} anteriores)` : `típico ${usd(f.min)}–${usd(f.max)} · ${f.pct}% da média (${f.samples} anteriores)`

export const register: Register = (on, options) => {
  // Se o valor não vier das opções (menu de configuração), usa este padrão.
  const DEFAULT_BUDGET = 1
  const rawBudget = Number(options.budgetUsd)
  const budget = Number.isFinite(rawBudget) ? rawBudget : DEFAULT_BUDGET
  // Um agente nasce: guarda quem é e em qual chamada de tool ele aparece.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && r.agentId) {
      const now = await $.clock.now()
      const rec: AgentRec = {
        id: r.agentId, toolUseId: e.tool_use_id, type: e.subagentType, description: e.description ?? '',
        model: r.model, background: e.background, status: 'running', startedAt: now, lastEventAt: now,
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, steps: 0, calls: 0, lastTool: '',
      }
      await update($, agents, cur => ({ ...cur, [rec.id]: rec }))
    }
    return r
  }).catch(($, e, next) => next(e))

  // Cada chamada de modelo do agente soma tokens: dá o gasto ao vivo.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId && r.usage) {
      const u = r.usage
      const now = await $.clock.now()
      await patch($, e.agentId, a => ({
        ...a, model: u.model || a.model, steps: a.steps + 1, lastEventAt: now,
        input: a.input + u.input_tokens, output: a.output + u.output_tokens,
        cacheRead: a.cacheRead + u.cache_read_input_tokens, cacheWrite: a.cacheWrite + u.cache_creation_input_tokens,
      }))
      // Alerta de orçamento: avisa uma única vez por agente.
      const cur = (await read($, agents))[e.agentId]
      const spent = cur ? cost(cur) : null
      if (cur && !cur.isOverBudget && budget > 0 && spent !== null && spent >= budget) {
        await patch($, e.agentId, a => ({ ...a, isOverBudget: true }))
        $.ui.toast(`⚠ ${cur.description || cur.type} passou de ${usd(budget)} (${usd(spent)})`)
      }
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const now = await $.clock.now()
      await patch($, e.agentId, a => ({ ...a, calls: a.calls + 1, lastTool: e.tool, lastEventAt: now }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Fim da execução do agente: fecha o cartão e avisa com o custo final.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const now = await $.clock.now()
      const status = e.reason === 'answer' ? 'completed' : e.reason === 'aborted' ? 'killed' : 'failed'
      await patch($, e.agentId, a => ({ ...a, status, endedAt: now, lastEventAt: now }))
      const a = (await read($, agents))[e.agentId]
      if (a) lastDone = { text: `${a.description || a.type}: ${status === 'completed' ? 'concluído' : status} · ${usd(cost(a))} · ${dur(now - a.startedAt)}`, at: now }
      if (a) $.ui.toast(`${a.description || a.type}: ${status === 'completed' ? 'concluído' : status} · ${usd(cost(a))} · ${dur(now - a.startedAt)}`)
    }
    return next(e)
  })

  // Relógio: só redesenha enquanto houver agente rodando.
  on('session.start', async ($, e, next) => {
    $.clock.every(1000, async () => {
      const all = Object.values(await read($, agents))
      const running = all.filter(a => a.status === 'running')
      if (running.length > 0) {
        await update($, tick, t => t + 1)
        const total = all.reduce((s, a) => s + (cost(a) ?? 0), 0)
        const over = running.filter(a => a.isOverBudget).length
        $.ui.status(`▶ ${running.length} agente(s)${over ? ` · ⚠ ${over} acima do orçamento` : ''} · ${usd(total)}`)
      } else if (lastDone && (await $.clock.now()) - lastDone.at < 60_000) {
        $.ui.status(`✓ ${lastDone.text}`)
      } else {
        $.ui.status(undefined)
      }
    })
    return next(e)
  })

  // As tasks em background só chegam nos eventos de parada (fim de turno, fim de
  // subagent): cada um traz a lista completa do que ainda está em andamento.
  // Guardamos o primeiro instante em que vimos cada task para contar o tempo.
  on('classic.Stop', async ($, e, next) => {
    const now = await $.clock.now()
    const incoming = e.background_tasks ?? []
    await update($, tasks, cur =>
      incoming.map(t => ({
        id: t.id, type: t.type, status: t.status, description: t.description, command: t.command,
        firstSeen: cur.find(c => c.id === t.id)?.firstSeen ?? now,
      })),
    )
    await update($, crons, () => (e.session_crons ?? []).map(c => ({ ...c })))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Faixa acima do prompt: um relance de tudo o que está rodando.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, tick)
    const all = Object.values(await read($, agents))
    const running = all.filter(a => a.status === 'running')
    // Subagent já aparece na lista de agentes (com modelo e custo): não repete como task.
    const bg = (await read($, tasks)).filter(t => t.type !== 'subagent')
    const cr = await read($, crons)
    if (e.props.hasSurvey || (running.length === 0 && bg.length === 0 && cr.length === 0)) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await $.clock.now()
    const open = await read($, isOpen)
    const total = all.reduce((s, a) => s + (cost(a) ?? 0), 0)

    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan">● </Text>
          <Text>
            {running.length} agente(s) · {bg.length} task(s){cr.length ? ` · ${cr.length} agendada(s)` : ''} · {usd(total)}{' '}
          </Text>
          <Button key="toggle" label={open ? 'ocultar' : 'detalhes'} onPress={() => update($, isOpen, v => !v)} />
        </Box>
        {open ? (
          <Box flexDirection="column" paddingLeft={2}>
            {running.map(a => {
              const fc = forecast(a, all)
              return (
              <Text key={a.id}>
                <Text color="cyan">agente</Text> {a.description || a.type} <Text dimColor>· {shortModel(a.model)} · {dur(now - a.startedAt)} · {usd(cost(a))}{a.isOverBudget ? ' ⚠' : ''}{fc ? ` · ${refText(fc)}` : ''} · {a.lastTool || 'iniciando'}</Text>
              </Text>
              )
            })}
            {bg.map(t => (
              <Text key={t.id}>
                <Text color="yellow">{t.type}</Text> {oneLine(t.command ?? t.description)} <Text dimColor>· {t.status} · visto há {dur(now - t.firstSeen)}</Text>
              </Text>
            ))}
            {cr.map(c => (
              <Text key={c.id}>
                <Text color="magenta">agendada</Text> {c.prompt.slice(0, 60)} <Text dimColor>· {c.schedule}{c.recurring ? ' (recorrente)' : ''}</Text>
              </Text>
            ))}
            {bg.length > 0 || cr.length > 0 ? <Text dimColor>tasks e agendamentos atualizam no fim de cada turno</Text> : null}
          </Box>
        ) : null}
      </Box>
    )
  })

  // O cartão: aparece sob a linha da tool Agent, ligado pelo tool_use_id.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.tool !== 'Agent' && e.props.tool !== 'Task') return next(e)
    await read($, tick)
    const a = Object.values(await read($, agents)).find(x => x.toolUseId === e.props.tool_use_id)
    if (!a) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const elapsed = (a.endedAt ?? now) - a.startedAt
    const total = a.input + a.cacheRead + a.cacheWrite
    const hit = total > 0 ? Math.round((100 * a.cacheRead) / total) : 0
    const stuck = a.status === 'running' && now - a.lastEventAt > 60_000
    const fc = forecast(a, Object.values(await read($, agents)))
    const icon = a.status === 'running' ? '●' : a.status === 'completed' ? '✓' : '✗'
    const color = a.status === 'running' ? 'cyan' : a.status === 'completed' ? 'green' : 'red'

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box borderStyle="round" paddingX={1} flexDirection="column">
          <Text>
            <Text color={color}>{icon}</Text> {shortModel(a.model)} · {dur(elapsed)} ·{' '}
            <Text color={a.isOverBudget ? 'red' : undefined}>{usd(cost(a))}{a.isOverBudget ? ' ⚠ acima do orçamento' : ''}</Text>
            {fc ? <Text dimColor color={fc.isAbove ? 'yellow' : undefined}> · {refText(fc)}</Text> : null}
            {a.background ? ' · background' : ''}
          </Text>
          <Text dimColor>
            tokens {n(total)} entrada / {n(a.output)} saída · cache {hit}% · {a.calls} tools · limite {budget > 0 ? usd(budget) : 'off'}
          </Text>
          {a.status === 'running' ? (
            <Text dimColor color={stuck ? 'red' : undefined}>
              {stuck ? `⚠ sem atividade há ${dur(now - a.lastEventAt)} · ` : ''}agora: {a.lastTool || 'iniciando'}
            </Text>
          ) : null}
        </Box>
      </Box>
    )
  })
}
