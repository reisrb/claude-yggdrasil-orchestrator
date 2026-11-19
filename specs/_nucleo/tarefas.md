# Tarefas do núcleo v0.1

| # | Tarefa | Atende | Situação |
|---|---|---|---|
| T1 | `state.schema.json` + `estado.js` (lib, CLI, projeção, autoteste) | CA1.1, CA1.2, CA1.3, CA2.1, CA2.2, CA2.3, CA2.4 | feito |
| T2 | `prontidao.js` + templates de spec/plano/tarefas | CA6.1, CA6.2, CA6.3 | feito |
| T3 | `hooks/guarda.js` + `hooks/telemetria.js` + `settings.json` | CA5.1, CA5.2, CA5.3 | feito |
| T4 | `server.js` (rotas, segurança, turnos reais, `--simular`) + `simulador.js` | CA3.1, CA3.2, CA3.3, CA3.4, CA3.5 | feito |
| T5 | Escritório: `mapa.js`, `sprites.js`, `cena.js`, `motor.js`, temas `neutro`/`nordico` | CA4.1, CA4.4, CA4.5 | feito |
| T6 | Painel: caixa de atenção, conversa, quadro de missões, Atlas, notificações | CA4.2, CA4.3 | feito |
| T7 | **Validação do protótipo simulado com o usuário** | CA3.4, CA4.1–CA4.5 | aguardando o usuário |
| T8 | Agents (`skill-worker`, `verificador`) + skills do núcleo + fluxo `demo` + `repo-exemplo` | — | feito |
| T9 | Turnos reais ponta a ponta com o Claude | CA3.5 | feito (v0.1.1: worker assíncrono via SubagentStart/Stop; custo acumulado da sessão) |
| T10 | `novo-orquestrador`, `instanciar.js`, `atualizar-nucleo.js`, manifesto | CA7.1, CA7.2, CA7.3 | feito |
| T11 | Servidor em memória (disco em background; `/mnt/c` custa 50–130 ms por operação) + escuta também em `::1` | CA3.1–CA3.5 | feito (v0.1.3: `/state` 400 ms → 20 ms) |
| T12 | Resposta otimista (Aprovar/Rejeitar somem na hora) + resposta enfileirada durante o fechamento do turno | CA4.3 | feito |
| T13 | Visões: Escritório · Painel (grupos de trabalho em árvore) · Mapa Atlas (página, mindmap visto de cima) | CA4.1–CA4.3 | feito |
| T14 | Baias dinâmicas por contexto; subagente que lança subagentes forma grupo isolado (divisória) | CA2.4, CA4.1 | feito |

## Como verificar

- `node .claude/office/estado.js autoteste`
- `node .claude/office/prontidao.js --autoteste`
- `node .claude/hooks/guarda.js --autoteste`
- `node .claude/office/server.js --simular`; depois `curl` nas rotas e captura de tela do navegador
