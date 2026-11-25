---
name: tarefas
description: Anotações de trabalho da pessoa, no lugar que ela escolher — tarefas por frente de trabalho (A fazer, Fazendo, Aguardando, Feito) com o que foi feito dia a dia, as decisões com o porquê e as subtarefas, e a daily do dia (Para ler, Ontem, Hoje, Pontos). Salva onde está configurado em time/tarefas.json: arquivos markdown na pasta do orquestrador (padrão), Notion ou outro destino descrito por ela; se ela quiser, publica também uma página privada no claude.ai (artefato) com o quadro e a daily. É o destino padrão do 📝 Registrar do Office. Use quando a pessoa disser "/tarefas", "minhas tarefas", "daily", "o que tenho pra hoje", "nova tarefa", "anota que fiz", "marca como feito", "anota esse ponto", "configura onde salvar minhas tarefas", ou quando o prompt do 📝 Registrar mandar usar esta skill.
---

# /tarefas

Caderno de trabalho da pessoa: o que ela tem para fazer, o que fez a cada dia, o que decidiu e por quê, e o que falar na daily. O **esquema** é sempre o mesmo; o **destino** é ela quem escolhe (`time/tarefas.json`). O objetivo é ela ter o que falar na daily e, no fim do ciclo, um histórico com decisões e números para avaliações e relatórios.

## Configuração (`time/tarefas.json`)
```jsonc
{
  "destino": "arquivo",                         // arquivo | notion | outro
  "arquivo": { "pasta": "anotacoes" },          // relativo à pasta do orquestrador
  "notion": { "pagina": "", "tarefas": "", "dailys": "" },  // página-mãe e os data sources dos dois bancos
  "outro": { "instrucoes": "" },                // onde e como gravar (ex.: Jira, Obsidian, Google Docs), o que pode e o que não pode
  "daily": true,                                // false: só tarefas, sem a página do dia
  "artefato": { "ativo": false, "perguntado": false, "url": "" }  // página opcional no claude.ai (veja abaixo)
}
```
Sem o arquivo, vale `destino: arquivo` em `anotacoes/`. Para trocar o destino, rode `/tarefas configurar`.

## O esquema (igual em qualquer destino)

### Tarefa: uma por frente de trabalho
- **Campos:** título, status (**A fazer**, **Fazendo**, **Aguardando** quando depende de outra pessoa, **Feito**), frente (a chave do ticket; sem ticket, o repositório), resumo (uma frase, além do título), origem (**Iniciativa**, **Solicitado** com quem pediu e quando, ou **A confirmar**), criada em, concluída em e sessão do Claude (o comando para retomar: `cd <pasta> && claude --resume <id>`).
- **Corpo**, com todas as seções desde o começo; a que ainda está vazia leva um texto-guia curto:
  ```
  ## Contexto            o que é, por que existe, de onde veio (acréscimos com data)
  ## Pronto quando       - [ ] critério verificável
  ## Plano               1. passo
  ## Dúvidas em aberto   - [ ] pergunta — para quem
  ## Subtarefas          - [ ] <fluxo> · <etapa> (<repo>)
  ## O que foi feito     - DD/MM: o que aconteceu no dia
  ## Como foi identificado
  ## Como foi resolvido  o que resolveu, o que tentou antes, o que aprendeu
  ## Evidências          ticket, MR, commit, antes × depois
  ## Sessões do Claude   - DD/MM (<pasta>): `claude --resume <id>` · Onde parei: ...
  ```

### Daily: uma página por dia
Escrita para ler em voz alta:
```
## Para ler     dois parágrafos curtos, um começando por "Ontem", outro por "Hoje": 3 a 5 frases cada,
                primeira pessoa, só os números que ajudam a falar, sem links, sem chaves de ticket, sem negrito
## Ontem        - **Finalizado:** / **Decidido:** / **Achado:** / **Em andamento:** (do dia útil anterior)
## Hoje         - **<tópico>:** o que vai fazer, com o número que importa
## Pontos       🚧 bloqueio · 🔎 achado para comunicar · 🙋 pedido de ajuda
                (Contexto, O que trava, O que testamos, Preciso de <o quê, de quem>, Decisão)
```
O **Para ler** é refeito sempre que Ontem, Hoje ou Pontos mudam.

### Regras de organização
- **Uma tarefa por frente, nunca uma por evento.** A frente é o ticket do contexto; sem ticket, o repositório. O que é do próprio orquestrador, da curva de aprendizado ou de um chat sem frente vai numa tarefa guarda-chuva ("Orquestrador e aprendizado").
- **Antes de criar, procure** entre as abertas (A fazer, Fazendo, Aguardando) e reaproveite a que casar pelo ticket, pelo repositório ou pelo assunto.
- **Subtarefas ficam dentro da tarefa**, em `## Subtarefas`; marque `[x]` com a data quando a etapa fechar, sem duplicar.
- **"O que foi feito"** tem uma linha por dia (`DD/MM: ...`). **Decisão** vira `DD/MM: decidi <o quê> porque <por quê>`; a que afeta o time vira também um ponto na daily.
- **Acrescente, nunca apague.** O que a pessoa escreveu direto vale e não é reescrito; correção vira linha nova com data. A única "remoção" é trocar o texto-guia pelo conteúdo.
- **Status:** A fazer vira Fazendo quando o trabalho começa. **Nunca mova para Feito sem ela dizer.**
- **Ordem:** do mais novo para o mais antigo, nas listas e no quadro.
- **Nada sensível:** credencial, token, dado pessoal ou de cliente nunca entram.

## Destinos

### `arquivo` (padrão)
- Tarefa: `<pasta>/tarefas/<AAAA-MM-DD>-<slug-do-titulo>.md`, com um bloco YAML no topo (`titulo`, `status`, `frente`, `resumo`, `origem`, `criada`, `concluida`, `sessao`) e as seções do corpo.
- Daily: `<pasta>/dailys/<AAAA-MM-DD>.md`.
- Quadro: `<pasta>/quadro.md`, uma tabela (status, tarefa com link para o arquivo, frente, última mudança), do mais novo para o mais antigo. Refaça sempre que criar tarefa ou mudar status.
- Use Edit e Write; nunca apague arquivo.

### `notion`
- Use o conector do Notion da sessão (carregue as ferramentas com `ToolSearch` antes). Sem o conector autorizado, avise em uma linha e não grave nada.
- Dois bancos dentro da página-mãe, criados pelo `/tarefas configurar`:
  - **Tarefas:** `Tarefa` (título), `Status` (A fazer, Fazendo, Aguardando, Feito), `Frente`, `Resumo`, `Origem`, `Solicitado por`, `Criada em`, `Concluída em`, `Sessão Claude`, `Dailys` (relação);
  - **Dailys:** `Daily` ("Daily - DD/MM/AAAA"), `Dia`, `Tarefas` (relação).
- O corpo das páginas leva as mesmas seções. Leia a página antes de mexer (o que a pessoa editou direto vale) e nunca substitua o conteúdo da página-mãe, onde ficam os bancos.

### `outro`
Siga `outro.instrucoes`. Se faltar algo para gravar no esquema acima (onde fica a daily, como marcar status), pergunte uma vez e, com o ok, acrescente a resposta às instruções.

## Página no claude.ai (artefato, opcional)
Além do destino, a pessoa pode ter uma **página privada no claude.ai** (um artefato) com o quadro e a daily, para abrir no navegador ou no celular. É uma vitrine: os dados continuam no destino, e a página é refeita a partir deles.
- **Pergunte, não imponha.** Se `artefato.perguntado` for `false`, na primeira vez que a skill rodar numa sessão com a ferramenta de artefatos (e no `/tarefas configurar`), pergunte uma vez: "Quer também uma página no claude.ai com o quadro e a daily? Abre no navegador e no celular, e só você vê até compartilhar." Opções: **Sim**, **Não**, **Depois**. Grave a resposta em `artefato.ativo` e marque `perguntado: true` (com "Depois", deixe `perguntado: false`).
- **O que a página mostra:** a daily de hoje no topo (o **Para ler** em destaque, pronto para ler em voz alta, e depois Ontem, Hoje e Pontos), o quadro por status (Fazendo, Aguardando, A fazer, Feito recente), com a frente, o resumo e a última linha de "O que foi feito" de cada tarefa, e a linha do tempo das decisões (`decidi … porque …`), da mais nova para a mais antiga.
- **Como publicar:** com a ferramenta de artefatos (siga as orientações de design de artefato da sessão). A primeira publicação guarda o endereço em `artefato.url`; as seguintes atualizam **o mesmo endereço**. Atualize no fim de todo comando que mudou tarefa ou daily e diga o link em uma linha.
- **Quando não dá:** as sessões do Office (`claude -p`, como a cópia do 📝 Registrar) não têm a ferramenta de artefatos. Nelas, não tente publicar: a página se atualiza na próxima vez que a pessoa rodar `/tarefas` no terminal. Se a sessão do terminal também não tiver a ferramenta (login sem conta do claude.ai), avise em uma linha e siga sem a página.
- **Nada sensível**, como em todo o resto: a página fica no claude.ai.

## Fluxos
O argumento decide. Uma pergunta por vez.
- **`/tarefas`** (sem argumento): com `daily: true` e sem a daily de hoje, monte a manhã: as tarefas abertas, o que fechou, foi decidido ou achado no dia útil anterior (das linhas datadas e das tarefas concluídas), e uma proposta de Ontem, Hoje e Pontos (tarefa em Aguardando vira sugestão de 🚧). Pergunte **"o que entra hoje?"** e grave depois do ok, com o Para ler por último. Se a daily de hoje já existe, mostre o quadro resumido (Fazendo, Aguardando, A fazer, Feito hoje).
- **`/tarefas add <título>`**: conversa curta (o que é e por que agora; iniciativa ou pedido de quem; como saber que terminou; ticket ou repositório) e um Plano sugerido. Grava depois do ok. Com pressa, só o título, com origem A confirmar.
- **`/tarefas fiz <trecho> <texto>`**: linha datada em "O que foi feito" (e em "Como foi identificado" ou "Como foi resolvido", se o texto disser).
- **`/tarefas fazendo|aguardando|feito <trecho>`**: muda o status e diz o que mudou em uma linha.
  - Fazendo: guarda a sessão atual do Claude (o id é o `.jsonl` mais recente da pasta de projetos do Claude Code para esta pasta).
  - Aguardando: pergunta de quem depende e anota em "Dúvidas em aberto".
  - Feito: preenche concluída em e pergunta, uma por vez (dá para pular): como identificou, como resolveu (e o que tentou antes), e qual a evidência.
- **`/tarefas ponto`**: bloqueio, achado ou pedido de ajuda na daily de hoje; separa o que ela colar nos campos sem reescrever.
- **`/tarefas configurar`**: pergunta onde salvar (arquivos na pasta do orquestrador, Notion numa página que ela indicar, ou outro destino que ela descreve), se quer a daily e se quer a página no claude.ai (artefato). Monte a estrutura (a pasta com o `quadro.md`, ou os dois bancos no Notion), grave `time/tarefas.json` e ajuste `orquestrador.json` → `registro` para o 📝 Registrar poder gravar lá: em `onde`, o destino; em `permitir`, só o que a gravação precisa (`Edit(<pasta>/*)` e `Write(<pasta>/*)` para arquivo; o padrão do conector, como `mcp__<conector-do-notion>__*`, para Notion). Mostre o que vai mudar e grave depois do ok.

Comandos diretos (`add` com pressa, `fiz`, `fazendo`, `aguardando`, `feito`) gravam na hora; propostas (manhã, plano, ponto) só depois do ok.

## Modo registro (📝 Registrar do Office)
Quando o prompt é do Registrar (`[orq] registro-preparar`, `registro-ajustar` ou `registro-gravar`), quem roda é uma cópia da sessão do contexto, sem conversa: **não faça perguntas**. O rascunho é a pergunta: a pessoa aprova, ajusta ou descarta num popup.
- **Rascunho (só leitura):**
  1. Ache a tarefa da frente do contexto: o ticket do contexto; sem ticket, o repositório; num chat ou no que é do orquestrador, a guarda-chuva. Se não achar, diga no rascunho que vai criar, com o título, a origem e o resumo.
  2. Mostre exatamente o que entra: as linhas datadas de "O que foi feito" (só o que aconteceu desde o último registro, que o prompt informa), as decisões com o porquê, as subtarefas que fecham e a mudança de status (A fazer para Fazendo; nunca para Feito).
  3. Com `daily: true`, mostre o bloco do projeto em **Hoje** da daily de hoje e o **Para ler** refeito. Se a daily de hoje não existe, diga que vai criá-la só com esse bloco e "a preencher" no resto.
  4. Em `### Fica de fora`, o que não vale registrar (decisão de código "porque sim", aprovação sem ajuste, o que já está registrado).
- **Gravação (depois do Aprovar):** grave exatamente o rascunho aprovado, nada além, e refaça o quadro (destino arquivo). Se o destino falhar (conector sem autorização, arquivo fora da pasta liberada), comece a resposta com "Não gravei:" e diga o que faltou. Com `artefato.ativo`, termine dizendo que a página no claude.ai se atualiza na próxima vez que a pessoa rodar `/tarefas` no terminal.
