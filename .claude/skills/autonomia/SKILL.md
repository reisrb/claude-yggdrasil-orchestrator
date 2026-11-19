---
name: autonomia
description: Mostra o placar de confiança dos checkpoints (quantas aprovações seguidas sem ajuste por spec, plano e cada passo) e sugere quais poderiam virar automáticos no orquestrador.json. Só muda a configuração com o ok explícito do usuário. Use quando o usuário disser "/autonomia", "o que já dá para automatizar", "placar de checkpoints" ou "quero dar mais autonomia".
---

# /autonomia

1. Rode `node .claude/office/estado.js placar`.
2. Leia `checkpoints` e `overrides` em `orquestrador.json`.
3. Monte a sugestão:
   - **candidato a `auto`**: sequência de 3 ou mais aprovações sem ajuste, ainda `manual`;
   - **manter `manual`**: teve ajuste recente ou menos de 3 respostas;
   - ações externas (push, MR, merge, deploy) **nunca** entram, porque não são checkpoints: são sempre do usuário.
4. Mostre uma tabela com: checkpoint, respostas, sequência, atual e sugestão.
5. Pergunte quais ele quer promover. **Só edite `orquestrador.json` com o ok explícito**:
   - em `checkpoints`, para o tipo inteiro;
   - em `overrides.<fluxo>.<passo>`, para um passo só.
6. Registre a decisão no fim de `aprendizado/autonomia.md`: data, o que foi promovido e por quê.
