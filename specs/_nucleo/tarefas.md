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
| T15 | Terminal ao vivo (transcripts via SSE, subagentes aninhados), tela cheia, polling `?sse=0` | CA4.3 | feito (v0.1.4) |
| T16 | Cartão de decisão com alternativa digitada; aba Decisões; mensagem livre (`/mensagem`) | CA4.3 | feito (v0.1.4) |
| T17 | Organizador de fluxos (faixa por projeto, etapa atual, a seguir, ramos paralelos), substitui o Atlas | CA4.1 | feito (v0.2.0) |
| T18 | Mapa de aprendizado (poço de Mimir) + `/aprendizado` (lições, diário, execuções, placar, maturidade) | — | feito (v0.2.0) |
| T19 | Biblioteca de skills: liga/desliga (`skills-desativadas/`), `estado.js skill`, `POST /skills`; atualizador respeita skills desligadas | CA7.2 | feito (v0.2.0) |
| T20 | Limites de uso no topo via `statusline-ponte.js` (`~/.claude/orq-limites.json`) | — | feito (v0.2.0) |
| T21 | Checkpoint marca a etapa que libera (`passo:<id>`); "agora" no organizador; imagens do README refeitas em modo demonstração | CA2.3, CA4.1 | feito (v0.2.1) |
| T22 | Detalhe da etapa no organizador (campo `detalhe`, link `passo=<fluxo>:<etapa>`); campos `executor`, `quando` e `alvo` | CA4.1 | feito (v0.3.0) |
| T23 | Chats livres: rotas `/chat*`, fluxo virtual `chat`, `maxChats`, tela Chats (abas, renomear, salvar, reabrir, exportar, terminal), sala de chat no escritório | — | feito (v0.3.0) |
| T24 | Popup de confirmação próprio (`dialogo.js`) | — | feito (v0.3.0) |
| T25 | Escritório em andares, visão geral, barra de andares e painel de atenção; cenário de simulação `--cenario lotado` | CA4.x | feito (v0.3.0) |
| T26 | Skills do time em plugin ou workspace (`skills-origem.json`: `pasta`, `invocar`, `protegidas`, `liberados`); `--add-dir repos`; Biblioteca só leitura para elas; guarda por pastas | CA7.2 | feito (v0.3.0) |
| T27 | Cartão de decisão com quem pede (líder, etapa, agentes parados); destaque do agente clicado e Terminal no bloco dele | CA4.x | feito (v0.3.1) |
| T28 | Cartão de pergunta cabe na lateral: altura máxima, texto longo rola por dentro, opções e resposta sempre à vista | CA4.x | feito (v0.4.0) |
| T29 | Pergunta dentro do fluxo: a última fala da líder fica amarela, na Conversa e no Terminal, e o cartão de decisão (quem pede, opções, outra alternativa) vira o rodapé dela; Decisões mostra só as tomadas | CA4.x | feito (v0.4.0) |
| T30 | Markdown na Conversa, no Terminal e nos Chats (`markdown.js`): títulos, listas, tabelas, citações, rótulos em caixa alta como tópicos e blocos de código com a linguagem, cores e copiar | CA4.x | feito (v0.4.0) |
| T31 | Sinal de vida na Conversa enquanto o turno roda: líder trabalhando há quanto tempo e as últimas atividades dela e dos agentes | CA4.x | feito (v0.4.0) |
| T32 | Título ao lado da chave (lista, cabeçalho, Painel, Fluxos e placa da baia); `estado.js contexto renomear`; o `/iniciar-fluxo` registra o alvo do ticket | CA4.x | feito (v0.4.0) |
| T33 | App do Windows: bandeja, início automático (HKCU Run), atalho no menu Iniciar, servidor no WSL preso ao app, simulação separada; manifesto do núcleo com `app-windows/` e `*.exe` ignorado | CA4.x | feito (v0.5.0) |
| T34 | Relatório didático por etapa no modo aprendizado (`nucleo.md`) e "Passos executados" no `skill-worker` | CA3.x | feito (v0.5.0) |
| T35 | Servidor só recupera e refresca o estado depois de conseguir a porta; porta ocupada sai sem mexer no estado | CA4.x | feito (v0.5.0) |
| T36 | Ponte da statusline registra o erro em `orq-ponte-erro.txt`; README explica a statusline por pasta | CA4.x | feito (v0.5.0) |
| T37 | **Corrigir** na Conversa e nos Chats: `POST /corrigir` corta o turno e os processos dele (também no Parar) e segue com a correção na mesma sessão (`--resume`) | CA3.x, CA4.3 | feito (v0.5.1) |
| T38 | Lateral só da conversa: caixa de atenção no botão do topo (lista suspensa com conversa aberta), cabeçalho compacto, largura ajustável pela alça e conversa em tela cheia com a caixa de mensagem | CA4.3 | feito (v0.5.1) |
| T39 | **Reativar** contexto concluído ou parado (`POST /reativar`, ou escrever na conversa encerrada) na mesma sessão, com a baia de volta (`estado.js`); filtro **Concluídos** na caixa de atenção e nos Fluxos; imagens do README refeitas na simulação do molde | CA2.4, CA4.1, CA4.3 | feito (v0.5.1) |
| T40 | Escritório sem bolha de atividade sobre os agentes (só o que pede você; o resto na dica ao passar o mouse); nome da baia escrito no chão, com a placa ao passar o mouse; Terminal isolado no agente clicado ("ver todos" volta); etapa concluída verde e apagada nos Fluxos | CA4.1, CA4.3 | feito (v0.5.2) |
| T41 | Clicar na líder abre o Terminal completo; o Terminal sempre abre no fim (última atualização), também isolado no agente e nos Chats; sem placa ao passar o mouse na baia (só a dica) | CA4.3 | feito (v0.5.2) |
| T42 | Concluir o contexto fecha (DONE) a etapa que ficou em andamento; passo, checkpoint ou agente com etapa fora do fluxo não cria etapa fantasma; `estado.js passo` recusa etapa fora do fluxo e lista as certas | CA2.3, CA4.1 | feito (v0.5.2) |
| T43 | Fila visível: mensagem enviada durante o turno aparece com ⏱ (o `/state` traz `fila`) e entra na conversa ao ser entregue; ➤ (`POST /fila-enviar`) interrompe e entrega na hora; Parar registra a fila não entregue; Enviar dos Chats põe na fila enquanto responde | CA3.x, CA4.3 | feito (v0.5.2) |
| T44 | **Pausar** (`POST /pausar`, status `PAUSADO`): SIGSTOP no turno e no que ele abriu, agentes dormindo; Retomar acorda (SIGCONT) sem relançar. Lista de agentes interrompidos (evento `contexto.status` com `interrompidos`) entregue à líder ao retomar, reativar, corrigir ou mandar a fila: relançar só esses, um de cada | CA2.x, CA3.x, CA4.3 | feito (v0.5.3) |
| T45 | **📝 Registrar** na conversa e nos Chats (`POST /registrar`): turno só de registro, destino em `time/integracoes-pessoais.md` (senão o diário do ciclo); fila se houver turno; sem nova pergunta com pergunta aberta ou contexto encerrado; fim marcado por `estado.js registro` (evento `registro.feito`, `ultimoRegistro` no contexto) | CA3.x, CA4.3 | feito (v0.5.4) |
| T46 | Mensagem com o turno rodando chega à líder **no próximo passo, sem cortar o turno** (gancho `recado.js` no `PostToolUse`, fila espelhada em `runs/<ctx>/fila.json` via `ORQ_FILA`, entregues em `fila.entregues`, 📨 na conversa). **💬 Conversa paralela** (`POST /paralelo`, Alt+Enter): cópia da líder por `--resume --fork-session`, só leitura (gancho `paralelo.js`, sem telemetria), decisões encaminhadas com `estado.js recado` (fila da líder, ou guardadas para o próximo turno), transcrição da cópia apagada, custo em `metricas.paraleloUsd` | CA4.x | feito (v0.5.5) |
| T47 | **Foco do Enviar** na Conversa e nos Chats: 💬 Paralelo e ✋ Corrigir viram botões que ficam marcados (`aria-pressed`), a caixa de texto mostra o foco ("Para: …") e muda de cor; desmarca com clique de novo, ✕ ou Esc; troca de contexto, fim do turno e Corrigir enviado voltam para a líder | CA3.x | feito (v0.5.6) |
| T48 | **📝 Registrar em paralelo**: cópia da sessão onde se clicou (`--resume --fork-session`) prepara o rascunho só lendo (`paralelo.js` modo `registro`); popup do pedido (o que faz e onde grava, de `orquestrador.json` → `registro`) e popup do rascunho (markdown com rolagem: Aprovar e gravar, Ajustar, Descartar, Decidir depois); só com o Aprovar a mesma cópia grava, com `registro.permitir` (modo `registro-gravar`); rascunho pronto sobrevive a reinício (`runs/<ctx>/registro.json`). **✕ na fila** (`POST /fila-cancelar`, com a trava do `recado.js`) cancela o envio que a líder ainda não recebeu. Fala amarela com o rótulo **Resumo**. `/novo-orquestrador` pergunta projeto, trabalho, skills, fluxo, tema (com prévia), modo (aprendizado, misto ou direto, explicando as rodadas iniciais) e o destino do registro; `instanciar.js` aceita `modo` e `registro`; `registro.js` e `markdown.js` no manifesto | CA3.x, CA4.x | feito (v0.5.7) |
| T49 | Skill **`/tarefas`** no núcleo: tarefas por frente (A fazer, Fazendo, Aguardando, Feito; O que foi feito com uma linha por dia, decisões com o porquê, subtarefas, sessões do Claude) e a daily (Para ler, Ontem, Hoje, Pontos), no destino de `time/tarefas.json` (arquivos em `anotacoes/`, Notion ou outro), com `/tarefas configurar` e o modo registro (sem perguntas: o rascunho é a pergunta). O 📝 Registrar do molde vem ligado a ela (`orquestrador.json` → `registro`); `instanciar.js` aceita `tarefas` e ajusta `registro.permitir` à pasta; `/novo-orquestrador` pergunta onde salvar; `anotacoes/` fora do git | CA3.x | feito (v0.5.8) |
| T50 | `/tarefas`: **página opcional no claude.ai** (artefato privado: daily com o Para ler no topo, quadro por status, linha do tempo das decisões), perguntada uma vez (`artefato.perguntado`) e atualizada no mesmo endereço pelo `/tarefas` do terminal; as sessões `claude -p` (Office, Registrar) não têm a ferramenta de artefatos e não publicam; `/novo-orquestrador` pergunta e `instanciar.js` grava `artefato.ativo` | CA3.x | feito (v0.5.9) |
| T51 | Tema com mais personalidade, sem código: bonecos `odinCeo`, `heimdallRecepcao` e o mensageiro `drone`; `tema.andares` (nomes dos andares); `paleta.rotulo`, `paleta.luz` e `paleta.andares`; `tema.cenario` com piso de mármore, sol poente, trono executivo, Gungnir caneta, porta de carvalho, parede de vidro, recepção com CFTV e copa gasta. O padrão de cada um fica como antes (nórdico e neutro sem mudança) | CA6.x | feito (v0.5.10) |
| T52 | **⛔ Bloqueado** (status `BLOQUEADO`, evento `contexto.bloqueio`, `POST /bloquear` e `/desbloquear`, CLI `estado.js bloquear`): pendência de fora (decisão, acesso, credencial, outra área, outra coisa; com "de quem"). Sai da baia para a sala de bloqueados do escritório, não é pendência nem ocupa vaga, fica separado na caixa de atenção, selo e Resumo vermelhos, clique explica; persiste entre reinícios; escrever na conversa ou Desbloquear retoma com a pendência no prompt; a líder bloqueia quando o usuário pede ("vou ver e volto, fica bloqueado") | CA3.x, CA4.x | feito (v0.5.11) |
| T53 | **Windows sem WSL**: `taskkill /T /F` no lugar do `ps` (Parar, Corrigir, ➤, cópias), Pausar indisponível com explicação (`servidor.pausar`), `claude.exe` ou o `cli.js` do `claude.cmd`, `os.homedir()` no lugar do `HOME`, `guarda.js` cobre o PowerShell e os caminhos `/c/...` do Git Bash, autoteste do `paralelo.js` com caminhos normalizados, app da bandeja sobe o `node.exe` direto (`app.executar`), gaveta do organizador fecha ao abrir a conversa | CA5.x | feito (v0.5.12) |

## Como verificar

- `node .claude/office/estado.js autoteste`
- `node .claude/office/prontidao.js --autoteste`
- `node .claude/hooks/guarda.js --autoteste`
- `node .claude/hooks/paralelo.js --autoteste` (conversa paralela e as duas fases do registro)
- `node .claude/office/server.js --simular`; depois `curl` nas rotas e captura de tela do navegador
