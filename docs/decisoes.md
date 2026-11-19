# Decisões de projeto

Registro das escolhas do Yggdrasil: o que foi decidido, por quê e o que ficou de fora. A ordem é cronológica. Quando uma decisão substitui outra, a antiga fica marcada.

| # | Data | Decisão | Por quê | Ficou de fora |
|---|---|---|---|---|
| D1 | 2026-11-19 | **Molde genérico + uma instância por time.** O núcleo vive neste repositório; a camada `time/` vive em cada instância | Reaproveitar o mesmo orquestrador em times diferentes sem misturar contexto de negócio | Um orquestrador único configurável por time |
| D2 | 2026-11-19 | **Núcleo é substituído por inteiro na atualização** (`nucleo-manifesto.json`), e `time/` nunca é tocado | Sincronização que "só adiciona" deixa instâncias antigas para sempre desatualizadas | Merge linha a linha dos arquivos do núcleo |
| D3 | 2026-11-19 | **Ciclo SDD por repositório**, com readiness por script (`prontidao.js`) | Nada muda em `repos/` sem spec, plano e tarefas; checagem mecânica não precisa de LLM nem gastar token | Agente LLM de readiness |
| D4 | 2026-11-19 | **Modo aprendizado com checkpoints manuais**; promoção para `auto` só com o ok do usuário (`/autonomia` sugere) | Entender o processo de um time novo antes de automatizar | Promoção automática por contagem |
| D5 | 2026-11-19 | **Auto mode do Claude Code + `guarda.js`** em vez de `--dangerously-skip-permissions` | Bloqueio real (deny) de push, MR, merge e afins, nas sessões do Office e do terminal | Regras só escritas no CLAUDE.md |
| D6 | 2026-11-19 | **Telemetria por eventos** (`eventos.jsonl`) e estado como projeção | O modelo editando JSON esquece passos e corrompe arquivo; eventos são auditáveis | `state.json` editado pelo orquestrador |
| D7 | 2026-11-19 | **Office sem dependências** (Node puro, página sem CDN, sprites em código) | Funciona offline, atrás de proxy, em qualquer time | React/Vite, Tailwind, Mermaid/Vis via CDN |
| D8 | 2026-11-19 | **Escritório estilo Gather com animação por atividade (Pixel Agents)**; heróis originais e elenco nórdico (domínio público) | Ver de relance quem trabalha, em quê, e quem espera você | Personagens de franquias |
| D9 | 2026-11-19 | **Contexto = uma sessão do Claude por repo e fluxo**; pergunta registrada e turno encerrado; resposta retoma com `--resume` | Esperar não custa nada; vários contextos em paralelo, um por baia | Processo vivo por contexto (stdin) |
| D10 | 2026-11-19 | **Subagentes rastreados por `SubagentStart/Stop`** (o `Agent` roda em background) | O `PostToolUse` do `Agent` chega no lançamento, não no fim | Fim do worker pelo `PostToolUse` |
| D11 | 2026-11-19 | **Custo = acumulado da sessão** reportado pelo Claude Code | O `total_cost_usd` do `claude -p` já é cumulativo; somar por turno contava em dobro | Soma por turno |
| D12 | 2026-11-19 | **Servidor em memória**, disco em background, escuta em `127.0.0.1` e `::1` | No WSL, `/mnt/c` custa 50–130 ms por operação e o `localhost` do Windows tenta IPv6 primeiro | Ler e gravar disco a cada requisição |
| D13 | 2026-11-19 | **Resposta otimista** (o cartão some na hora) + **resposta enfileirada** se o turno ainda está fechando | Aprovar e rejeitar precisam parecer instantâneos | Esperar a confirmação do servidor |
| D14 | 2026-11-19 | **Terminal lê os transcripts do Claude Code** (`~/.claude/projects/…`, subagentes aninhados pelo `toolUseId`) via SSE, com polling como plano B | Uma fonte só para sessões do Office, do terminal e para quem vai e volta com `--resume` | Terminal real embutido (xterm.js + PTY) |
| D15 | 2026-11-19 | **Conversa resumida para decidir + Terminal para detalhes**, e **alternativa digitada** no cartão de decisão | Aprovar rápido sem perder acesso ao output completo | Só terminal, ou só chat |
| D16 | 2026-11-19 | **Baias dinâmicas**: crescem com os agentes do contexto; subagente que lança subagentes forma um grupo isolado por divisória | Organizar visualmente quem trabalha com quem | Baia fixa de 3 lugares |
| D17 | 2026-11-19 | **Organizador de fluxos só mostra** (faixa por projeto: etapa atual, o que vem a seguir, ramos paralelos). Substitui o "Mapa Atlas" radial | O andamento lê melhor da esquerda para a direita; a edição continua nos arquivos JSON | Editor de fluxo na página; ramos condicionais (adiados até um time precisar) |
| D18 | 2026-11-19 | **Mapa de aprendizado no poço de Mimir**: mindmap de lições por skill e diário por repo, com maturidade por skill | O que já se aprendeu é uma pergunta diferente de "como o trabalho anda" | Misturar aprendizado e andamento no mesmo mapa |
| D19 | 2026-11-19 | **Biblioteca de skills nas estantes**: liga/desliga movendo a pasta para `.claude/skills-desativadas/`; `iniciar-fluxo` é essencial | Simples, reversível e respeitado pelo Claude Code, sem mexer em settings | Deny de `Skill(...)` no `settings.json` |
| D20 | 2026-11-19 | **Limites de uso via ponte da statusline** (`statusline-ponte.js` grava `~/.claude/orq-limites.json` e repassa para a statusline do usuário) | A Claude Code só entrega `rate_limits` ao comando da statusline; a ponte não muda a linha do terminal | Chamar APIs de uso com o token do usuário |
