---
name: iniciar-fluxo
description: Conduz o ciclo SDD completo de um repositório num fluxo do time (spec → plano/tarefas → readiness → execução por skill-workers → verificação → fechamento), com os checkpoints do modo aprendizado e a telemetria do Office. Use quando o usuário disser "/iniciar-fluxo <fluxo> <repo>", "começa o fluxo X no repo Y", "roda o fluxo", ou quando um turno do Office pedir para iniciar o ciclo de um contexto.
---

# /iniciar-fluxo <fluxo> <repo>

Siga o `nucleo.md`. Este é o roteiro.

## 0. Preparar
1. Leia `time/fluxos/<fluxo>.json`. Se o fluxo não existir, liste os que existem e pare.
2. Confira se `repos/<repo>` existe. Se não existir, pergunte ao usuário de onde clonar (nunca invente URL) e pare.
3. **Contexto:**
   - se o prompt trouxe `[orq] contexto=<id>`, use esse id;
   - senão (terminal), rode `node .claude/office/estado.js contexto criar --repo <repo> --fluxo <fluxo>` e guarde o id;
   - fluxo com `alvo: jira`: assim que ler o ticket, registre do que ele trata (ex.: o serviço) como título do contexto, para aparecer ao lado da chave no Office: `node .claude/office/estado.js contexto renomear --contexto <id> --titulo "<nome>"`.
4. **Ciclo:** crie `specs/<repo>/<AAAA-MM-DD>-<fluxo>/` copiando os três arquivos de `specs/_template/`.
5. **Checkpoints:** leia `checkpoints` e `overrides` em `orquestrador.json`.

## 1. Spec
1. Faça um levantamento leve, só de leitura: README, arquivos de build, CI e deploy. Para inventário completo, existe o passo do fluxo.
2. Escreva `spec.md`:
   - **estado atual**, sempre com evidência `arquivo:linha`;
   - **objetivo**;
   - **fora de escopo**;
   - **critérios `CA1..n`**, verificáveis.
3. Checkpoint `spec`, se for `manual`: pergunte com `--chave spec`, com um resumo da spec no texto e, na explicação, o que vem a seguir. **Não escreva plano nem tarefas antes do ok**: o checkpoint existe para ajustar a spec antes de planejar.

## 2. Plano e tarefas
1. Escreva `plano.md`: a linha `Fluxo: <fluxo>`, a sequência de skills, os riscos, como verificar e como desfazer.
2. Escreva `tarefas.md`: uma tarefa por passo do fluxo, cada uma com `Passo:`, `Atende:` e `### Como verificar`.
3. Rode `node .claude/office/prontidao.js specs/<repo>/<ciclo>`. Com BLOCKED, corrija e rode de novo até dar READY.
4. Checkpoint `plano`, se for `manual`: pergunte com `--chave plano`, mostrando a lista de tarefas e o veredito.

## Quem executa cada etapa (`executor` no fluxo)
- **`skill`** (padrão): delegue ao `skill-worker`, como abaixo. Se a skill for de um plugin (`plugin:skill`), o worker a invoca pelo nome completo. Se a própria skill tiver portão de confirmação, o portão dela é o checkpoint: **não** pergunte de novo antes; quando ela abrir o portão, registre-o como pergunta (`--tipo escolha`, com as opções que ela mostrou) e encerre o turno se estiver no Office.
- **`eng`**: é ação do usuário. Não delegue. Explique em linguagem simples o que é dele nessa etapa (o `papel` do passo diz) e registre uma pergunta (`--tipo duvida`, `--chave passo:<id>`) do tipo "me avisa quando concluir, ou me conta o resultado". Se a etapa tiver skill (ex.: abrir a GMUD com uma skill), ofereça rodá-la para ele.
- **`automatico`**: ninguém age (automação de outra ferramenta). Marque ACTIVE e pergunte ao usuário quando avançar, ou confira o status na ferramenta (só leitura), e siga.
- **`quando`** (ramo): numa bifurcação, siga só o ramo cuja condição foi decidida (ex.: a decisão registrada na etapa anterior) e marque as etapas do outro ramo como BLOCKED (`estado.js passo ... --status BLOCKED --resumo "ramo não seguido"`).
- **Fluxo com `alvo: jira`**: o "repo" do contexto é a chave do card ou Epic. Não há pasta em `repos/` a menos que uma etapa traga o repositório do serviço.

## 3. Execução, uma tarefa por vez
Para cada tarefa `Tn`:
1. **Checkpoint `passo`**, se for `manual`: pergunte com `--chave passo:<id>`. Na explicação, em linguagem simples:
   - o que a skill faz;
   - por que agora;
   - o que vai tocar;
   - como desfazer.
2. Marque o início: `estado.js passo --contexto <id> --passo <passo> --status ACTIVE`.
3. **Delegue** ao agente `skill-worker`. O prompt começa com:
   ```
   [orq] contexto=<id> passo=<passo> skill=<skill do passo> papel=<papel do passo> alvo=<repo>
   Ciclo: specs/<repo>/<ciclo>/  ·  Tarefa: Tn
   ```
4. Quando ele voltar:
   - anote o resultado em `tarefas.md` (Log de execução);
   - marque `estado.js passo ... --status DONE --resumo "<1 linha>"`.
5. Se o worker trouxer **dúvidas** ou **falhar**:
   - marque `--status ERROR`, se falhou;
   - pergunte (`--tipo duvida`) e espere.

## 4. Verificação
1. Delegue ao agente `verificador`, com o prompt começando por `[orq] contexto=<id> passo=verificacao skill=verificador papel=verificador alvo=<repo>`.
2. Salve o relatório em `specs/<repo>/<ciclo>/verificacao.md`.
3. Se o veredito for REPROVADO, pergunte ao usuário como seguir.

## 5. Fechamento
1. Acrescente uma entrada em `aprendizado/repos/<repo>.md` com:
   - data e fluxo;
   - o que foi feito;
   - os atritos com cada skill, tirados dos relatórios dos workers;
   - as decisões do usuário;
   - os pontos de atenção.
2. Lembre que push, MR e Jira ficam com o usuário, e sugira `/retro`.
3. Conclua: `estado.js contexto concluir --contexto <id> --resumo "<o que foi entregue>"`.

## Lembretes
- No **turno pelo Office**: registrou pergunta, **encerre o turno**.
- No **terminal**: pergunte também no chat e registre a resposta com `estado.js resposta`.
- Nunca edite `state.json` nem `eventos.jsonl`.
