# {{NOME}} — orquestrador do time {{TIME}}

Instância do **Yggdrasil**, núcleo v{{VERSAO}}. O núcleo (`.claude/nucleo.md`, agents, hooks, office e skills do núcleo) vem do molde. Melhorias genéricas vão para o Yggdrasil e chegam aqui por `scripts/atualizar-nucleo.js`. O que é do time fica em `time/`.

- Office: `/office` → http://localhost:{{PORTA}}. Para o protótipo sem Claude, use `/office simular`.
- Começar um ciclo: `/iniciar-fluxo <fluxo> <repo>`. Os fluxos ficam em `time/fluxos/` e os repositórios em `repos/`.
- Estado sem gastar token: `!node .claude/office/estado.js status`
- Placar de confiança: `/autonomia` · retrospectiva: `/retro`

@nucleo.md
@../time/contexto.md
@../time/regras.md
