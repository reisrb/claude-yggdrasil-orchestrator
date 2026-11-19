---
name: novo-orquestrador
description: Gera o orquestrador de um time novo a partir deste molde (Yggdrasil) — entrevista o usuário sobre o time, monta respostas.json, roda scripts/instanciar.js e deixa a instância pronta (núcleo, camada time/, tema, Office, memória inicial). Use quando o usuário disser "/novo-orquestrador", "monta um orquestrador para o time X", "entrei num time novo" ou "cria uma instância".
---

# /novo-orquestrador

Você está no **molde**. O resultado é uma pasta nova, irmã desta, com um orquestrador completo.

## 1. Entrevista
Pergunte uma coisa por vez. Use `AskUserQuestion` onde houver opções; ofereça um padrão sensato e aceite "não sei ainda".
1. **Nome do orquestrador** e **nome do time**.
2. **Objetivo do time**: o que ele entrega.
3. **Stacks e plataformas**: linguagens, versões, onde roda.
4. **Ferramentas**: gestão de tarefas, repositórios, CI.
5. **De onde vêm as skills do time** (repo, pasta, plugin) e se dá para copiá-las agora.
6. **Quem aprova o quê**: gestor, revisor, segurança.
7. **Regras do time** que somam ao núcleo: o que nunca fazer, convenções de branch e MR.
8. **Tema do Office**: `nordico` (heróis, valquírias, Odin/Heimdall) ou `neutro` (escritório comum).
9. **Quantos contextos simultâneos** no começo (padrão 2, no modo aprendizado) e qual porta (padrão 4321, se não houver outro Office rodando).
10. **Pasta de destino** (padrão `../<nome-em-minúsculas>`).

## 2. Gerar
1. Escreva `scripts/.respostas-<nome>.json` (gitignored), no formato descrito no topo de `scripts/instanciar.js`. Em `memoria`, ponha 3 a 6 fatos que valem para as próximas sessões: o plano de aprendizado e o que o usuário contou de importante.
2. Rode `node scripts/instanciar.js <destino> scripts/.respostas-<nome>.json --semear-memoria`.
3. Se o usuário já tiver as skills do time:
   - copie para `<destino>/.claude/skills/` sem alterar nada;
   - registre cada uma em `<destino>/time/skills-origem.json` (`nome`, `origem`, `commit` ou data).
4. Fluxos: **não invente** os passos do processo do time. Se ele já descreveu, monte os `time/fluxos/*.json`; senão, deixe só o `demo`.

## 3. Conferir e entregar
- `node <destino>/.claude/office/estado.js autoteste`
- `node <destino>/.claude/hooks/guarda.js --autoteste`
- Diga ao usuário:
  - abrir o Claude Code no destino;
  - rodar `/office`, ou `/office simular` para o protótipo;
  - testar `/iniciar-fluxo demo repo-exemplo` depois de `cp -r exemplos/repo-exemplo repos/`.
