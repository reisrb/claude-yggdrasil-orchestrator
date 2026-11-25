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
- Funciona no Linux, no macOS e no Windows via **WSL2**. Veja as [notas de WSL](#notas-de-wsl).

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
A skill entrevista você e gera a instância numa pasta irmã. Ela pergunta:
- nome do orquestrador e do time, e o objetivo do time;
- stacks e ferramentas;
- de onde vêm as skills do time;
- quem aprova o quê e as regras do time;
- tema, número de contextos simultâneos e porta.

Se preferir sem entrevista:
```bash
cat > /tmp/respostas.json <<'EOF'
{
  "nome": "Thor",
  "time": "Plataforma",
  "tema": "nordico",
  "maxContextos": 2,
  "porta": 4321,
  "contexto": {
    "objetivo": "Atualizar serviços e padronizar pipelines",
    "stacks": "Java 17/21, Node 20; Kubernetes",
    "ferramentas": "GitLab, Jira",
    "origemSkills": "repo interno de skills do time",
    "aprovacoes": "tech lead aprova MR"
  },
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

`node .claude/office/server.js` (ou `/office`) abre o Office em `http://localhost:<porta>`. Ele tem seis visões (abas no topo), um painel lateral por contexto e, no topo, o botão da caixa de atenção e a barra com os limites de uso. As confirmações (parar um contexto, interromper para corrigir, excluir um chat) usam um popup próprio, centralizado.

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
- **Navegação**: roda do mouse dá zoom, arrastar move a vista, duplo clique volta ao normal e clicar num personagem abre a conversa dele. O agente clicado ganha um anel e uma seta azuis; se for um subagente, a conversa abre na aba **Terminal** **isolada nele**: só o bloco daquele agente e o que ele lançou, com o aviso "só <agente>" e o botão **ver todos** para voltar à sessão inteira (clicar na aba Terminal também mostra tudo). Clicar na líder, em qualquer lugar da baia ou no cartão do grupo no Painel abre o Terminal completo. O Terminal sempre abre no fim, na última atualização, e segue a saída; voltar para a **Conversa** (ou trocar de missão ou de chat) também abre na última mensagem. Os cartões de agente do Painel fazem o mesmo.
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
- a pergunta pendente com o botão **Responder**, quando o agente está esperando você.

Filtros no topo: **projetos ativos**, um projeto só (útil quando há vários rodando ao mesmo tempo), **concluídos** (os que já terminaram saem da lista de ativos e ficam só aqui, do mais recente para o mais antigo) ou **fluxos disponíveis**, que mostra cada fluxo de `time/fluxos/` com um botão para convocar uma missão. O organizador só mostra: os fluxos continuam definidos nos arquivos JSON.

**Clique numa etapa** para abrir o painel de detalhe: o que ela é, quem faz, o que precisa antes, o que acontece, o que sai, quando para e pergunta, o que nunca faz, o comando e a fonte. Num projeto em andamento, o painel mostra também o estado da etapa e quem está nela, com um botão para abrir a conversa. O texto vem do campo `detalhe` de cada passo. Etapas feitas por uma pessoa (`executor: eng`) aparecem como **sua vez**; as automáticas, como **⚙ automático**; ramos condicionais (`quando`) aparecem rotulados na seta.

### Chats
Conversa livre com o orquestrador, sem fluxo, sem repositório e sem terminal: **💬 Novo chat** ou a aba **Chats**.
- **uma aba por chat**; a primeira mensagem abre o chat e dá o título;
- **✎ Renomear**, ou dois cliques na aba ou no título;
- **×** salva e fecha: o chat vai para **🗂 Salvos**, de onde dá para reabrir ou excluir; escrever num salvo reabre a mesma sessão do Claude;
- **Exportar .md** baixa a conversa, com o `claude --resume` da sessão;
- **Corrigir** aparece ao lado do Enviar enquanto ele responde: interrompe a resposta e manda o que você escreveu no lugar. Sem texto, só interrompe e espera você escrever a correção;
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
- **Gerenciador de Tarefas:** em Processos, "<Nome> Office" > Finalizar tarefa derruba os servidores juntos (a entrada do `wsl.exe` fecha e cada servidor recebe o aviso); em Aplicativos de inicialização, dá para desativar.
- O servidor sobe no WSL com o ambiente do terminal (`bash -lic`). Se o Office já estiver no ar por uma sessão do terminal, o app só vigia e assume depois de 3 verificações seguidas sem resposta. Um servidor que acha a porta ocupada sai sem mexer no estado.

### Painel lateral do contexto
- **Caixa de atenção**: sem conversa aberta, a lista fica na lateral (quem espera você primeiro, depois o que está rodando e os chats). Com uma conversa aberta, ela sai da lateral, que fica só com a conversa, e abre pelo botão do topo: **⚠ N esperando você** (amarelo e pulsando quando há pendência) ou **Caixa de atenção · N**. Clicar num item abre a conversa e fecha a lista; Esc ou um clique fora também fecham. O filtro **Ativos · Concluídos** tira da lista o que já terminou (concluídos, parados e chats salvos), para não acumular; o Office lembra o filtro escolhido.
- **Cabeçalho compacto**: o título numa linha só (o nome inteiro aparece ao passar o mouse) e, na segunda linha, líder, fluxo, turnos e custo, com as ações **Fluxo**, **Levar ao terminal** e **Parar** ao lado.
- **Largura**: arraste a borda esquerda da lateral para alargar ou estreitar; dois cliques voltam aos 420 px. O Office lembra a largura (`localStorage`).
- **⤢ Conversa em tela cheia**: a conversa cobre a área principal, centralizada, com a caixa de mensagem embaixo. **Esc** ou **⤡** volta. O ⤢ do Terminal continua abrindo o terminal grande com a conversa ao lado; um sai quando o outro entra.
- **Conversa**: a troca resumida com o agente, em markdown: títulos, listas, tabelas e blocos de código com a linguagem, cores e **copiar**; rótulos em caixa alta ("O QUE FAZ:") viram tópicos.
  - Enquanto o turno roda, um balão de **sinal de vida** mostra a líder trabalhando, há quanto tempo, e as últimas atividades dela e dos agentes.
  - **Corrigir**, ao lado do Enviar enquanto o turno roda, é o Esc do terminal: corta o turno (e os comandos que ele abriu) e manda o seu texto como correção na mesma sessão. Sem texto, só corta e espera você escrever. Como a última ação pode ter ficado pela metade, a líder confere o que já foi feito antes de seguir e pergunta antes de desfazer algo. Pede confirmação, porque numa missão o turno pode estar no meio de uma skill.
  - Quando há decisão, a última fala da líder fica **amarela** e o **cartão de decisão** vira o rodapé dela, com:
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
  - Se está trabalhando, entra na **fila** do próximo turno: a mensagem aparece tracejada, com **⏱ aguardando** e a hora, e só entra na conversa quando é entregue. A seta **➤** ao lado interrompe o turno e entrega a fila na hora (na missão, pede confirmação). Se o contexto for parado, o que estava na fila fica registrado na conversa para reenviar.
  - Se está pausado ou com erro, retoma com a sua instrução.
- **📝 Registrar** (ao lado do Enviar, na conversa e nos Chats): a líder registra o que foi feito desde o último registro (decisões com o porquê, o que mudou e onde, números) e mostra o que gravou. O clique é o pedido explícito do usuário e vale como o ok para gravar. O destino e o formato são do time: a seção "Botão Registrar do Office" de `time/integracoes-pessoais.md` (ex.: tarefa e daily num gerenciador de tarefas, rascunho de autoavaliação para aprovar); sem ela, vira uma entrada datada no diário do ciclo (`aprendizado/repos/<repo>.md`). Com turno rodando, o pedido entra na fila (⏱); com pergunta aberta ou contexto encerrado, a líder registra sem abrir outra pergunta e sem reativar. Ao terminar, marca o fim com `estado.js registro`, e o próximo registro começa dali.
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
- Status possíveis: `TRABALHANDO`, `PRECISA_DE_VOCE`, `PAUSADO_LIMITE`, `ERRO`, `CONCLUIDO` e `PARADO`.
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
  hooks/                    # guarda.js (deny), telemetria.js (eventos e atividade)
  skills/                   # iniciar-fluxo, office, autonomia, retro, inventario-repo, demo-relatorio
                            # (só no molde: novo-orquestrador)
  office/
    server.js               # servidor local (Node puro)
    estado.js               # lib + CLI do estado (eventos → projeção)
    prontidao.js            # readiness do ciclo (READY|BLOCKED)
    transcritos.js          # leitura incremental dos transcripts do Claude Code
    simulador.js            # modo --simular
    index.html, painel.js, estilo.css
    terminal.js, fluxos.js, aprendizado.js, biblioteca.js, chats.js   # visões da página
    dialogo.js              # popup de confirmação
    statusline-ponte.js     # ponte dos limites de uso (statusline → Office)
    app-windows/            # app do Windows: bandeja, início automático, menu Iniciar e simulação
    escritorio/             # motor.js, cena.js, mapa.js, sprites.js, temas/
    state.schema.json       # contrato do estado
time/                       # camada do time (no molde: vazia, com o fluxo demo)
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
  "maxContextos": 2,                     // contextos ativos ao mesmo tempo
  "maxChats": 3,                         // chats livres abertos ao mesmo tempo (salvos não contam)
  "porta": 4321,
  "checkpoints": { "spec": "manual", "plano": "manual", "passo": "manual" },
  "overrides": { "meu-fluxo": { "inventario": "auto" } },
  "modelos": {                           // usados nos turnos disparados pelo Office
    "orquestrador": { "model": "sonnet", "effort": "medium" },
    "worker": { "model": "sonnet", "effort": "medium" },
    "verificador": { "model": "sonnet", "effort": "low" }
  },
  "orcamento": { "maxUsdPorTurno": 2 },  // vira --max-budget-usd
  "gatilho": {
    "habilitado": true,
    "permissionMode": "auto",
    "disallowedTools": ["Bash(git push:*)", "Bash(glab mr:*)", "Bash(gh pr:*)"]
  }
}
```

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
- `detalhe`: o texto do painel de detalhe (`oQue`, `quem`, `entrada[]`, `passos[]`, `entrega[]`, `paradas[]`, `nunca[]`, `atencao[]`, `comando`, `fonte`).

No fluxo, `"alvo": "jira"` faz a missão pedir a chave de um ticket (ex.: `PROJ-123`) em vez de um repositório.

### Tema (`time/tema.json`)
```json
{ "base": "nordico", "herois": { "inventario-repo": { "nome": "Batedora" } } }
```
`base` é um preset de `.claude/office/escritorio/temas/` (`nordico` ou `neutro`). Tudo o que estiver em `tema.json` sobrescreve o preset: nomes dos lugares, elenco, paleta e nomes dos heróis por skill.

### Skills do núcleo
| Skill | Para quê |
|---|---|
| `/iniciar-fluxo <fluxo> <repo>` | o ciclo SDD completo de um repositório |
| `/office [simular]` | sobe o Office em background |
| `/autonomia` | placar de confiança e sugestão de promoções |
| `/retro` | consolida e poda as lições por skill |
| `inventario-repo` | passo genérico, só leitura: stack, versões, build, CI, por evidência |
| `/novo-orquestrador` | (só no molde) entrevista e gera uma instância |

### CLI `estado.js`
```bash
node .claude/office/estado.js contexto criar --repo R --fluxo F        # imprime o id
node .claude/office/estado.js passo --contexto ID --passo P --status ACTIVE|DONE|ERROR [--resumo T]
node .claude/office/estado.js pergunta --contexto ID --tipo checkpoint|duvida|escolha --texto T [--explicacao E] [--opcoes "A|B"] [--chave spec|plano|passo:P]
node .claude/office/estado.js resposta --contexto ID --texto T          # no terminal: registra o que você respondeu
node .claude/office/estado.js worker --contexto ID --resumo T           # resumo exibido na baia
node .claude/office/estado.js contexto concluir --contexto ID [--resumo T]
node .claude/office/estado.js status | placar | projetar | autoteste
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
| POST | `/responder` | `{contextoId, texto}` responde a pergunta aberta |
| POST | `/mensagem` | `{contextoId, texto}` mensagem livre (resposta, fila ou retomada) |
| POST | `/retomar` · `/parar` · `/dispensar` | `{contextoId}` (retomar acorda um contexto pausado) |
| POST | `/registrar` | `{contextoId}` a líder registra o que foi feito desde o último registro (na fila, se houver turno rodando) |
| POST | `/pausar` | `{contextoId}` congela o turno em andamento e tudo o que ele abriu (status `PAUSADO`) |
| POST | `/reativar` | `{contextoId, texto?}` volta um contexto concluído ou parado ao Office na mesma sessão; com texto, já manda (o `/mensagem` num contexto encerrado faz o mesmo) |
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

---

## Limitações conhecidas e próximos passos

**Limitações**
- **O Office não digita numa sessão interativa aberta no seu terminal.** O Claude Code não oferece isso. Para conversar pela página, a sessão precisa ter sido disparada pelo Office; as sessões do terminal são espelhadas só para leitura. Dá para alternar com **Levar ao terminal** e `claude --resume`.
- Nas sessões do Office, sua mensagem entra **entre turnos**: se ele estiver no meio de um turno, ela vai para a fila (⏱). Para mudar o rumo na hora, use **➤** na mensagem da fila ou **Corrigir**, que corta o turno (o `claude -p` não recebe mensagem no meio do turno).
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
