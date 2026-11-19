# {{NOME}}

Orquestrador do time **{{TIME}}**, gerado pelo Yggdrasil (núcleo v{{VERSAO}}).

## Começar
1. Abra o Claude Code nesta pasta.
2. `/office` → http://localhost:{{PORTA}}. É o escritório: cada repositório em trabalho ocupa uma baia, e quem precisa de você levanta a mão.
3. Coloque o repositório em `repos/<nome>`, com `git clone`.
4. `/iniciar-fluxo <fluxo> <repo>`, ou use o quadro de missões no Office.

## Onde fica cada coisa
| Pasta | O quê | De quem |
|---|---|---|
| `time/` | contexto, regras, fluxos, tema | do time (esta instância) |
| `.claude/skills/<skill do time>` | skills do time, cópia fiel (veja `time/skills-origem.json`) | do time |
| `.claude/nucleo.md`, `agents/`, `hooks/`, `office/`, skills do núcleo | núcleo | do Yggdrasil |
| `specs/<repo>/<ciclo>/` | spec, plano, tarefas e verificação de cada ciclo | do trabalho |
| `aprendizado/` | diário por repo e lições por skill | do trabalho |

## Modo aprendizado
Em `orquestrador.json`, os checkpoints começam todos como `manual`. O `/autonomia` mostra o que você aprova sem ajustar e sugere o que pode virar `auto`. Push, MR, merge e deploy são sempre seus: o hook `guarda.js` bloqueia essas ações.
