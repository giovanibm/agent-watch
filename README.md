# agent-watch

[Português](README.pt-BR.md)

Watch your Claude Code subagents and background tasks without leaving the conversation: model, tokens, estimated cost and run time, live, right where the work happens. Built as a Claude Code plugin; works in VS Code, the terminal and other surfaces that draw plugins.

## What it shows

**A card under every subagent call**
- status (running, completed, failed), model, elapsed time and estimated cost;
- input and output tokens, prompt-cache hit rate and number of tool calls;
- the tool the agent is using right now, plus a warning when it has been silent for more than 60 s;
- a cost reference: the typical range (min–max) of finished agents of the same type in this session, and how much of their average the current agent has already spent;
- an "above history" notice when it passes the highest previous cost.

**A band above the prompt**
- a summary of running agents, background tasks, scheduled jobs (`/loop`, cron) and total cost;
- a "details" button listing each agent (model, time, cost, current tool) and each task.
  The task list only arrives at the end of each turn, which is an engine limit.

**Status line and notices**
- `▶ N agent(s) · cost` while something runs, and the summary of the last finished agent for 60 s;
- a notice when an agent finishes (with cost and duration) and when it goes over budget.

## Install

In a terminal session:

```
/plugin install agent-watch --marketplace giovanibm/agent-watch
```

From a shell:

```
claude plugin install agent-watch --marketplace giovanibm/agent-watch
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `giovanibm/agent-watch`, then **Add plugin**.

To try it from a local copy: `claude --plugin-dir <path-to-this-folder>`.

## Configuration

| Option | Default | What it does |
| --- | --- | --- |
| `budgetUsd` | `1` | Per-agent budget in US$. Past it, the card turns red and a notice appears. `0` turns the alert off. |

## About the costs

The engine reports only the session's total cost, not each agent's. The plugin estimates it as tokens × price per model, using the table at the top of `hooks/register.tsx` (checked on 2026-11-03). Update the table when prices change. Limits: cached reads use 10% of the input price when the published cache price is unknown, cache writes use 125%, and Haiku 5.5 charges more above 100k tokens per call than the table accounts for. The cost reference only uses agents finished in the current session; it starts over with each new session.

## Develop

Run `claude plugin validate .` in the plugin folder. Hot-reload it with `claude --plugin-dir <folder>` or by placing it in your mods folder.

## License

MIT.
