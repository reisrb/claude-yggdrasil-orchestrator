# Yggdrasil: um molde de orquestradores para Claude Code

> Gere, para cada time em que você entrar, um **orquestrador de skills** do Claude Code. Ele conduz cada repositório num ciclo SDD (spec → plano → tarefas → execução → verificação), começa em **modo aprendizado** e mostra tudo num **escritório virtual em pixel art**, onde quem precisa de você levanta a mão e você responde ali mesmo.

![Escritório virtual](docs/img/escritorio.png)

<details>
<summary><b>English summary</b></summary>

Yggdrasil is a **template for building Claude Code orchestrators**, one per team. Each generated orchestrator:

- runs a **spec-driven cycle per repository**: spec → plan/tasks → script-based readiness check → execution by `skill-worker` subagents → independent `verificador` → learning log;
- starts in **learning mode**, with manual checkpoints on spec, plan and every step. `/autonomia` measures what you approve without changes and suggests what could become automatic;
- ships a **local web "Office"**, a Gather-like pixel-art office where each repository gets a desk cluster. Agents animate according to the tool they are using, Pixel Agents style. Sub-agents sit next to the agent that spawned them, and whoever needs you raises a hand. You answer from the page, read the live **terminal view** (real Claude Code transcripts, nested sub-agents, diffs, outputs), browse a **panel** of work groups, a **flow organizer** (one lane per project: current step, what comes next, parallel branches), a **learning map** (mind map of lessons per skill and per repository) and a **skills library** where you turn skills on and off. The top bar shows your Claude usage limits (5-hour session and weekly), fed by a statusline bridge;
- adds **free chats** with the orchestrator (one tab per conversation, rename, save, reopen, export to Markdown, terminal inside the chat), each one seated in a **chat room** of the office;
- makes the office **grow in floors** when the desk rows fill up (with an elevator), with a full-screen **overview** of every floor and a **per-floor attention panel**; clicking a flow step opens a **detail panel** (what it does, who does it, inputs, outputs, stops, command);
- enforces **guardrails as code** through a `PreToolUse` hook that blocks push, MR/PR, `--no-verify`, `rm -rf` outside `repos/`, edits to settings and edits to the team's own skills;
- keeps a **generic core** (this repo) apart from a **team layer** (`time/`), so improvements to the core reach every instance through `scripts/atualizar-nucleo.js`.

No `npm install`: plain Node.js and a dependency-free page. Docs and code are in Brazilian Portuguese.
</details>

---

## Sumário
- [Por que existe](#por-que-existe)
- [O que você ganha](#o-que-você-ganha)
- [Como funciona](#como-funciona)
- [Requisitos](#requisitos)
- [Começo rápido](#começo-rápido)
- [O Office](#o-office)
- [Conceitos](#conceitos)
- [Referência](#referência)
- [Segurança](#segurança)
- [Evoluindo o núcleo](#evoluindo-o-núcleo)
- [Limitações conhecidas e próximos passos](#limitações-conhecidas-e-próximos-passos)
- [Decisões de projeto](#decisões-de-projeto)
- [Inspirações e créditos](#inspirações-e-créditos)

---

## Por que existe

Entrar num time novo que já tem skills e processos próprios costuma levar a uma de duas situações:
- você automatiza tudo antes de entender o processo, e erra em escala;
- você faz tudo na mão, e não aproveita as skills.

O Yggdrasil propõe um caminho no meio. O orquestrador **segue as skills do time como estão** e **para em cada etapa para explicar** o que vai fazer, por que agora, o que vai tocar e como desfazer. Ele também **mede a sua confiança**: depois de algumas aprovações seguidas sem ajuste, sugere automatizar aquele checkpoint. Você ganha autonomia aos poucos, com rastro de tudo.

O nome vem da árvore que liga os nove mundos da mitologia nórdica: um tronco comum (o núcleo) e um mundo por time (as instâncias).

## O que você ganha

| | |
|---|---|
| **Ciclo SDD por repositório** | spec com evidência `arquivo:linha` → plano e tarefas → *readiness* por script (zero token) → `skill-worker` por tarefa → `verificador` independente → diário e lições |
| **Modo aprendizado** | checkpoints `manual` em spec, plano e cada passo; o `/autonomia` sugere promoções para `auto` (só com o seu ok) |
| **Monitor de contextos** | vários repositórios ao mesmo tempo (`maxContextos`), cada um numa sessão própria do Claude; a caixa de atenção mostra quem espera você |
| **Office (página local)** | Escritório em pixel art, Painel de grupos de trabalho, Organizador de fluxos, Mapa de aprendizado, Biblioteca de skills, Chats, Conversa, Terminal ao vivo e Decisões, com os limites de uso da Claude no topo |
| **Chats livres** | conversa com o orquestrador sem fluxo e sem terminal: abas, renomear, salvar e reabrir, exportar em `.md`, terminal do próprio chat |
| **Escritório que cresce** | quando o térreo enche, o prédio ganha andares; visão geral em tela cheia e painel de atenção por andar |
| **Guardrails como código** | hook `guarda.js` com `permissionDecision: deny` real, não só regra escrita |
| **Telemetria por eventos** | `eventos.jsonl` (append) → `state.json` (projeção). Ninguém edita o estado na mão |
| **Aprendizado com poda** | diário por repo; lições por skill reescritas pelo `/retro` (no máximo ~12, sem repetição) |
| **Molde e instâncias** | `/novo-orquestrador` gera um orquestrador por time; `atualizar-nucleo.js` leva melhorias às instâncias sem tocar no que é do time |
| **Sem dependências** | Node.js puro e página sem CDN; funciona offline e atrás de proxy |

<table>
<tr>
<td width="50%"><b>Baia que cresce com subagentes aninhados</b><br><img src="docs/img/baia-com-subagentes.png" alt="Baia com subagentes"></td>
<td width="50%"><b>Terminal ao vivo, com subagentes aninhados</b><br><img src="docs/img/terminal.png" alt="Terminal"></td>
</tr>
<tr>
<td><b>Painel de grupos de trabalho</b><br><img src="docs/img/painel.png" alt="Painel"></td>
<td><b>Organizador de fluxos</b><br><img src="docs/img/fluxos.png" alt="Organizador de fluxos"></td>
</tr>
<tr>
<td><b>Mapa de aprendizado (poço de Mimir)</b><br><img src="docs/img/aprendizado.png" alt="Mapa de aprendizado"></td>
<td><b>Biblioteca de skills</b><br><img src="docs/img/biblioteca.png" alt="Biblioteca de skills"></td>
</tr>
<tr>
<td><b>Chats livres, uma aba por conversa</b><br><img src="docs/img/chats.png" alt="Chats"></td>
<td><b>Detalhe da etapa (clique num card do fluxo)</b><br><img src="docs/img/fluxo-detalhe.png" alt="Detalhe da etapa"></td>
</tr>
<tr>
<td><b>Visão geral: 50 agentes em dois andares</b><br><img src="docs/img/visao-geral.png" alt="Visão geral dos andares"></td>
<td><b>Painel de atenção por andar</b><br><img src="docs/img/andar-atencao.png" alt="Painel de atenção"></td>
</tr>
<tr>
<td><b>Caixa de atenção no topo, com filtro de concluídos</b><br><img src="docs/img/caixa-suspensa.png" alt="Caixa de atenção suspensa"></td>
<td><b>Conversa em tela cheia, com a caixa de mensagem</b><br><img src="docs/img/conversa-cheia.png" alt="Conversa em tela cheia"></td>
</tr>
</table>

---

## Como funciona

### Núcleo × camada do time

```mermaid
flowchart LR
  subgraph Y["Yggdrasil (este repositório)"]
    N["Núcleo<br/>nucleo.md · agents · hooks<br/>office · skills do núcleo"]
    G["Gaveta<br/>/novo-orquestrador<br/>instanciar.js · atualizar-nucleo.js"]
  end
  G -- gera --> A["Orquestrador do time A<br/>núcleo + time/"]
  G -- gera --> B["Orquestrador do time B<br/>núcleo + time/"]
  N -- atualizar-nucleo.js --> A
  N -- atualizar-nucleo.js --> B
```

- **Núcleo**: genérico e igual em todos. Vem do molde e é substituído por inteiro na atualização. A lista exata está em `.claude/nucleo-manifesto.json`.
- **Time** (`time/`): contexto, regras, fluxos, tema e lista das skills do time. Nunca é tocado pela atualização.
- As regras do time **só acrescentam** restrições ao `nucleo.md`, nunca afrouxam.

### Ciclo de um contexto (um repositório, um fluxo)

```mermaid
sequenceDiagram
  participant V as Você (Office)
  participant O as Orquestrador (sessão claude -p)
  participant W as skill-worker
  participant X as verificador
  V->>O: Nova missão (fluxo + repo)
  O->>O: spec.md (estado atual com evidência, CAs)
  O-->>V: checkpoint "spec" (explica e para)
  V->>O: Aprovar / Rejeitar / alternativa
  O->>O: plano.md + tarefas.md + prontidao.js (READY?)
  O-->>V: checkpoint "plano"
  loop cada tarefa
    O-->>V: checkpoint "passo" (o que faz, o que toca, como desfazer)
    V->>O: Aprovar
    O->>W: [orq] contexto=… passo=… skill=…
    W-->>O: feito · arquivos · evidências · atritos
  end
  O->>X: confere cada CA
  X-->>O: APROVADO / REPROVADO
  O->>O: aprendizado/ + concluir
```

### De onde vem o que aparece na tela

```mermaid
flowchart LR
  H["hooks (telemetria.js)<br/>PreToolUse · SubagentStart/Stop<br/>Stop · Notification"] --> E[(eventos.jsonl)]
  C["estado.js (CLI)<br/>passo · pergunta · concluir"] --> E
  S["server.js<br/>turnos claude -p"] --> E
  E --> P["projeção em memória<br/>→ state.json"]
  T[("~/.claude/projects/…<br/>transcripts + subagentes")] --> TT["transcritos.js<br/>(leitura incremental)"]
  P --> UI["Office<br/>Escritório · Painel · Fluxos · Aprendizado · Biblioteca"]
  TT -- SSE --> TERM["aba Terminal"]
```

Cada mudança é um evento. O estado é a projeção dos eventos, recalculada em memória pelo servidor (o `state.json` é gravado em background). O **Terminal** lê direto os transcripts do Claude Code, então mostra qualquer sessão do mesmo jeito: disparada pelo Office, aberta no seu terminal ou levada de um para o outro.

---

## Requisitos

- **Claude Code** (CLI `claude`), numa versão com os hooks `SubagentStart`/`SubagentStop` e com `--permission-mode auto`.
- **Node.js 18 ou mais novo**. Foi desenvolvido e testado no 24.
- **git**.
- Navegador moderno (Chrome, Edge ou Firefox).
- Funciona no Linux, no macOS e no Windows, pelo **WSL2** ou **direto no Windows** (Node e Claude Code do Windows; os ganchos rodam no Git Bash que o Claude Code usa). Veja as [notas de WSL](#notas-de-wsl) e [Windows sem WSL](#windows-sem-wsl).

---

## Começo rápido

### 1. Veja o Office funcionando (sem gastar token)
```bash
git clone https://github.com/reisrb/claude-yggdrasil-orchestrator.git
cd claude-yggdrasil-orchestrator
node .claude/office/server.js --simular --tema nordico
# abra http://localhost:4320
```
O modo `--simular` troca o Claude por um roteiro de eventos falsos. O caminho servidor → eventos → estado → página é o mesmo do modo real. Teste:
- responder e aprovar;
- retomar depois de um limite ou de um erro;
- convocar missões pelo quadro de missões;
- ver o terminal e os subagentes aninhados.

### 2. Crie o orquestrador do seu time
Abra o Claude Code na pasta do molde e rode:
```
/novo-orquestrador
```
A skill entrevista você, uma pergunta por vez, e gera a instância numa pasta irmã, configurada do seu jeito (tudo dá para mudar depois). Ela pergunta:
- **para qual projeto** é o orquestrador (o sistema e os repositórios) e **o que tem para fazer** nele;
- nome do orquestrador e do time, stacks e ferramentas;
- **as suas skills** (onde estão e o que cada uma faz) e o **fluxo** que você segue, com a skill de cada etapa. Sem processo definido, fica só o `demo`: a skill não inventa passos;
- quem aprova o quê e as regras do time;
- o **tema do escritório** (`nordico` ou `neutro`), com a opção de ver antes no modo simulado;
- o **modo de trabalho**: ela explica o [modo aprendizado e as rodadas iniciais](#rodadas-iniciais-e-modos-de-trabalho) e você escolhe aprendizado, misto ou direto;
- **onde você anota as tarefas e a daily** ([`/tarefas`](#tarefas-e-daily-tarefas)): arquivos na pasta do orquestrador (padrão), Notion ou outro lugar que você descreve. É lá que o 📝 Registrar grava;
- número de contextos simultâneos, porta e pasta de destino.

Se preferir sem entrevista:
```bash
cat > /tmp/respostas.json <<'EOF'
{
  "nome": "Thor",
  "time": "Plataforma",
  "tema": "nordico",
  "modo": "aprendizado",
  "maxContextos": 99,
  "porta": 4321,
  "contexto": {
    "projeto": "Serviços de pagamento (repos pagamentos-api e cadastro-legado)",
    "trabalho": "Subir Java 11 → 21 e trocar o pipeline antigo",
    "objetivo": "Atualizar serviços e padronizar pipelines",
    "stacks": "Java 17/21, Node 20; Kubernetes",
    "ferramentas": "GitLab, Jira",
    "origemSkills": "repo interno de skills do time",
    "aprovacoes": "tech lead aprova MR"
  },
  "tarefas": { "destino": "arquivo", "arquivo": { "pasta": "anotacoes" }, "daily": true, "artefato": { "ativo": true } },
  "regras": ["Branch sempre a partir de develop"],
  "memoria": ["Começo gradual: um repo por vez, em modo aprendizado"]
}
EOF
node scripts/instanciar.js ../thor /tmp/respostas.json --semear-memoria
```
Com `--semear-memoria`, a memória do Claude Code daquela pasta (`~/.claude/projects/<pasta>/memory/`) já começa com o contexto da entrevista.

### 3. Traga as skills e os fluxos do time
Dentro da instância (`../thor`):
1. Traga as skills do time **sem alterar nada**, de um destes jeitos:
   - **cópia** em `.claude/skills/<skill>/SKILL.md`;
   - **plugin do Claude Code** (marketplace do time, com atualização automática);
   - **workspace `repos/`**: o clone do repositório de skills com `repos/.claude/skills` apontando para ele. O Office passa `--add-dir repos` nos turnos, porque é isso que faz o Claude carregar skills de outra pasta (a opção `additionalDirectories` do settings não carrega).
2. Registre cada uma em `time/skills-origem.json`. Skill instalada fora de `.claude/skills` leva `pasta` (`~` e `<versão>` são resolvidos), `invocar` e `origem`; as pastas em `protegidas` ficam barradas para edição pelo `guarda.js`, menos os arquivos em `liberados` (o `APRENDIZADO.md` que a própria skill escreve). A Biblioteca mostra todas.
3. Descreva os fluxos em `time/fluxos/<id>.json`, com a sequência de passos e qual skill cada passo usa (formato [abaixo](#fluxo-timefluxosidjson)). Não invente passos: um fluxo nasce do processo que o time já usa.

### 4. Rode o primeiro ciclo
```bash
cp -r exemplos/repo-exemplo repos/        # ou: git clone <seu repo> repos/<nome>
```
No Claude Code, dentro da instância:
```
/office                         # sobe o Office em http://localhost:<porta>
/iniciar-fluxo demo repo-exemplo
```
Outra opção: no Office, clique no **quadro de missões** (ou em **＋ Nova missão**), escolha o fluxo e o repo e clique em Convocar. A sessão roda em background com `claude -p`, e cada checkpoint aparece na caixa de atenção.

---

## O Office

`node .claude/office/server.js` (ou `/office`) abre o Office em `http://localhost:<porta>`. Ele tem seis visões (abas no topo), um painel lateral por contexto e, no topo, o botão da caixa de atenção e a barra com os limites de uso. As confirmações (parar um contexto, interromper para corrigir, excluir um chat) usam um popup próprio, centralizado, que se usa sem mouse: ← → (ou ↑ ↓) andam entre os botões, Enter aciona e Esc cancela.

### Escritório
Visão de cima, em pixel art, desenhada em Canvas e sem nenhuma imagem externa.

- **Baias**: uma por contexto (repositório), com o nome do repo (e o serviço, quando há) escrito no chão, dentro da baia. Passar o mouse mostra, na dica ao lado dele, o status e quantos grupos de trabalho ela tem. Elas **crescem** com o número de agentes e não encolhem enquanto o contexto existe.
- **Personagens**:
  - **a líder** é a sessão do orquestrador naquele contexto. No tema nórdico é uma valquíria; os nomes vêm da mitologia, que é domínio público;
  - **os workers** são os subagentes, heróis originais gerados a partir do nome da skill (capa, máscara, emblema e cores);
  - **subagentes que lançam outros** sentam junto do pai, num grupo separado por uma divisória baixa.
- **Animação por atividade real**, inspirada no Pixel Agents:

| A sessão está… | Você vê |
|---|---|
| `Edit` / `Write` | digitando, com código rolando no monitor |
| `Read` / `Grep` / `Glob` | lendo (página ou busca no monitor) |
| `Bash` | rodando (terminal verde no monitor) |
| `Agent` | delegando |
| esperando você | de pé, com a mão levantada e um **!** pulsando |
| em espera, com acompanhamento em segundo plano | rodando (terminal no monitor) enquanto o sinal `estado.js worker` chegar; 5 min sem sinal, a tela apaga |

Em cima dos agentes só aparece o que pede você (o **!** e o erro), como na visão geral. O que cada um está executando (arquivo, comando, busca) aparece ao passar o mouse nele.
| limite de uso | dormindo na mesa ("zzz") |
| erro | tela vermelha e fumaça |
| passo concluído | leva ao balcão do verificador e vai para a copa |

- **Elenco fixo do tema nórdico**:
  - **Odin** no trono (Hliðskjálf), mostrando quantos esperam você;
  - **Heimdall** na porta (Bifröst), que levanta o escudo quando o `guarda.js` bloqueia algo;
  - **Forseti** no balcão de verificação;
  - **Huginn e Muninn**, os corvos, que voam com os eventos até o trono;
  - o **poço de Mimir**, onde fica o aprendizado.
  
  O tema `neutro` troca tudo por um escritório comum.
- **Pontos clicáveis do cenário**:
  - o **quadro de missões** convoca contextos;
  - o **quadro branco** abre o organizador de fluxos;
  - o **poço de Mimir** abre o mapa de aprendizado;
  - as **estantes** abrem a biblioteca de skills.
- **Navegação**: roda do mouse dá zoom, arrastar move a vista, duplo clique volta ao normal e clicar num personagem abre a conversa dele. O agente clicado ganha um anel e uma seta azuis; se for um subagente, a conversa abre na aba **Terminal** **isolada nele**: só o bloco daquele agente e o que ele lançou, com o aviso "só <agente>" e o botão **ver todos** para voltar à sessão inteira (clicar na aba Terminal também mostra tudo). Clicar na líder, em qualquer lugar da baia ou no cartão do grupo no Painel abre a **Conversa** da missão; o Terminal completo fica na aba **Terminal**. O Terminal sempre abre no fim, na última atualização, e segue a saída; voltar para a **Conversa** (ou trocar de missão ou de chat) também abre na última mensagem. Os cartões de agente do Painel fazem o mesmo.
- **Andares**: quando as duas fileiras de baias do térreo enchem, as próximas baias sobem para o 1º andar (4 fileiras e um elevador), depois para o 2º, até 8. Andar vazio fecha. Quem trabalha em cima chega e sai pelo elevador. A **barra de andares**, no canto, mostra cada andar com o número de agentes e um **!** onde alguém espera você.
- **Visão geral**: todos os andares de uma vez, em grade, ocupando a tela inteira (o painel lateral some). Clicar entra no andar; clicar num personagem já abre a conversa. **Esc** volta.
- **Painel de atenção**: no canto direito, quem precisa de você, deu erro ou pausou pelo limite, agrupado por andar ("aqui" e "em outro andar"). **ir ↗** leva ao andar e abre a conversa.
- **Sala de chat**: cada chat aberto vira um personagem numa sala própria, separada das baias: digita enquanto o orquestrador responde e mostra 💬 quando é a sua vez.

### Painel
Um cartão por grupo de trabalho:
- a líder no topo, com a atividade atual;
- os subagentes em árvore, ligados pai → filhos;
- pergunta pendente com o botão **Responder**;
- motivo de pausa ou erro;
- lista de concluídos.

![Decisão](docs/img/decisao.png)

### Fluxos (organizador)
Uma faixa por projeto (contexto), da esquerda para a direita, com o andamento de cada um:
- a etapa atual, com a líder e os heróis que estão trabalhando nela e a atividade de cada um;
- o que já passou (✓, contorno verde e mais apagado; concluir o contexto fecha a etapa que ficou em andamento), a etapa em andamento (contorno azul, ou amarelo quando espera você), a pausada (⏸, também mais apagada), o que vem **a seguir** (contorno tracejado) e os ramos paralelos;
- a pergunta pendente com o botão **Responder**, quando o agente está esperando você;
- o **⏱ tempo de execução** no canto superior direito da etapa em andamento (`⏱ 2h14`): só o tempo com a líder (ou a sessão do terminal) pensando ou executando. Esperar a sua resposta, pausa, parada, erro e bloqueio param esse relógio (a marca fica apagada), então parar hoje e retomar amanhã não soma a noite. É o mesmo tempo de trabalho que a previsão usa;
- a **⏱ previsão**: cada etapa mostra, discreto na linha da skill, quanto costuma levar (`~2,0 h`) ou, se já terminou, quanto levou (em verde); a etapa em andamento ganha uma barrinha de progresso (laranja quando passa da previsão), e o cabeçalho da faixa diz **⏱ trabalho: faltam ~X de ~Y** (no concluído, **levou X de trabalho**; nos fluxos disponíveis, o total, um por ramo enquanto o ramo não foi escolhido). A previsão é a **média das últimas 10 execuções** de cada etapa em **tempo de trabalho**: só conta o tempo com a líder (ou a sessão do terminal) trabalhando; a espera por você, pausa, erro e bloqueio ficam fora. Sem histórico, vale o campo `previsao` do passo, que também vale mais que o histórico nas etapas feitas por você ou por uma automação de fora (`executor` `eng` ou `automatico`), cujo tempo o Office não mede. Clicar na etapa mostra de onde veio a conta e, nas feitas, o tempo no relógio, contando a espera;
- o passo **⊘ desativado** (decisão sua, campo `desativado` no fluxo): apagado e tracejado, com a marca **desativado**; o fluxo passa por cima dele (a linha vai direto da etapa anterior para a seguinte) e ele não executa em nenhuma missão até você reativar;
- o fluxo **⛔ bloqueado** (esperando algo de fora): a faixa inteira fica avermelhada, a etapa onde parou fica vermelha com ⛔ e a marca **bloqueado** (não o azul de "em andamento"), nada aparece andando, e um aviso no topo diz o que falta, de quem depende e desde quando.
- a faixa do fluxo com a **conversa aberta** na lateral ganha uma borda azul de foco em volta, para você saber qual fluxo está no chat.

Filtros no topo: **em andamento** (o que está seguindo: rodando, esperando você, pausado ou com erro; os bloqueados ficam fora), **precisa de você** (só os que esperam a sua resposta), **⛔ bloqueados** (só os que esperam algo de fora), **concluídos** (os que já terminaram saem da lista de ativos e ficam só aqui, do mais recente para o mais antigo) ou **fluxos disponíveis**, que mostra cada fluxo de `time/fluxos/` com um botão para convocar uma missão. O organizador só mostra: os fluxos continuam definidos nos arquivos JSON. No canto direito, a **busca** por nome ou card do Jira (ex.: `PROJ-123`) filtra dentro do filtro escolhido; abrir os Fluxos a partir de um projeto já chega com a busca preenchida.

**Clique numa etapa** para abrir o painel de detalhe: o que ela é, quem faz, o que precisa antes, o que acontece, o que sai, quando para e pergunta, o que nunca faz, o comando e a fonte. Num projeto em andamento, o painel mostra também o estado da etapa e quem está nela, com um botão para abrir a conversa. O texto vem do campo `detalhe` de cada passo. Etapas feitas por uma pessoa (`executor: eng`) aparecem como **sua vez**; as automáticas, como **⚙ automático**; ramos condicionais (`quando`) aparecem rotulados na seta.

### Chats
Conversa livre com o orquestrador, sem fluxo, sem repositório e sem terminal: **💬 Novo chat** ou a aba **Chats**.
- **uma aba por chat**; a primeira mensagem abre o chat e dá o título;
- **✎ Renomear**, ou dois cliques na aba ou no título;
- **×** salva e fecha: o chat vai para **🗂 Salvos**, de onde dá para reabrir ou excluir; escrever num salvo reabre a mesma sessão do Claude;
- **Exportar .md** baixa a conversa, com o `claude --resume` da sessão;
- **✋ Corrigir** e **💬 Paralelo** aparecem ao lado do Enviar enquanto ele responde e mudam o **foco** do Enviar, como na conversa da missão (veja **Foco do Enviar** no painel lateral): o botão fica marcado e a caixa de texto mostra para quem vai a mensagem, até você desmarcar (clique de novo, **✕ voltar** ou **Esc**);
  - **Corrigir** interrompe a resposta e manda o que você escreveu no lugar. Sem texto, só interrompe e espera você escrever a correção;
  - **Paralelo**: uma cópia conversa com você na hora, sem interromper a resposta (veja **Conversa paralela** no painel lateral). **Alt+Enter** manda uma mensagem avulsa para a cópia, sem mudar o foco;
- **🖼 Imagem**: cole com **Ctrl+V**, arraste para a caixa de texto ou escolha um arquivo (png, jpg, gif ou webp, até 8 MB). A imagem sobe para o servidor e entra no texto como `[imagem: <caminho>]`; a conversa mostra a miniatura e a líder abre o arquivo com o `Read`. Vale na conversa da missão também;
- **Terminal** troca a conversa pelo terminal do chat (ferramentas, comandos e saídas), na própria tela;
- a resposta toca o aviso e manda notificação, menos quando você já está olhando aquele chat;
- chats não contam como "esperando você" nem ocupam vaga de missão; o limite é `maxChats` (padrão 3).

### Aprendizado (poço de Mimir)
Mindmap radial com o que o orquestrador já aprendeu:
- **um ramo por skill**, colorido pela maturidade: *inexplorada* (nunca rodou e não tem lições), *aprendendo* e *madura* (3 ou mais aprovações seguidas sem ajuste e nenhuma lacuna aberta);
- **folhas** com as lições do `/retro`: *faça*, *evite* e *lacunas da skill*. O tamanho da folha cresce com o número de vezes que a lição apareceu;
- **um ramo por repositório**, com as últimas entradas do diário;
- **Copiar lacunas** monta, em Markdown, a lista de lacunas por skill para levar ao time.

As lições vêm de `aprendizado/skills/<skill>.md` (formato do `/retro`). As execuções e o placar vêm dos eventos.

### Biblioteca de skills
Um cartão por skill, separadas em *skills do time*, *do núcleo* e *outras*. Cada cartão traz a descrição, a maturidade, os fluxos que usam a skill e um **liga/desliga**:
- desligar move a pasta para `.claude/skills-desativadas/`, e o Claude deixa de carregar a skill nas próximas sessões;
- se a skill desligada é usada num fluxo, o cartão avisa que missões desse fluxo vão travar naquele passo;
- `iniciar-fluxo` é essencial e não pode ser desligada.

O orquestrador faz o mesmo pela linha de comando: `estado.js skill desativar <nome>`.

### Limites de uso (missões e statusline)
No topo aparecem a sessão de 5 h (barra e %), a semana (%) e quanto falta para renovar. Fora das missões, a Claude Code só entrega esses números ao comando da statusline, então o molde traz uma **ponte**: `statusline-ponte.js` fica na frente da sua statusline, grava os números em `~/.claude/orq-limites.json` e repassa a entrada para o seu comando de sempre, que continua desenhando a linha do terminal igual.

Para ligar, em `~/.claude/settings.json`:
```json
"statusLine": {
  "type": "command",
  "command": "node /caminho/do/molde/.claude/office/statusline-ponte.js -- <seu comando de statusline atual>"
}
```
Sem `-- <comando>`, a ponte imprime um resumo curto (`5h 43% · semana 19%`). Ela nunca derruba a statusline: se algo falhar, o seu comando roda normalmente. Enquanto uma missão roda, o Office não depende da ponte: cada turno `claude -p` traz no stream um `rate_limit_event` com o uso das duas janelas, e o servidor atualiza a barra na hora. Vale o número mais recente das duas fontes (passe o mouse na barra para ver de onde veio). Sem missão rodando e sem sessão interativa aberta, os números param; quando ficam antigos, a barra mostra há quanto tempo.

Atenção: uma sessão aberta numa pasta que tem o próprio `.claude/settings.json` com `statusLine` usa a statusline **dessa pasta**, não a do usuário; ponha a ponte lá também. Se a ponte não conseguir gravar, o motivo vai para `orq-ponte-erro.txt` na pasta temporária.

### App do Windows (bandeja)
O Office pode rodar sem terminal aberto, como um app do Windows: `.claude/office/app-windows/`, em C# compilado com o `csc.exe` que já vem no Windows (sem dependências e sem administrador).
- **Instalar:** `instalar.cmd /iniciar-com-windows` compila o `<Nome>Office.exe` (o nome vem do `"nome"` do `orquestrador.json`), liga o início automático (registro do usuário) e abre o app. Só compilar: `instalar.cmd`. Desligar o início: `instalar.cmd /remover-inicio`.
- **Bandeja:** losango amarelo = no ar; clique duplo abre o Office. Menu: Abrir o Office, Reiniciar o servidor, **Simulação** (iniciar normal ou lotada numa porta separada, a do Office + 10, abrir no navegador e parar), Ver o log, Iniciar com o Windows e Sair.
- **Menu Iniciar:** o app cria o atalho "<Nome> Office" na primeira abertura. Abrir de novo com o app no ar só abre o navegador.
- **Gerenciador de Tarefas:** em Processos, "<Nome> Office" > Finalizar tarefa derruba os servidores juntos (a entrada do `wsl.exe`, ou do `node.exe`, fecha e cada servidor recebe o aviso); em Aplicativos de inicialização, dá para desativar.
- **Onde o servidor roda:** `orquestrador.json` → `"app": { "executar": "wsl" }` sobe no WSL com o ambiente do terminal (`bash -lic`); `"windows"` sobe direto no `node.exe` do Windows. O `instanciar.js` grava conforme onde rodou; sem a chave, o app usa o WSL se houver `wsl.exe`.
- O servidor sobe com o ambiente do terminal. Se o Office já estiver no ar por uma sessão do terminal, o app só vigia e assume depois de 3 verificações seguidas sem resposta. Um servidor que acha a porta ocupada sai sem mexer no estado.

### Painel lateral do contexto
- **Caixa de atenção**: sem conversa aberta, a lista fica na lateral (quem espera você primeiro, depois o que está rodando e os chats). Com uma conversa aberta, ela sai da lateral, que fica só com a conversa, e abre pelo botão do topo: **⚠ N esperando você** (amarelo e pulsando quando há pendência) ou **Caixa de atenção · N**. Clicar num item abre a conversa e fecha a lista; Esc ou um clique fora também fecham. O filtro **Ativos · Concluídos** tira da lista o que já terminou (concluídos, parados e chats salvos), para não acumular; o Office lembra o filtro escolhido.
- **Cabeçalho compacto**: o título numa linha só (o nome inteiro aparece ao passar o mouse) e, na segunda linha, líder, fluxo, turnos e custo, com as ações **Fluxo**, **Levar ao terminal** e **Parar** ao lado.
- **Largura**: arraste a borda esquerda da lateral para alargar ou estreitar; dois cliques voltam aos 420 px. O Office lembra a largura (`localStorage`).
- **⤢ Conversa em tela cheia**: a conversa cobre a área principal, centralizada, com a caixa de mensagem embaixo. **Esc** ou **⤡** volta. O ⤢ do Terminal continua abrindo o terminal grande com a conversa ao lado; um sai quando o outro entra.
- **Conversa**: a troca resumida com o agente, em markdown: títulos, listas, tabelas e blocos de código com a linguagem, cores e **copiar**; rótulos em caixa alta ("O QUE FAZ:") viram tópicos.
  - Enquanto o turno roda, um balão de **sinal de vida** mostra a líder trabalhando, há quanto tempo, e as últimas atividades dela e dos agentes.
  - **Rolagem:** a conversa só desce sozinha quando você já está no fim. Lendo mais acima, ela fica onde você está, mesmo com o Claude trabalhando e mensagens chegando. A seta **↓** no canto de baixo leva à última mensagem e vira **↓ novas mensagens** quando chega algo enquanto você lê. Nos Chats é igual.
  - **Foco do Enviar** (enquanto o turno roda): a mensagem vai para a **líder** (padrão), para a **💬 cópia paralela** ou como **✋ Corrigir**. Clicar em 💬 Paralelo ou em ✋ Corrigir marca o botão, pinta a caixa de texto (verde ou vermelha) e mostra no topo dela para quem vai ("Para: 💬 cópia da líder · responde agora"). O foco fica até você desmarcar: clique de novo no botão, **✕ voltar** na caixa ou **Esc**. Trocar de contexto ou o fim do turno voltam o foco para a líder (com aviso); depois de um Corrigir enviado, também.
  - **Corrigir**, com o foco nele, é o Esc do terminal: corta o turno (e os comandos que ele abriu) e manda o seu texto como correção na mesma sessão. Sem texto, só corta e espera você escrever. Como a última ação pode ter ficado pela metade, a líder confere o que já foi feito antes de seguir e pergunta antes de desfazer algo. Pede confirmação, porque numa missão o turno pode estar no meio de uma skill.
  - Quando há decisão, a última fala da líder fica **amarela**, com o rótulo **Resumo** em cima, e o **cartão de decisão** vira o rodapé dela, com:
  - **quem pede**: o avatar e o nome da líder da missão, a etapa a que a pergunta se refere (com a skill e o herói dela) e quantos agentes estão parados esperando a resposta;
  - as opções (Aprovar, Rejeitar, Explica melhor ou as alternativas que o agente propôs);
  - o campo **Outra alternativa ou observação**, para escolher uma opção com observação ou mandar uma alternativa sua;
  - **ver detalhes no terminal**.
- **Terminal**: a sessão como no Claude Code, ao vivo por SSE.
  - Cada ferramenta vira um bloco que abre e fecha: comando e saída, arquivo lido, diff de edição.
  - Os subagentes aparecem aninhados no bloco de quem os lançou.
  - O texto da líder sai em markdown, e o comando do Bash e o que o Write grava saem coloridos.
  - A pergunta aberta fica na última fala da líder, em amarelo, com o mesmo cartão de decisão.
  - **⤢** abre em tela cheia sobre o escritório e mantém a conversa e o cartão de decisão ao lado.
- **Decisões**: só as decisões já tomadas (pergunta, resposta e detalhes recolhidos). Se há pergunta aberta, um aviso no topo leva à Conversa.
- **Título ao lado da chave**: em fluxo por ticket, o contexto mostra do que se trata (ex.: o serviço) ao lado da chave, na lista, no cabeçalho, no Painel, nos Fluxos e na placa da baia (`estado.js contexto renomear`).
- **Caixa de mensagem**: fala com o agente a qualquer momento.
  - Se ele está perguntando, a mensagem vale como resposta.
  - Se está trabalhando, entra na **fila**: a mensagem aparece tracejada, com **⏱ aguardando** e a hora, e a líder recebe **no próximo passo dela, sem parar o turno** (logo depois da próxima ferramenta que ela usar; o gancho `recado.js` entrega). Ao chegar, sai da fila e entra na conversa com **📨 entregue sem parar o turno**. O que não chegar até o fim do turno (por exemplo, a líder esperando um agente longo) vai no turno seguinte, como antes. A seta **➤** ao lado interrompe o turno e entrega a fila na hora (na missão, pede confirmação). O **✕** cancela o envio enquanto a líder ainda não recebeu: a mensagem sai da fila e o texto volta para a caixa (se ela já recebeu, o Office avisa e não cancela). Se o contexto for parado, o que estava na fila fica registrado na conversa para reenviar.
  - **💬 Paralelo** (foco marcado, ou **Alt+Enter** para uma mensagem avulsa, enquanto o turno roda): **conversa paralela** com uma cópia da líder, que responde na hora enquanto a original segue trabalhando. A cópia é um fork da sessão (`claude -p --resume <sessão> --fork-session`, com as mesmas opções do turno, então aproveita o cache): sabe tudo o que a líder sabia até ali e vê o estado atual (etapa, agentes rodando). Ela **só lê e consulta**: o gancho `paralelo.js` nega edição, agentes, skills, Bash que escreve e MCP que grava. Quando você dá uma decisão ou instrução, ela encaminha à líder com `estado.js recado`, e a decisão chega no próximo passo da líder, sem interromper (**📨 decisão da conversa paralela**). Sem turno rodando, o recado fica guardado e vai no começo do próximo turno, sem responder sozinho a pergunta aberta. As mensagens da conversa paralela aparecem em verde, com **💬**; cada mensagem abre uma cópia nova, com o que já se falou ali, e a transcrição da cópia é apagada no fim. O custo das cópias soma ao do contexto (`metricas.paraleloUsd`).
  - Se está pausado ou com erro, retoma com a sua instrução.
- **📝 Registrar** (ao lado do Enviar, na conversa e nos Chats): anota o que foi feito desde o último registro (decisões com o porquê, o que mudou e onde, números), **em paralelo e vinculado à sessão em que você clicou**:
  1. **Popup do pedido:** o que o botão faz e onde grava (a anotação configurada em [`registro`](#anotação-do--registrar-registro)). Com **Preparar o rascunho**, ele fecha e o trabalho começa; com Cancelar, nada acontece.
  2. **Rascunho:** uma **cópia da sessão** (`--resume <sessão> --fork-session`) prepara o rascunho **só lendo** (gancho `paralelo.js`, modo `registro`). O que está rodando não para e não recebe nada. O botão vira **📝 Preparando…**.
  3. **Popup do rascunho:** abre sozinho quando fica pronto (de outra tela, um aviso), com o texto formatado e rolagem: **Aprovar e gravar**, **Ajustar…** (você escreve o ajuste e a cópia refaz), **Descartar** ou **Decidir depois** (o botão vira **📝 Ver rascunho**). O rascunho pronto sobrevive a um reinício do servidor.
  4. **Gravação:** só com o Aprovar, a mesma cópia grava exatamente o rascunho, com as ferramentas que `registro.permitir` libera (modo `registro-gravar`), marca o fim com `estado.js registro` e mostra na conversa o que gravou e onde (**📝 registro**). Se não conseguir ("Não gravei: …"), o rascunho volta para aprovar de novo ou descartar.
  A cópia é apagada no fim, e o custo dela soma ao do contexto (`metricas.paraleloUsd`).
- **⛔ Bloquear**: para o fluxo que **depende de algo de fora** para seguir (decisão de alguém, acesso, credencial, outra área). Você escolhe o motivo, escreve o que falta e, se quiser, de quem depende. Também vale escrever na conversa algo como "vou ver isso e depois eu volto, fica bloqueado": a líder bloqueia sozinha (`estado.js bloquear`) e encerra o turno.
  - O contexto **sai da baia** e vai para a **área interditada** do escritório, no canto superior direito, atrás do balcão de verificação (fita zebrada amarela e preta, cone e placa de proibido): a líder fica de pé lá, com a placa ⛔. Não conta como "esperando você" nem ocupa vaga de missão. Com turno rodando, o turno é encerrado e os agentes em andamento ficam anotados para a líder relançar só eles.
  - Nos **Fluxos**, a faixa fica avermelhada, a etapa onde parou fica vermelha com ⛔, e o filtro **⛔ Bloqueados** mostra só esses.
  - Na caixa de atenção, fica separado em **⛔ Bloqueados · aguardando pendência**. O selo **bloqueado** é vermelho; clicar nele explica o que está pendente, de quem e desde quando. Na conversa, o **Resumo** vermelho no fim mostra a pendência, com **Desbloquear**.
  - **Fica guardado até você desbloquear**, mesmo com o servidor reiniciado e por dias: é um evento no histórico do Office, e a sessão do Claude continua a mesma.
  - **Para seguir**, escreva na conversa o que mudou (ex.: "pronto, acesso liberado") ou clique em **Desbloquear**: o fluxo volta para uma baia e a líder recebe a pendência e a sua mensagem, confere (sem ler valor de segredo) e segue de onde parou. Uma pergunta que a líder registre enquanto está bloqueado entra na pendência.
- **⏸ Pausar** (enquanto o turno roda): congela a líder e os agentes onde estão (o turno e tudo o que ele abriu recebem `SIGSTOP`). Eles aparecem dormindo no escritório e no Painel, e o contexto fica **pausado**, sem perder a baia. **Retomar** acorda (`SIGCONT`) e continua do ponto exato, sem relançar nada. Mensagem escrita durante a pausa vai para a fila (⏱); Corrigir e Parar continuam valendo. Numa pausa longa, prazos internos do turno (ex.: o tempo máximo de um comando) podem vencer ao acordar, e a líder refaz só aquele comando. Se o servidor reiniciar com o contexto pausado, ele vira erro e o Retomar começa um turno novo.
- **Agentes interrompidos**: quando o turno é cortado (Parar, Corrigir, ➤, erro, limite de uso ou servidor reiniciado), o Office guarda quem estava rodando sem entregar relatório. Ao retomar ou reativar, a líder recebe essa lista com a regra: relançar só esses, um de cada, depois de conferir o que já ficou feito; quem já entregou não roda de novo.
- **Reativar**: um contexto concluído ou parado volta ao Office na mesma sessão do Claude (`--resume`), com a baia de volta no escritório. O botão só reabre e espera você escrever, sem gastar turno; escrever direto na caixa de mensagem de um contexto encerrado também reativa e já manda. A líder recebe o aviso de que o contexto foi reativado, segue de onde a conversa parou sem refazer etapas e conclui de novo quando terminar. Vale o mesmo limite de uma missão nova: um contexto por repositório e no máximo `maxContextos` ativos.
- **Levar ao terminal**: mostra o `claude --resume <sessão>` para continuar a mesma sessão no seu terminal. O Office marca o contexto como "no terminal" e o Terminal continua espelhando; depois é só devolver.
- **Notificações**: 🔔 ativa a notificação do sistema quando alguém precisa de você e a aba não está visível. 🔊 liga um aviso sonoro. O título da aba mostra quantos estão esperando.

### Parâmetros de URL

| Parâmetro | Efeito |
|---|---|
| `#/painel`, `#/fluxos`, `#/aprendizado`, `#/biblioteca`, `#/chats` | abre a visão |
| `#/chats?id=<contextoId>` · `#/chats?novo=1` | abre um chat · um chat novo |
| `#/escritorio?andar=1` · `#/escritorio?vista=geral` | um andar · a visão geral |
| `#/fluxos?ctx=catalogo&passo=<fluxo>:<etapa>` | abre o detalhe de uma etapa |
| `?sel=<contextoId>` | abre a conversa de um contexto |
| `?aba=conversa\|terminal\|decisoes` | aba do painel lateral |
| `?zoom=2` | zoom inicial do escritório, centrado na baia em foco |
| `?cheia=1` | terminal em tela cheia |
| `?sse=0` | terminal por polling, em vez de streaming (plano B para proxies) |

---

## Conceitos

### Contexto
Um **contexto** é uma sessão do Claude dedicada a **um repositório e um fluxo**.
- Só existe um contexto ativo por repositório, e no máximo `maxContextos` ao mesmo tempo.
- Status possíveis: `TRABALHANDO`, `PRECISA_DE_VOCE`, `PAUSADO`, `PAUSADO_LIMITE`, `BLOQUEADO`, `ERRO`, `CONCLUIDO` e `PARADO`. `BLOQUEADO` espera algo de fora (fica na área interditada, sem baia e sem ocupar vaga).
- **Quem dispara o contexto define como você interage**:
  - **pelo Office**: a sessão roda com `claude -p` e `--resume` a cada turno, e você conversa pela página;
  - **pelo seu terminal**, com `/iniciar-fluxo`: o Office espelha tudo e avisa quando a sessão espera você, mas a resposta é dada no terminal.

### Perguntas e checkpoints
Toda pergunta passa pelo `estado.js`, para aparecer no Office:
```bash
node .claude/office/estado.js pergunta --contexto <id> --tipo checkpoint|duvida|escolha \
  --chave passo:inventario --texto "Posso seguir?" --explicacao "…" --opcoes "Aprovar|Rejeitar|Explica melhor"
```
No turno disparado pelo Office, o agente registra a pergunta e **encerra o turno**: esperar não custa nada. A resposta chega no turno seguinte.

### Modo aprendizado e autonomia
- `orquestrador.json` → `checkpoints` (`spec`, `plano`, `passo`), cada um `manual` ou `auto`, com override por fluxo e passo em `overrides`.
- `node .claude/office/estado.js placar` mostra, por checkpoint, quantas respostas houve e a sequência atual de aprovações sem ajuste.
- `/autonomia` sugere promover para `auto` o que teve 3 ou mais aprovações seguidas sem ajuste. **Só muda a config com o seu ok.**
- **Relatório didático por etapa:** ao fechar cada passo, e em cada portão de skill, o orquestrador publica na Conversa para que a etapa serve, o que rodou (com os comandos), o que mudou, como desfazer e o próximo passo; o `skill-worker` publica uma linha por etapa da skill.
- Auto mode é outra coisa: o `--permission-mode auto` do Claude Code decide **permissão de ferramenta**, e o modo aprendizado decide **o processo**.

### Rodadas iniciais e modos de trabalho
- **Rodadas iniciais.** A 1ª rodada é o fluxo `demo` no `repo-exemplo`: só lê, e mostra o ciclo inteiro (spec, plano, passos, verificação, fechamento) sem risco. Depois, **um repositório real por vez**, com um fluxo do time. Cada rodada deixa o diário em `aprendizado/repos/` e lições por skill em `aprendizado/skills/`, e o `/retro` consolida. Com as rodadas, os checkpoints que sempre passam viram automáticos (pelo `/autonomia`, com o seu ok) e o orquestrador fica mais autônomo.
- **Dá para pular o modo aprendizado.** O `/novo-orquestrador` pergunta o modo, e `instanciar.js` aceita `"modo"`:

  | Modo | `modo` | Checkpoints | Para quem |
  |---|---|---|---|
  | **Aprendizado** (padrão) | `aprendizado` | spec, plano e cada passo param para aprovar, com relatório didático por etapa | quem está conhecendo as skills ou o processo |
  | **Misto** | `autonomo` | só a spec e o plano param; os passos rodam sozinhos | quem confia nas skills, mas quer aprovar o escopo |
  | **Direto** | `autonomo` | nenhum checkpoint para: roda o fluxo inteiro e só pergunta em dúvida real ou no portão de uma skill do time | quem já roda o processo de olhos fechados |

  Em qualquer modo, push, MR, merge e deploy continuam com você, e as guardas (`guarda.js`) valem igual. Para mudar depois, edite `orquestrador.json` → `checkpoints` (e `overrides`, por fluxo e passo).

### Turnos soltos do servidor
O `claude` de cada turno roda **desacoplado** do Office (processo próprio, prompt lido de arquivo, saída em `runs/<contexto>/turno.out`). O servidor só acompanha esse arquivo e guarda em `turno.json` o pid, o início do processo e até onde já leu.
- **Reiniciar o servidor não derruba o turno**: ao subir, ele reanexa e continua do ponto em que parou, ou fecha o turno que terminou enquanto estava fora. A conversa mostra "o servidor reiniciou; o turno continuou rodando e foi reanexado".
- **Parar**, **Pausar** e **Corrigir** continuam matando, congelando e interrompendo o turno de propósito.
- **Limite de duração** (`turnos.maxMinutos`, padrão 120): aplicado pelo `timeout` do sistema, vale com o servidor desligado. Passado o limite o contexto vai para `ERRO` ("clique em Retomar"). Sem `timeout` (Windows sem WSL), o limite não vale.
- **Turno órfão** (o servidor não volta e o turno segue): `estado.js turnos` lista e `estado.js turnos encerrar <contexto>` encerra.
- **Fim de turno só com um resumo**: não é pergunta. A líder segue sozinha até 2 vezes seguidas; depois fica um cartão **resumo**, sem caixa de resposta. A conta zera quando você escreve.
- **Sessão nova por etapa** (`sessao.novaPorEtapa`, experimental, desligada): quando uma etapa fecha, o turno seguinte abre uma sessão limpa em vez de reler a conversa inteira, com um texto de passagem que aponta para os arquivos do ciclo (spec, plano, tarefas, diário) e traz as etapas concluídas e as últimas decisões. Só vale a pena em ciclos longos, e o que ficou só na conversa se perde: grave as decisões antes de fechar a etapa. O custo do Office soma as sessões.

### Papéis
- **Orquestrador (líder do contexto)**: conduz o ciclo, conversa com você e delega.
- **`skill-worker`**: executa **um** passo (uma skill) e nunca verifica o próprio trabalho.
- **`verificador`**: confere os critérios de aceite com evidência e nunca edita.
- **Você**: aprova checkpoints e faz tudo o que é externo (push, MR, merge, deploy, Jira).

### Aprendizado
- **`aprendizado/repos/<repo>.md`**: o diário de cada ciclo, com o que foi feito, atritos, decisões, tempo e custo.
- **`aprendizado/skills/<skill>.md`**: lições curtas que o worker lê antes de executar aquela skill. O `/retro` **reescreve** esse arquivo:
  - poda para no máximo ~12 lições;
  - deduplica e conta quantas vezes cada uma apareceu;
  - separa as lacunas da skill do time, para você levar ao time.

### Tarefas e daily (`/tarefas`)
O núcleo traz um caderno de trabalho com o mesmo esquema em qualquer destino:
- **uma tarefa por frente** (o ticket; sem ticket, o repositório), com status **A fazer**, **Fazendo**, **Aguardando** e **Feito**, e o corpo com Contexto, Pronto quando, Plano, Dúvidas, Subtarefas, **O que foi feito** (uma linha por dia; decisão vira `DD/MM: decidi <o quê> porque <por quê>`), Como foi identificado, Como foi resolvido, Evidências e Sessões do Claude;
- **a daily do dia**, para ler em voz alta: **Para ler** (dois parágrafos, "Ontem…" e "Hoje…"), Ontem (finalizado, decidido, achado), Hoje e Pontos (🚧 bloqueio, 🔎 achado, 🙋 pedido de ajuda).

Onde salvar fica em `time/tarefas.json`: **arquivos markdown** em `anotacoes/` (padrão: `tarefas/`, `dailys/` e um `quadro.md`, fora do git), **Notion** (o `/tarefas configurar` cria os bancos de Tarefas e Dailys na página que você indicar) ou **outro lugar** que você descreve (Jira, Obsidian, Google Docs…).

Opcionalmente, uma **página privada no claude.ai** (artefato) com a daily de hoje no topo (o Para ler em destaque), o quadro por status e a linha do tempo das decisões, para abrir no navegador ou no celular. A skill pergunta uma vez se você quer. A página é uma vitrine: os dados continuam no destino, e ela se atualiza no mesmo endereço quando você roda `/tarefas` no terminal. As sessões do Office (`claude -p`, como a cópia do 📝 Registrar) não têm a ferramenta de artefatos; depois de um Registrar, a página fica para a próxima vez que você rodar `/tarefas`.

| Comando | O que faz |
|---|---|
| `/tarefas` | de manhã, monta a daily (o que está aberto, o que fechou ontem, o que entra hoje) e grava depois do seu ok; depois, mostra o quadro |
| `/tarefas add <título>` | cria a tarefa com uma conversa curta e um plano sugerido |
| `/tarefas fiz <trecho> <texto>` | linha datada em "O que foi feito" |
| `/tarefas fazendo\|aguardando\|feito <trecho>` | muda o status (Fazendo guarda a sessão do Claude para retomar) |
| `/tarefas ponto` | bloqueio, achado ou pedido de ajuda na daily |
| `/tarefas configurar` | escolhe ou troca o destino e libera o 📝 Registrar para gravar lá |

O **📝 Registrar** do Office usa esta skill por padrão: o rascunho mostra as linhas que entram na tarefa da frente e o bloco do projeto na daily, e só grava depois do Aprovar.

---

## Referência

### Estrutura
```
.claude/
  CLAUDE.md                 # identidade + @nucleo.md + @../time/*.md (na instância)
  nucleo.md                 # constituição genérica
  nucleo-manifesto.json     # o que é núcleo (substituído na atualização)
  settings.json             # defaultMode "auto" + hooks
  agents/                   # skill-worker, verificador
  hooks/                    # guarda.js (deny), telemetria.js (eventos e atividade), recado.js (fila no meio do turno), paralelo.js (cópia só lê)
  skills/                   # iniciar-fluxo, office, autonomia, retro, inventario-repo, demo-relatorio, tarefas
                            # (só no molde: novo-orquestrador)
  office/
    server.js               # servidor local (Node puro)
    estado.js               # lib + CLI do estado (eventos → projeção)
    prontidao.js            # readiness do ciclo (READY|BLOCKED)
    transcritos.js          # leitura incremental dos transcripts do Claude Code
    simulador.js            # modo --simular
    index.html, painel.js, estilo.css
    terminal.js, fluxos.js, aprendizado.js, biblioteca.js, chats.js   # visões da página
    dialogo.js              # popups: confirmação e popup rico (HTML com rolagem, campo de texto)
    registro.js             # os popups do 📝 Registrar (pedido e rascunho)
    markdown.js             # markdown da conversa
    statusline-ponte.js     # ponte dos limites de uso (statusline → Office)
    app-windows/            # app do Windows: bandeja, início automático, menu Iniciar e simulação
    escritorio/             # motor.js, cena.js, mapa.js, sprites.js, temas/
    state.schema.json       # contrato do estado
time/                       # camada do time (no molde: vazia, com o fluxo demo); tarefas.json = destino do /tarefas
anotacoes/                  # tarefas, dailys e quadro do /tarefas no destino arquivo (gitignored)
specs/_template/            # spec.md, plano.md, tarefas.md
specs/_nucleo/              # spec e tarefas do próprio núcleo (SDD)
aprendizado/                # diário por repo e lições por skill
exemplos/repo-exemplo/      # repo mínimo para o fluxo demo
repos/                      # clones de trabalho (gitignored)
scripts/                    # instanciar.js, atualizar-nucleo.js, modelos/
```

### `orquestrador.json`
```jsonc
{
  "nome": "Thor", "time": "Plataforma",
  "modo": "aprendizado",                 // aprendizado | autonomo
  "maxContextos": 99,                    // contextos ativos ao mesmo tempo (99 = na prática sem limite; 0 ou vazio volta para 2)
  "maxChats": 3,                         // chats livres abertos ao mesmo tempo (salvos não contam)
  "porta": 4321,
  "checkpoints": { "spec": "manual", "plano": "manual", "passo": "manual" },
  "overrides": { "meu-fluxo": { "inventario": "auto" } },
  "modelos": {                           // usados nos turnos disparados pelo Office
    "orquestrador": { "model": "sonnet", "effort": "medium" },
    "worker": { "model": "sonnet", "effort": "medium" },
    "verificador": { "model": "sonnet", "effort": "low" }
  },
  "orcamento": { "maxUsdPorTurno": 2 },  // vira --max-budget-usd (opcional; sem a chave, não há teto de custo)
  "turnos": { "maxMinutos": 120 },       // duração máxima de um turno (0 = sem limite); vale mesmo com o servidor desligado
  "sessao": { "novaPorEtapa": false },   // sessão nova do Claude a cada etapa fechada (experimental, desligado por padrão)
  "gatilho": {
    "habilitado": true,
    "permissionMode": "auto",
    "disallowedTools": ["Bash(git push:*)", "Bash(glab mr:*)", "Bash(gh pr:*)"]
  }
}
```

### Anotação do 📝 Registrar (`registro`)
Onde e como o **📝 Registrar** anota o que foi feito. **O padrão do molde é a skill [`/tarefas`](#tarefas-e-daily-tarefas)**, no destino de `time/tarefas.json` (o `/tarefas configurar` ajusta este bloco quando você troca o destino). Sem o bloco, ele acrescenta uma entrada datada no diário do ciclo (`aprendizado/repos/<repo>.md`). Para gravar numa skill sua de tarefas (por exemplo uma `/tasks` que grava a tarefa e a daily no Notion), troque o bloco:
```jsonc
"registro": {
  // aparece no popup do pedido
  "resumo": "Atualiza no /tasks (Notion) a tarefa da frente e a daily de hoje com o que foi feito e decidido.",
  "onde": ["Tarefa da frente: \"O que foi feito\" e subtarefas", "Daily de hoje: bloco do projeto em Hoje"],
  // vai para a cópia que prepara e grava: o como (skill, seção de um arquivo do time, formato)
  "instrucoes": "Siga a seção \"Registro\" de time/registro.md e o jeito da skill tasks.",
  // o que a cópia pode usar ao gravar, além de ler (padrões: Nome, Nome(argumento) com *)
  "permitir": ["mcp__<conector-do-notion>__*", "Skill(tasks)", "Edit(time/notas/*)", "Bash(node scripts/minha-fila.js *)"]
}
```
- **`resumo`** e **`onde`** são o que o popup do pedido mostra; **`instrucoes`** é o que a cópia segue para montar o rascunho e gravar.
- **`permitir`** é a lista do que a gravação libera, além de leitura e de `estado.js registro`; o gancho `paralelo.js` nega o resto. `Skill(nome)` libera uma skill; `Edit(caminho)` e `Write(caminho)` aceitam caminho relativo à pasta do orquestrador ou absoluto, com `*`; `Bash(comando *)` vale por comando. Ponha só o que a gravação precisa: nada de Agent, de MCP que transiciona tickets nem de Bash genérico.
- O rascunho é sempre só leitura: a cópia lê o destino (a página, a tarefa, o arquivo) para não repetir o que já está lá e mostra exatamente o que muda. Nada é gravado sem o **Aprovar** do popup.

### Fluxo (`time/fluxos/<id>.json`)
```json
{
  "id": "demo",
  "nome": "Demo: inventário do repositório",
  "missao": "Inventariar um repositório",
  "descricao": "Somente leitura: stack, versões, build, CI e um relatório.",
  "passos": [
    { "id": "inventario", "nome": "Inventário", "skill": "inventario-repo", "papel": "Batedor", "depende": [] },
    { "id": "relatorio", "nome": "Relatório", "skill": "demo-relatorio", "papel": "Cronista", "depende": ["inventario"] }
  ]
}
```
`depende` monta o grafo: dá para ter passos em paralelo. O organizador de fluxos e o quadro de missões leem daqui.

Campos opcionais de cada passo:
- `executor`: `skill` (padrão, um `skill-worker` executa), `eng` (uma pessoa faz; o orquestrador explica, mostra o comando e espera) ou `automatico` (uma automação externa move; o orquestrador só acompanha);
- `quando`: o passo só vale num ramo (ex.: `"Migrar"` ou `"Desligar"`), escolhido pela resposta de um passo anterior; o outro ramo fica parado;
- `previsao`: quanto a etapa costuma levar de trabalho, enquanto não há histórico (número em minutos ou texto como `"2h"`, `"30 min"`, `"1,5 h"`, `"3 dias"`, `"2 sem"`). Com execuções terminadas, a média delas vale mais, menos nas etapas `eng` e `automatico`, em que a `previsao` sempre vale;
- `desativado`: tira o passo do fluxo até você decidir voltar (`true`, um texto com o motivo ou `{ "desde": "AAAA-MM-DD", "motivo": "..." }`). Ele não entra no plano nem nas tarefas (o `prontidao.js` recusa tarefa para ele), não executa em nenhuma missão, e quem dependia dele passa a vir direto do que havia antes. Nos Fluxos, aparece apagado, com ⊘. Para reativar, apague o campo;
- `detalhe`: o texto do painel de detalhe (`oQue`, `quem`, `entrada[]`, `passos[]`, `entrega[]`, `paradas[]`, `nunca[]`, `atencao[]`, `comando`, `fonte`).

No fluxo, `"alvo": "jira"` faz a missão pedir a chave de um ticket (ex.: `PROJ-123`) em vez de um repositório.

### Tema (`time/tema.json`)
```json
{ "base": "nordico", "herois": { "inventario-repo": { "nome": "Batedora" } } }
```
`base` é um preset de `.claude/office/escritorio/temas/` (`nordico` ou `neutro`). Tudo o que estiver em `tema.json` sobrescreve o preset: nomes dos lugares, elenco, paleta e nomes dos heróis por skill.

Além disso, o tema pode ligar detalhes do cenário e trocar personagens, sem mexer em código:

| Chave | O que faz |
|---|---|
| `personagens.<papel>.sprite` | o boneco de cada papel: `odin`, `odinCeo` (terno risca-de-giz, gravata frouxa, tapa-olho com detalhe dourado), `heimdall`, `heimdallRecepcao` (blazer dourado e headset gigante), `forseti`, `orquestradorNeutro`, `guardaNeutro`, `revisorNeutro`; nos mensageiros, `corvo`, `drone` ou `aviao` |
| `lideres.estilo` · `trabalhadores.estilo` | `valquiria`, `heroi` ou `pessoa` |
| `andares` | nomes dos andares, do térreo para cima (ex.: `["Andar Executivo", "Valhalla · 1º andar"]`) |
| `lugares.bloqueados` | nome da área interditada, onde ficam os bloqueados (padrão `⛔ Interditado`) |
| `paleta.rotulo` | cor dos nomes dos lugares (piso claro pede rótulo escuro) |
| `paleta.rotuloBaia` · `rotuloBaiaServico` · `rotuloBaiaSombra` | cor do nome do projeto escrito no chão da baia, da linha do serviço e da sombra do texto (piso claro pede nome escuro e sombra clara) |
| `paleta.luz` | luz ambiente por cima do cenário (ex.: `"rgba(255,150,60,.06)"` para um pôr do sol) |
| `paleta.andares` | tons do piso dos andares de cima |
| `cenario.piso` | `"marmore"`: placas de mármore com veios, no lugar do assoalho |
| `cenario.solPoente` | sol baixo nas janelas (combine com `paleta.ceu` e `paleta.aurora` em tons de laranja) |
| `cenario.trono` | `"executivo"`: cadeira de couro preto e ouro, com capitonê |
| `cenario.gungnir` | `"caneta"`: a lança vira uma caneta-tinteiro de prata na mesa |
| `cenario.portaCarvalho` | porta dupla de carvalho com placas de bronze, na parede ao lado do trono |
| `cenario.paredeVidro` | parede de vidro em volta da plataforma do trono |
| `cenario.recepcao` | `"cftv"`: balcão em arco na porta e uma parede de 12 monitores de câmera |
| `cenario.copaGasta` | carpete gasto perto das máquinas da copa |

Exemplo, um escritório corporativo de Asgard:
```jsonc
{
  "base": "nordico",
  "nomeEscritorio": "Asgard Corp. · Matriz (Andar Executivo)",
  "lugares": { "trono": "Presidência · Hliðskjálf", "porta": "Recepção · Bifrost", "verificador": "Auditoria interna · Forseti" },
  "andares": ["Andar Executivo", "Valhalla · 1º andar"],
  "personagens": {
    "orquestrador": { "nome": "Odin", "papel": "CEO & Fundador", "sprite": "odinCeo" },
    "guarda": { "nome": "Heimdall", "papel": "recepção e segurança", "sprite": "heimdallRecepcao" },
    "mensageiros": { "nome": "Huginn e Muninn", "papel": "drones-assistentes", "sprite": "drone" }
  },
  "trabalhadores": { "estilo": "pessoa" },
  "paleta": { "piso": "#e4ddd0", "pisoAlt": "#dad2c2", "pisoJunta": "#c4b89f", "parede": "#efe9dc", "paredeTopo": "#b8922e", "ceu": "#ff8a4c", "aurora": ["#ff5e62", "#ff9966", "#ffc36e"], "luz": "rgba(255,150,60,.06)", "rotulo": "rgba(92,64,22,.8)", "rotuloBaia": "#14203a", "rotuloBaiaSombra": "rgba(255,255,255,.4)" },
  "cenario": { "piso": "marmore", "solPoente": true, "trono": "executivo", "gungnir": "caneta", "portaCarvalho": true, "paredeVidro": true, "recepcao": "cftv", "copaGasta": true }
}
```

### Skills do núcleo
| Skill | Para quê |
|---|---|
| `/iniciar-fluxo <fluxo> <repo>` | o ciclo SDD completo de um repositório |
| `/office [simular]` | sobe o Office em background |
| `/autonomia` | placar de confiança e sugestão de promoções |
| `/retro` | consolida e poda as lições por skill |
| `inventario-repo` | passo genérico, só leitura: stack, versões, build, CI, por evidência |
| `/tarefas` | tarefas por frente e a daily, no destino que você escolhe; é onde o 📝 Registrar grava |
| `/novo-orquestrador` | (só no molde) entrevista e gera uma instância |

### CLI `estado.js`
```bash
node .claude/office/estado.js contexto criar --repo R --fluxo F        # imprime o id
node .claude/office/estado.js passo --contexto ID --passo P --status ACTIVE|DONE|ERROR [--resumo T]
node .claude/office/estado.js pergunta --contexto ID --tipo checkpoint|duvida|escolha --texto T [--explicacao E] [--opcoes "A|B"] [--chave spec|plano|passo:P]
node .claude/office/estado.js resposta --contexto ID --texto T          # no terminal: registra o que você respondeu (no turno do Office a resposta já chega registrada; repetida, não grava de novo)
node .claude/office/estado.js worker --contexto ID --resumo T           # resumo exibido na baia
node .claude/office/estado.js recado --contexto ID --texto T           # conversa paralela: decisão para a líder (chega no próximo passo dela)
node .claude/office/estado.js bloquear --contexto ID --motivo decisao|acesso|credencial|area|outro --texto T [--quem Q]   # pendência de fora: área interditada
node .claude/office/estado.js contexto concluir --contexto ID [--resumo T]
node .claude/office/estado.js status | placar | projetar | autoteste
node .claude/office/estado.js turnos                                    # lista os turnos do Claude soltos do servidor (rodando ou terminados)
node .claude/office/estado.js turnos encerrar CONTEXTO                  # encerra o turno desse contexto e tudo o que ele abriu
node .claude/office/estado.js liberar-guarda 30                         # kill-switch da guarda por 30 min
node .claude/office/estado.js skill ativar|desativar <nome>             # liga/desliga uma skill (também pela Biblioteca)
node .claude/office/estado.js skill lista
```

### API HTTP do Office
Escuta só em `127.0.0.1` e `::1`. As rotas `POST` exigem o header `X-Orq-Token`, um token gerado a cada start e injetado na página.

| Método | Rota | O quê |
|---|---|---|
| GET | `/state` | estado + catálogo (skills, agents, fluxos, repos) + tema + config |
| GET | `/contextos/:id/conversa` | conversa resumida |
| GET | `/aprendizado` | lições por skill, diário por repo, execuções, placar e maturidade |
| GET | `/contextos/:id/terminal` | SSE com as entradas do transcript (`?desde=N` = JSON por polling) |
| POST | `/trigger` | `{fluxoId, repo, nota?}` cria um contexto e inicia o turno |
| POST | `/imagem` | `{tipo, dados}` (base64, até 8 MB; png, jpg, gif ou webp) guarda a imagem e devolve `{caminho, url}`; o caminho vai no texto como `[imagem: <caminho>]` |
| GET | `/imagens/:arquivo` | a imagem anexada (miniatura na conversa) |
| POST | `/responder` | `{contextoId, texto}` responde a pergunta aberta |
| POST | `/mensagem` | `{contextoId, texto}` mensagem livre (resposta, fila ou retomada) |
| POST | `/retomar` · `/parar` · `/dispensar` | `{contextoId}` (retomar acorda um contexto pausado) |
| POST | `/registrar` | `{contextoId}` abre a cópia da sessão que prepara o rascunho do registro, em paralelo (`/state` traz `registro` com `fase` preparando, pronto ou gravando, `versao` e, quando pronto, `rascunho`) |
| POST | `/registro-aprovar` | `{contextoId, versao}` a cópia grava o rascunho daquela versão |
| POST | `/registro-ajustar` | `{contextoId, texto}` a cópia refaz o rascunho com o ajuste (versão nova) |
| POST | `/registro-descartar` | `{contextoId}` joga fora o rascunho e a cópia; nada é gravado |
| POST | `/fila-cancelar` | `{contextoId, itemId}` tira da fila uma mensagem que a líder ainda não recebeu e devolve o texto (409 se ela já recebeu) |
| POST | `/pausar` | `{contextoId}` congela o turno em andamento e tudo o que ele abriu (status `PAUSADO`) |
| POST | `/bloquear` | `{contextoId, motivo, texto, quem?}` bloqueado por pendência de fora (status `BLOQUEADO`, `/state` traz `bloqueio` com motivo, texto, quem, desde, por e a pergunta que estava aberta); de novo num bloqueado, edita a pendência |
| POST | `/desbloquear` | `{contextoId, texto?}` volta para uma baia e a líder retoma com a pendência e o texto (o `/mensagem` num bloqueado faz o mesmo) |
| POST | `/reativar` | `{contextoId, texto?}` volta um contexto concluído ou parado ao Office na mesma sessão; com texto, já manda (o `/mensagem` num contexto encerrado faz o mesmo) |
| POST | `/paralelo` | `{contextoId, texto}` conversa paralela: uma cópia da líder responde sem interromper o turno; uma de cada vez, a próxima espera (`/state` traz `paralelo` com `desde` e `naFila`); sem turno rodando, vai como `/mensagem` |
| POST | `/fila-enviar` | `{contextoId}` corta o turno em andamento e entrega agora as mensagens da fila (o `/state` traz a fila de cada contexto em `fila`) |
| POST | `/corrigir` | `{contextoId, texto?}` corta o turno em andamento (com os processos que ele abriu) e segue com a correção; sem texto, espera a correção; sem turno rodando, o texto vai como `/mensagem` |
| POST | `/terminal` | `{contextoId, valor}` marca ou desmarca "no terminal" e devolve o `claude --resume` |
| POST | `/skills` | `{nome, ativa}` liga ou desliga uma skill |
| POST | `/chat` | `{texto, titulo?}` abre um chat livre e manda a primeira mensagem |
| POST | `/chat-renomear` · `/chat-salvar` · `/chat-reabrir` · `/chat-excluir` | `{contextoId, titulo?}` |

### Hooks (`.claude/settings.json`)
| Evento | Script | Para quê |
|---|---|---|
| `PreToolUse` (Bash/Edit/Write/…) | `guarda.js` | nega ações proibidas |
| `PreToolUse` (*) | `telemetria.js` | atividade por ferramenta; `worker.inicio` para `Agent` |
| `SubagentStart` / `SubagentStop` | `telemetria.js` | ciclo de vida dos subagentes (inclusive os em background) |
| `PostToolUse(Failure)` (Agent) | `telemetria.js` | fim síncrono ou erro de subagente |
| `PostToolUse` (*) | `recado.js` | só com fila no turno (`ORQ_FILA`): entrega à líder, sem cortar o turno, o que você mandou enquanto ela trabalhava |
| `PreToolUse` (*) | `paralelo.js` | só nas cópias (`ORQ_PARALELO`): na conversa paralela e no rascunho do registro, só lê e consulta; na gravação do registro (`ORQ_PARALELO_MODO=registro-gravar`), libera também o que `registro.permitir` lista e `estado.js registro` |
| `Stop` / `Notification` / `UserPromptSubmit` | `telemetria.js` | sessão do terminal esperando você, ou ativa |

---

## Segurança

- O servidor escuta **só no loopback**. Toda escrita exige token e `Origin`/`Host` locais, e fluxos e repos são validados contra o catálogo.
- O `spawn` do `claude` roda sem shell, com o prompt pelo stdin.
- Os turnos disparados pelo Office rodam com:
  - `--permission-mode auto`;
  - `--disallowedTools` para push, MR e PR;
  - `--max-budget-usd` com o teto por turno.
- O **`guarda.js`** nega, de verdade, nas sessões do Office e também nas do seu terminal:
  - `git push`;
  - `glab mr create|merge|approve` e `gh pr create|merge|review`;
  - `--no-verify`;
  - `rm -rf` fora de `repos/`;
  - edição de `.claude/settings*.json`;
  - edição das skills listadas em `time/skills-origem.json` e das pastas em `protegidas` (plugins, workspace), menos os arquivos em `liberados`.
  
  Se o próprio hook falhar, ele libera a chamada em vez de travar a sessão. Há kill-switch temporário com `estado.js liberar-guarda`.
- Nunca use `--dangerously-skip-permissions` com este molde: a ideia é o auto mode mais a guarda.

---

## Evoluindo o núcleo

O próprio núcleo segue SDD: `specs/_nucleo/spec.md` traz requisitos e critérios de aceite, e `tarefas.md` mostra o que foi feito e o que falta.

```bash
node .claude/office/estado.js autoteste        # eventos, contextos, perguntas, baias, guarda, limites, concorrência, schema
node .claude/office/prontidao.js --autoteste   # readiness: READY no caso bom, BLOCKED nos ruins
node .claude/hooks/guarda.js --autoteste       # 19 casos de nega/libera + entrada malformada
node .claude/hooks/paralelo.js --autoteste     # o que a cópia da conversa paralela pode e não pode
node .claude/office/server.js --simular        # protótipo visual
node .claude/office/server.js --simular --cenario lotado --porta 4330   # teste de escala: 5 projetos × 10 agentes, em andares
```

Para levar uma melhoria às instâncias:
```bash
node scripts/atualizar-nucleo.js ../minha-instancia --dry-run   # mostra o que muda
node scripts/atualizar-nucleo.js ../minha-instancia             # aplica (com tag git de rollback, se houver commit)
```
Só os arquivos do manifesto são substituídos. O `settings.json` é mesclado, unindo os hooks e permissões do molde com os da instância. `time/`, `specs/<repo>/`, `aprendizado/`, `repos/` e as skills do time nunca são tocados.

**Regra do molde:** nada de termos de negócio no núcleo. Nomes de times, sistemas e tickets ficam só em `time/` das instâncias.

### Notas de WSL
- Projetos em `/mnt/c` (disco do Windows visto pelo WSL) têm I/O lento, de 50 a 130 ms por operação. O servidor guarda estado, catálogo, estáticos e conversas em memória e grava em background, então as respostas ficam na casa de dezenas de milissegundos.
- No Windows, `localhost` tenta IPv6 (`::1`) primeiro, e o servidor também escuta em `::1` para evitar 2 s de espera. O primeiro acesso depois de reiniciar o servidor pode demorar uns segundos, por causa do aquecimento da ponte do WSL.
- Os transcripts do Claude Code ficam em `~/.claude/projects/` (disco do Linux), então a leitura do Terminal é rápida.

### Windows sem WSL
O orquestrador roda direto no Windows, com o Node e o Claude Code do Windows. O Claude Code roda os ganchos (sintaxe bash) pelo Git Bash.
- **Servidor e app da bandeja:** com `"app": { "executar": "windows" }` (ou sem `wsl.exe`), o app sobe o `server.js` no `node.exe`, e fechar o app encerra o servidor pela entrada dele (`ORQ_PARAR_COM_STDIN`).
- **Claude:** o Office acha o `claude.exe` (instalador nativo) no PATH; com o `claude.cmd` do npm, roda o `cli.js` do pacote com o próprio Node (o `spawn` não abre `.cmd`).
- **Parar, Corrigir e ➤:** sem `ps`, o turno e tudo o que ele abriu caem com `taskkill /T /F`.
- **Pausar não existe no Windows** (não há `SIGSTOP`): o botão some, e o `/pausar` responde explicando. Para segurar um fluxo, use **⛔ Bloquear** ou **Parar**.
- **Guardas:** o `guarda.js` cobre também a ferramenta **PowerShell** do Claude Code (push, MR e PR, e remoção recursiva fora de `repos/`: `Remove-Item -Recurse`, `rd /s` e aliases). O `paralelo.js` só libera leitura, então nega o PowerShell nas cópias. Caminhos do Git Bash (`/c/Users/...`) e `~` (pela pasta do usuário, mesmo sem `HOME`) são resolvidos.
- **`disallowedTools`** do `orquestrador.json` usam a sintaxe `Bash(...)`; no Windows, a proteção do PowerShell vem do `guarda.js`.

---

## Limitações conhecidas e próximos passos

**Limitações**
- **O Office não digita numa sessão interativa aberta no seu terminal.** O Claude Code não oferece isso. Para conversar pela página, a sessão precisa ter sido disparada pelo Office; as sessões do terminal são espelhadas só para leitura. Dá para alternar com **Levar ao terminal** e `claude --resume`.
- Nas sessões do Office, a mensagem enviada no meio de um turno chega à líder **depois da próxima ferramenta** que ela usar (o `claude -p` não lê mensagem no meio do turno; quem entrega é o gancho `recado.js`). Se ela está esperando um agente longo, a mensagem espera junto: para conversar nesse meio-tempo, use o **💬 Paralelo**; para mudar o rumo na hora, **➤** ou **Corrigir**, que cortam o turno.
- O custo exibido é o **acumulado da sessão** que o Claude Code reporta.
- Os sprites são feitos em código, com cara de 16-bit simples. Dá para trocar por um pacote de arte CC0 sem mexer na lógica.
- O escritório cresce até 8 andares (2 fileiras no térreo e 4 em cada andar de cima). Uma baia tem até 11 lugares; agentes além disso ficam em pé no corredor da baia.
- Sem missão rodando, os limites de uso no topo dependem da ponte da statusline e de uma sessão interativa do Claude Code aberta.

**Próximos passos**
- Modo passeio: um avatar seu andando pelo WASD, que abre a conversa ao chegar perto de um herói.
- Ondas de repositórios em paralelo, cada um em worktree ou clone próprio.
- Editor de layout do escritório e mais temas.
- Pacote de arte CC0 opcional.

---

## Decisões de projeto

O registro das decisões (o que foi escolhido, por quê e o que ficou de fora) está em [`docs/decisoes.md`](docs/decisoes.md).

## Inspirações e créditos

- **[claude-didio-config](https://github.com/eduardodidio/claude-didio-config)**: um `claude -p` por agente, estado projetado a partir de logs, readiness antes de executar e retrospectiva que vira aprendizado. Aqui as ideias foram adaptadas: readiness por script, lições com poda, guardrails como hook e Node puro.
- **[Pixel Agents](https://github.com/pablodelucca/pixel-agents)**: personagens em pixel art animados pela ferramenta que a sessão está usando, com subagentes como personagens ligados ao pai.
- **Gather**: o conceito de escritório virtual visto de cima.
- **Mitologia nórdica** (domínio público): Odin, Heimdall, Forseti, Huginn e Muninn, Mimir, Hliðskjálf, Bifröst, valquírias. Todos os heróis e sprites são **originais**, gerados em código, sem personagens de nenhuma franquia.

## Licença

[MIT](LICENSE). Use, adapte e monte o orquestrador do seu time.
