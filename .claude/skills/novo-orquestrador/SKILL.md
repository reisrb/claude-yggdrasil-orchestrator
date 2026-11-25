---
name: novo-orquestrador
description: Gera o orquestrador de um projeto a partir deste molde (Yggdrasil) — pergunta para qual projeto é, o que tem para fazer, as skills e o fluxo, o tema do escritório, o modo de trabalho (aprendizado, misto ou direto, explicando cada um) e onde a skill /tarefas salva as tarefas e a daily (arquivos, Notion ou outro), que é onde o 📝 Registrar anota; monta respostas.json, roda scripts/instanciar.js e deixa a instância pronta (núcleo, camada time/, tema, Office, memória inicial). Use quando o usuário disser "/novo-orquestrador", "monta um orquestrador para o time X", "configura o orquestrador do meu projeto", "entrei num time novo" ou "cria uma instância".
---

# /novo-orquestrador

Você está no **molde**. O resultado é uma pasta nova, irmã desta, com um orquestrador completo, configurado do jeito da pessoa. Tudo o que ela escolher aqui dá para mudar depois (`orquestrador.json` e a pasta `time/`); diga isso no começo, para ela não travar em nenhuma resposta.

## 1. Entrevista
Pergunte uma coisa por vez. Use `AskUserQuestion` onde houver opções; ofereça um padrão sensato e aceite "não sei ainda".

1. **Para qual projeto** é o orquestrador: o produto ou sistema e os repositórios que ele vai tocar (onde estão, se já dá para clonar).
2. **O que tem para fazer** nesse projeto: o trabalho que vem pela frente (ex.: atualizar versões, corrigir débitos, migrar, novas funcionalidades) e o que é prioridade.
3. **Nome do orquestrador** e **nome do time** (ou da pessoa, se for só ela).
4. **Stacks e plataformas** (linguagens, versões, onde roda) e **ferramentas** (gestão de tarefas, repositórios, CI).
5. **Skills**: quais skills ela já tem ou usa (repositório, pasta, plugin do Claude Code), o que cada uma faz e se dá para trazer agora. Peça que ela passe o caminho ou o link; não reescreva nenhuma.
6. **Fluxo**: a sequência de etapas que ela segue no trabalho e qual skill cada etapa usa (ex.: "levantamento → correção → testes → MR"). Se não houver processo definido, diga que fica só o fluxo `demo` e que ela descreve o fluxo quando quiser: **não invente passos**.
7. **Quem aprova o quê** (gestor, revisor, segurança) e **regras do time** que somam ao núcleo (o que nunca fazer, convenções de branch e MR).
8. **Tema do escritório**: `nordico` (heróis, valquírias, Odin e Heimdall em pixel art) ou `neutro` (escritório comum). Ofereça ver antes de escolher: `node .claude/office/server.js --simular --tema nordico` (ou `neutro`) sobe o Office de demonstração, sem gastar token. Os heróis e os nomes dá para trocar depois em `time/tema.json`.
9. **Modo de trabalho.** Antes de perguntar, explique em linguagem simples (texto curto, sem pular nenhum dos três pontos):
   - **Modo aprendizado** (o padrão): o orquestrador para e pergunta em cada etapa (a spec, o plano e cada passo do fluxo). Antes de cada pergunta, explica o que a próxima skill faz, por que agora, o que ela toca e como desfazer; ao fechar cada etapa, publica um relatório didático na conversa. Cada aprovação conta no placar (`/autonomia`): depois de 3 aprovações seguidas sem ajuste, ele **sugere** deixar aquele checkpoint automático, mas só muda com o ok da pessoa.
   - **Rodadas iniciais**: a 1ª rodada é o fluxo `demo` no `repo-exemplo`, que só lê, para ver o ciclo inteiro sem risco. Depois, **um repositório real por vez**, com um fluxo do time. Cada rodada deixa o diário em `aprendizado/repos/` e as lições por skill em `aprendizado/skills/`; o `/retro` consolida. Com as rodadas, os checkpoints que sempre passam viram automáticos e o orquestrador fica mais autônomo.
   - **Dá para pular**: quem já conhece as skills pode começar no **misto** (só a spec e o plano param para aprovar; os passos rodam sozinhos) ou no **direto** (roda o fluxo inteiro e só para em dúvida real, no portão das skills do time ou no que é externo). Em qualquer modo, push, MR, merge e deploy continuam com a pessoa, e as guardas valem igual. Dá para voltar ao aprendizado a qualquer hora em `orquestrador.json` → `checkpoints`.
   Opções: **Aprendizado (Recomendado)**, **Misto**, **Direto**.
10. **Onde anotar as tarefas e o que foi feito.** Explique: o núcleo traz a skill **`/tarefas`**, um caderno de trabalho com o mesmo esquema em qualquer destino (uma tarefa por frente, "O que foi feito" com uma linha por dia, decisões com o porquê, subtarefas, e a daily com Para ler, Ontem, Hoje e Pontos). O botão **📝 Registrar** do Office grava nela: uma cópia da sessão prepara o rascunho em paralelo e a pessoa aprova num popup antes de gravar. Pergunte onde ela quer salvar:
    - **arquivos markdown** na pasta do orquestrador (padrão, sem configurar nada): `anotacoes/` (pode trocar o nome), fora do git por padrão;
    - **Notion**: numa página que ela indicar; depois de criar a instância, o `/tarefas configurar` cria os bancos de Tarefas e Dailys e libera o conector para o Registrar;
    - **outro lugar** (Jira, Obsidian, Google Docs…): ela descreve onde e como, e isso vira `outro.instrucoes`.
    Pergunte também se ela quer a **daily** (padrão sim) e se quer uma **página no claude.ai** (artefato privado) com o quadro e a daily, para abrir no navegador ou no celular. Explique que a página é uma vitrine atualizada quando ela roda `/tarefas` no terminal: as sessões do Office, como o Registrar, não publicam artefato.
    Se ela já tem uma skill própria de tarefas e prefere que o Registrar grave nela, monte com ela o bloco `registro` (formato no README, seção `orquestrador.json`): `resumo`, `onde`, `instrucoes` (a skill e o como) e `permitir`, só com as ferramentas que a gravação precisa (ex.: `Skill(<skill>)`, `mcp__<conector>__*`).
11. **Quantos contextos simultâneos** no começo (padrão 2) e qual porta (padrão 4321, se não houver outro Office rodando).
12. **Pasta de destino** (padrão `../<nome-em-minúsculas>`).

## 2. Gerar
1. Escreva `scripts/.respostas-<nome>.json` (gitignored), no formato descrito no topo de `scripts/instanciar.js`:
   - `contexto.projeto` e `contexto.trabalho` com as respostas 1 e 2;
   - `modo`: `aprendizado`, `misto` ou `direto`;
   - `tarefas`: `destino` (`arquivo`, `notion` ou `outro`), `arquivo.pasta`, `outro.instrucoes`, `daily` e `artefato.ativo` (a resposta sobre a página);
   - `registro`, só se ela quer que o Registrar grave numa skill própria, no lugar do `/tarefas`;
   - em `memoria`, 3 a 6 fatos que valem para as próximas sessões: o projeto e o que tem para fazer, o modo escolhido e o plano das rodadas iniciais, e o que ela contou de importante.
2. Rode `node scripts/instanciar.js <destino> scripts/.respostas-<nome>.json --semear-memoria`.
3. Se ela já tiver as skills:
   - traga para `<destino>/.claude/skills/` sem alterar nada (ou instale o plugin, ou aponte a workspace `repos/`, como no README);
   - registre cada uma em `<destino>/time/skills-origem.json` (`nome`, `origem`, `commit` ou data).
4. Fluxos: **não invente** os passos do processo. Se ela descreveu, monte os `time/fluxos/*.json` com a skill de cada passo; senão, deixe só o `demo`.
5. Se o `registro.instrucoes` aponta um arquivo da pasta `time/` que ainda não existe, crie esse arquivo com o que ela contou (destino, formato, o que não registrar).
6. Destino `notion`: diga que, na instância, o primeiro comando é `/tarefas configurar` (cria os bancos e libera o conector para o Registrar).

## 3. Conferir e entregar
- `node <destino>/.claude/office/estado.js autoteste`
- `node <destino>/.claude/hooks/guarda.js --autoteste`
- Diga a ela, nesta ordem:
  - abrir o Claude Code no destino e rodar `/office` (ou `/office simular` para o protótipo);
  - **1ª rodada**: `cp -r exemplos/repo-exemplo repos/` e `/iniciar-fluxo demo repo-exemplo` (ou ＋ Nova missão no Office);
  - **próximas rodadas**: um repositório real por vez em `repos/`, com o fluxo do time; no fim de cada uma, `/retro`;
  - o modo escolhido e como mudar: `/autonomia` mostra o placar e sugere o que automatizar; `orquestrador.json` → `checkpoints` muda na mão;
  - onde ficam as tarefas e a daily (`/tarefas`, `/tarefas add`, `/tarefas fiz`), e que o 📝 Registrar grava lá depois que ela aprova o rascunho no popup.
