# agent-watch

[English](README.md)

Acompanhe os subagents e as tarefas em background do Claude Code sem sair da conversa: modelo, tokens, custo estimado e tempo de execução, ao vivo, no lugar onde o trabalho acontece. É um plugin do Claude Code; funciona no VS Code, no terminal e nas demais interfaces que desenham plugins.

## O que mostra

**Um cartão sob cada chamada de subagent**
- status (rodando, concluído, falho), modelo, tempo de execução e custo estimado;
- tokens de entrada e saída, taxa de acerto do cache e número de tools usadas;
- a tool em uso agora e um alerta quando o agente fica mais de 60 s sem atividade;
- referência de custo: a faixa típica (mínimo–máximo) dos agentes do mesmo tipo já concluídos na sessão e quanto da média o agente atual já gastou;
- um aviso "acima do histórico" quando passa do maior custo anterior.

**Uma faixa acima do prompt**
- resumo de agentes em andamento, tasks em background, agendamentos (`/loop`, cron) e custo total;
- botão "detalhes" com cada agente (modelo, tempo, custo, tool atual) e cada task.
  A lista de tasks só chega no fim de cada turno, o que é um limite do engine.

**Barra de status e avisos**
- `▶ N agente(s) · custo` enquanto algo roda, e o resumo do último agente por 60 s;
- um aviso quando um agente termina (com custo e duração) e quando passa do orçamento.

## Instalação

Em uma sessão de terminal:

```
/plugin install agent-watch --marketplace giovanibm/agent-watch
```

Em um shell:

```
claude plugin install agent-watch --marketplace giovanibm/agent-watch
```

No app desktop, onde `/plugin` não roda: clique em **+** ao lado da caixa de prompt, depois **Plugins**, **Add marketplace** com `giovanibm/agent-watch` e **Add plugin**.

Para testar a partir de uma cópia local: `claude --plugin-dir <caminho-desta-pasta>`.

## Configuração

| Opção | Padrão | O que faz |
| --- | --- | --- |
| `budgetUsd` | `1` | Orçamento por agente em US$. Ao passar, o cartão fica vermelho e um aviso aparece. `0` desliga o alerta. |

## Sobre os custos

O engine informa só o custo total da sessão, não o de cada agente. O plugin estima tokens × preço por modelo, com a tabela no início de `hooks/register.tsx` (conferida em 03/11/2026). Atualize a tabela quando os preços mudarem. Limitações: o cache lido usa 10% do preço de entrada quando o preço publicado do cache não é conhecido, o cache gravado usa 125%, e o Haiku 5.5 acima de 100 mil tokens por chamada cobra mais do que a tabela considera. A referência de custo usa só agentes concluídos na sessão atual; ela recomeça a cada sessão nova.

## Desenvolvimento

Rode `claude plugin validate .` na pasta do plugin. Para recarregar a quente, use `claude --plugin-dir <pasta>` ou coloque o plugin na sua pasta de mods.

## Licença

MIT.
