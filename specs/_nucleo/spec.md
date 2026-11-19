---
spec: nucleo
versao: 0.1.0
status: em-construcao
criado_em: 2026-11-19
---

# Spec do núcleo do Yggdrasil

## Objetivo

Ter um orquestrador genérico, sem contexto de negócio, que coordena skills de um time em ciclos SDD, um repositório por contexto. Ele mostra o trabalho num escritório virtual local e deixa o usuário responder aos agentes direto por lá. Cada time vira uma instância: o núcleo, que é deste repositório, mais a camada `time/`, que é da instância.

## Fora de escopo (v0.1)

- Paralelismo em ondas com vários contextos por repositório.
- Modo passeio (avatar andando pelo teclado).
- Integração direta com Jira ou GitLab: ações externas são sempre manuais.
- Pré-checagem de custo por token. O teto é por turno (`--max-budget-usd`).

## Requisitos

### RF1 — Estado orientado a eventos
Toda mudança vira uma linha em `eventos.jsonl` (append). O `state.json` é sempre uma projeção desses eventos e só o servidor ou o comando `estado.js projetar` o grava, com tmp + rename. Nenhum agente edita o `state.json` direto.

- **CA1.1** `estado.js autoteste` replica uma sequência com dois contextos, perguntas, workers, bloqueio da guarda e conclusão, e o estado resultante passa na validação do `state.schema.json`.
- **CA1.2** Duas escritas concorrentes de eventos não corrompem o arquivo: cada linha continua sendo um JSON válido.
- **CA1.3** O topo do estado mantém os campos do contrato original (`currentFlow`, `status`, `updatedAt`, `agents`, `atlas`), espelhando o contexto em foco.

### RF2 — Contextos e perguntas
Um contexto é uma sessão do Claude dedicada a um repositório e um fluxo. O status pode ser `TRABALHANDO`, `PRECISA_DE_VOCE`, `PAUSADO_LIMITE`, `PARADO`, `CONCLUIDO` ou `ERRO`. Quando precisa do usuário, o agente registra uma pergunta (`checkpoint`, `duvida` ou `escolha`) e encerra o turno.

- **CA2.1** Não existem dois contextos ativos para o mesmo repositório.
- **CA2.2** O número de contextos ativos nunca passa de `maxContextos`.
- **CA2.3** Pergunta aberta deixa o contexto em `PRECISA_DE_VOCE`; resposta registrada volta para `TRABALHANDO`.
- **CA2.4** Cada contexto ativo ocupa uma baia estável: a baia não muda enquanto o contexto existe.

### RF3 — Servidor local
`server.js` em Node puro, sem dependências, escutando só em `127.0.0.1`.

- **CA3.1** Toda rota de escrita exige o token da sessão e um `Origin` local. Sem eles, devolve 403.
- **CA3.2** `fluxoId` e `repo` são validados contra o catálogo. Valor inválido devolve 400.
- **CA3.3** Criar contexto além do limite, em repositório ocupado, ou responder a um contexto que não está esperando, devolve 409.
- **CA3.4** O modo `--simular` percorre o mesmo caminho servidor → eventos → estado → página, sem chamar o Claude.
- **CA3.5** Os turnos reais rodam `claude -p` com o prompt pelo stdin, `--permission-mode auto`, `--disallowedTools` para ações externas, modelo e esforço do config e `--max-budget-usd`.

### RF4 — Escritório virtual
Página local com escritório em pixel art (Canvas 2D, sem CDN), caixa de atenção e painel de conversa.

- **CA4.1** Cada contexto ativo aparece numa baia com o nome do repositório, e o herói do passo atual aparece nela.
- **CA4.2** Contexto em `PRECISA_DE_VOCE` mostra o herói com a mão levantada, conta no título da aba e dispara notificação do navegador, quando permitida.
- **CA4.3** Clicar no herói ou no item da lista abre a conversa daquele contexto. Responder pelo painel muda o contexto para `TRABALHANDO`.
- **CA4.4** O tema vem de `time/tema.json` sobre um preset do núcleo. O núcleo traz os presets `neutro` e `nordico`.
- **CA4.5** Erro, pausa por limite e bloqueio da guarda têm representação visual própria.

### RF5 — Guardrails como código
O hook `guarda.js` nega, com `permissionDecision: deny`:
- push;
- criação, merge e aprovação de MR ou PR;
- `--no-verify` e `--force`;
- `rm -rf` fora de `repos/`;
- edição de `.claude/settings*.json`;
- edição de skills listadas em `time/skills-origem.json`.

- **CA5.1** Os casos negados acima são negados, e `mvn test` ou uma edição em `repos/` passam.
- **CA5.2** Com entrada malformada ou erro interno, o hook libera (fail-open) e não trava a sessão.
- **CA5.3** O kill-switch `.claude/office/.liberar-guarda`, enquanto válido, libera tudo e registra isso no estado.

### RF6 — Readiness por script
`prontidao.js <pasta-do-ciclo>` lê `spec.md`, `plano.md` e `tarefas.md` e imprime `**Veredito:** READY|BLOCKED` com os motivos.

- **CA6.1** Todo critério de aceite `CAn` da spec é citado em pelo menos um `Atende:` das tarefas.
- **CA6.2** Toda tarefa tem `Passo:` existente no fluxo e uma seção `Como verificar`.
- **CA6.3** Tarefa com ação externa (push, MR, merge, deploy) dá BLOCKED.

### RF7 — Molde e instâncias
- **CA7.1** `instanciar.js` gera uma instância com o núcleo completo, `time/` preenchido e sem a skill `novo-orquestrador`.
- **CA7.2** `atualizar-nucleo.js` substitui só os arquivos do núcleo listados em `.claude/nucleo-manifesto.json`, e `--dry-run` não grava nada.
- **CA7.3** O núcleo não contém termos de negócio de nenhum time.
