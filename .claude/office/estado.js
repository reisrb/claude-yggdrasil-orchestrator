#!/usr/bin/env node
'use strict';
/*
 * estado.js — lib + CLI do estado do orquestrador.
 *
 * Regra de ouro: toda mudança é um evento (uma linha em eventos.jsonl, só append).
 * O state.json é a projeção desses eventos e só é gravado por `projetar`
 * (servidor ou CLI), com tmp + rename. Ninguém edita o state.json na mão.
 *
 * Uso pela CLI (o orquestrador chama isso nas transições):
 *   node .claude/office/estado.js contexto criar --repo R --fluxo F [--origem terminal]
 *   node .claude/office/estado.js contexto renomear --contexto ID --titulo "serviço"   (aparece ao lado da chave)
 *   node .claude/office/estado.js passo --repo R --passo P --status ACTIVE|DONE|BLOCKED|ERROR [--resumo T]
 *   node .claude/office/estado.js pergunta --repo R --tipo checkpoint|duvida|escolha --texto T [--explicacao E] [--opcoes "a|b"]
 *   node .claude/office/estado.js resposta --repo R --texto T            (no terminal: registra o que o usuário respondeu)
 *   node .claude/office/estado.js worker --repo R --resumo T              (resumo do que o worker está fazendo)
 *   node .claude/office/estado.js contexto concluir --repo R [--resumo T]
 *   node .claude/office/estado.js registro --contexto ID --resumo T      (fim de um registro do botão Registrar)
 *   node .claude/office/estado.js recado --contexto ID --texto T         (conversa paralela: decisão para a líder, que recebe no próximo passo)
 *   node .claude/office/estado.js bloquear --contexto ID --motivo decisao|acesso|credencial|area|outro --texto T [--quem Q]
 *        (bloqueado por pendência externa: decisão, acesso, credencial, outra área; vai para a sala de bloqueados)
 *   node .claude/office/estado.js status | placar | projetar | autoteste | liberar-guarda [minutos]
 *   node .claude/office/estado.js skill ativar|desativar <nome> | skill lista
 *   (pergunta aceita --chave spec|plano|passo:<id>, usada pelo placar de autonomia)
 */
const fs = require('fs');
const path = require('path');

const OFFICE = __dirname;
const RAIZ = process.env.ORQ_RAIZ ? path.resolve(process.env.ORQ_RAIZ) : path.resolve(OFFICE, '..', '..');

const TERMINAIS = new Set(['PARADO', 'CONCLUIDO']);
const STATUS_CONTEXTO = ['TRABALHANDO', 'PRECISA_DE_VOCE', 'PAUSADO', 'PAUSADO_LIMITE', 'PARADO', 'CONCLUIDO', 'ERRO', 'BLOQUEADO']; // PAUSADO: congelado pelo usuário (agentes dormindo); BLOQUEADO: aguardando pendência externa (área de bloqueados, sem baia)
const MOTIVOS_BLOQUEIO = ['decisao', 'acesso', 'credencial', 'area', 'outro']; // area: depende de outra área ou time
const STATUS_PASSO = ['PENDING', 'ACTIVE', 'DONE', 'BLOCKED', 'WAITING_APPROVAL', 'ERROR'];
const TIPOS_PERGUNTA = ['checkpoint', 'duvida', 'escolha', 'chat']; // chat: a vez do usuário num chat livre (não é decisão)
const LIMITE_TEXTO = 4000;

/* ----------------------------------------------------------------- utilidades */

function agora() { return new Date().toISOString(); }

function cortar(t, n = LIMITE_TEXTO) {
  if (t == null) return t;
  const s = String(t);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function lerJson(arquivo, padrao) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return padrao; }
}

function gravarAtomico(arquivo, conteudo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, conteudo);
  fs.renameSync(tmp, arquivo);
}

function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
}

function carimbo(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* ------------------------------------------------------- config e catálogo */

function carregarConfig(raiz = RAIZ) {
  const cfg = lerJson(path.join(raiz, 'orquestrador.json'), {});
  return {
    nome: cfg.nome || 'Orquestrador',
    time: cfg.time || '',
    modo: cfg.modo === 'autonomo' ? 'autonomo' : 'aprendizado',
    maxContextos: Number.isInteger(cfg.maxContextos) && cfg.maxContextos > 0 ? cfg.maxContextos : 2,
    maxChats: Number.isInteger(cfg.maxChats) && cfg.maxChats > 0 ? cfg.maxChats : 3,
    porta: cfg.porta || 4321,
    checkpoints: cfg.checkpoints || {},
    overrides: cfg.overrides || {},
    modelos: cfg.modelos || {},
    orcamento: cfg.orcamento || {},
    gatilho: cfg.gatilho || {},
    registro: cfg.registro && typeof cfg.registro === 'object' ? cfg.registro : {}, // anotação do 📝 Registrar (veja o README)
  };
}

function carregarFluxos(raiz = RAIZ) {
  const dir = path.join(raiz, 'time', 'fluxos');
  const fluxos = {};
  let arquivos = [];
  try { arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { /* sem fluxos */ }
  for (const f of arquivos) {
    const fl = lerJson(path.join(dir, f), null);
    if (fl && fl.id && Array.isArray(fl.passos)) fluxos[fl.id] = fl;
  }
  return fluxos;
}

/**
 * Passo desativado no fluxo (`"desativado": true | "motivo" | { desde, motivo }`): decisão do usuário de não usar a
 * etapa até ele voltar atrás. Não executa (o prontidao.js recusa tarefa para ele) e o fluxo passa por cima dele.
 */
function desativadoDo(p) {
  const d = p && p.desativado;
  if (!d) return null;
  if (typeof d === 'string') return { motivo: d, desde: null };
  return { motivo: (typeof d === 'object' && d.motivo) || null, desde: (typeof d === 'object' && d.desde) || null };
}
/** Arestas do fluxo; quem dependia de um passo desativado ganha um atalho para o que vinha antes dele. */
function arestasDoFluxo(passos) {
  const edges = [];
  for (const p of passos) for (const d of p.depende || []) edges.push({ from: d, to: p.id });
  const off = new Map(passos.filter((p) => desativadoDo(p)).map((p) => [p.id, p]));
  const antes = (id, visto) => {
    if (visto.has(id)) return [];
    visto.add(id);
    return off.has(id) ? (off.get(id).depende || []).flatMap((d) => antes(d, visto)) : [id];
  };
  for (const p of passos) {
    if (off.has(p.id)) continue;
    for (const d of p.depende || []) if (off.has(d)) for (const a of antes(d, new Set())) edges.push({ from: a, to: p.id, atalho: true });
  }
  return edges;
}
function atlasDoFluxo(fluxo) {
  if (!fluxo) return { nodes: [], edges: [] };
  const nodes = fluxo.passos.map((p) => ({
    id: p.id, skill: p.skill || null, label: p.nome || p.id, status: 'PENDING', resumo: null,
    executor: p.executor || 'skill', quando: p.quando || null, papel: p.papel || null, desativado: desativadoDo(p),
  }));
  return { nodes, edges: arestasDoFluxo(fluxo.passos) };
}

/* ------------------------------------------------------- skills ativas/inativas */

const SKILLS_ESSENCIAIS = new Set(['iniciar-fluxo']);

/** Ativa ou desativa uma skill movendo a pasta entre .claude/skills/ e .claude/skills-desativadas/. */
function alternarSkill(nome, ativa, raiz = RAIZ) {
  const erro = (codigo, msg) => Object.assign(new Error(msg), { codigo });
  if (!/^[\w.-]+$/.test(String(nome || ''))) throw erro(400, 'nome de skill inválido');
  if (!ativa && SKILLS_ESSENCIAIS.has(nome)) throw erro(409, `a skill ${nome} é essencial para o orquestrador e não pode ser desativada`);
  const ativas = path.join(raiz, '.claude', 'skills');
  const inativas = path.join(raiz, '.claude', 'skills-desativadas');
  const [de, para] = ativa ? [inativas, ativas] : [ativas, inativas];
  const candidatos = [nome, `${nome}.md`];
  const achado = candidatos.find((c) => fs.existsSync(path.join(de, c)));
  if (!achado) {
    if (candidatos.some((c) => fs.existsSync(path.join(para, c)))) return { nome, ativa, mudou: false };
    throw erro(404, `skill não encontrada: ${nome}`);
  }
  fs.mkdirSync(para, { recursive: true });
  fs.renameSync(path.join(de, achado), path.join(para, achado));
  return { nome, ativa, mudou: true };
}

/* ------------------------------------------------------------------ a loja */

class Loja {
  constructor(dir) {
    this.dir = dir || process.env.ORQ_DADOS || OFFICE;
    this.arqEventos = path.join(this.dir, 'eventos.jsonl');
    this.arqEstado = path.join(this.dir, 'state.json');
    this.dirRuns = path.join(this.dir, 'runs');
  }

  registrar(ev) {
    const limpo = { ts: agora() };
    for (const [k, v] of Object.entries(ev)) {
      if (v === undefined) continue;
      limpo[k] = typeof v === 'string' ? cortar(v) : v;
    }
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.arqEventos, JSON.stringify(limpo) + '\n');
    return limpo;
  }

  lerEventos() {
    let bruto = '';
    try { bruto = fs.readFileSync(this.arqEventos, 'utf8'); } catch { return []; }
    const evs = [];
    for (const linha of bruto.split('\n')) {
      if (!linha.trim()) continue;
      try { evs.push(JSON.parse(linha)); } catch { /* linha corrompida: ignora, não derruba o estado */ }
    }
    return evs;
  }

  assinatura() {
    try { const s = fs.statSync(this.arqEventos); return `${s.size}:${s.mtimeMs}`; } catch { return 'vazio'; }
  }

  projetar(opts = {}) {
    const estado = projetar(this.lerEventos(), opts);
    gravarAtomico(this.arqEstado, JSON.stringify(estado, null, 2));
    return estado;
  }

  /* conversa de um contexto: runs/<id>/conversa.jsonl */
  anotarConversa(contextoId, msg) {
    const arq = path.join(this.dirRuns, slug(contextoId), 'conversa.jsonl');
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    fs.appendFileSync(arq, JSON.stringify({ ts: agora(), ...msg, texto: cortar(msg.texto, 20000) }) + '\n');
  }

  lerConversa(contextoId) {
    const arq = path.join(this.dirRuns, slug(contextoId), 'conversa.jsonl');
    let bruto = '';
    try { bruto = fs.readFileSync(arq, 'utf8'); } catch { return []; }
    return bruto.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }

  arquivoRun(contextoId, nome) { return path.join(this.dirRuns, slug(contextoId), nome); }
}

/* --------------------------------------------------------------- projeção */

/** Id do fluxo virtual do chat livre (conversa sem fluxo nem repositório). */
const FLUXO_CHAT = 'chat';

function novoContexto(ev, fluxos) {
  const fluxo = fluxos[ev.fluxoId];
  return {
    id: ev.contexto,
    repo: ev.repo,
    fluxoId: ev.fluxoId,
    fluxoNome: ev.fluxoNome || (fluxo && fluxo.nome) || ev.fluxoId,
    sessionId: ev.sessionId || null,
    origem: ['office', 'terminal', 'simulacao'].includes(ev.origem) ? ev.origem : 'terminal',
    status: 'TRABALHANDO',
    motivo: null,
    criadoEm: ev.ts,
    atualizadoEm: ev.ts,
    baia: null,
    bloqueio: null, // bloqueado por pendência externa: { motivo, texto, desde, por, pergunta }
    pergunta: null,
    agents: [],
    atlas: atlasDoFluxo(fluxo),
    passoAtual: null,
    heroi: (fluxo && fluxo.passos[0] && fluxo.passos[0].skill) || 'heroi',
    noTerminal: false,
    aguardandoTerminal: false,
    decisoes: [],
    ultimaMensagem: null,
    metricas: { custoUsd: 0, duracaoMs: 0, turnos: 0 },
    interrompidos: [], // agentes que estavam rodando na última parada (sem relatório)
    ultimoRegistro: null, // último registro feito pelo botão Registrar { ts, seq, resumo }
    titulo: null,
    _dispensado: false,
    _fluxo: fluxo || null,
    _bloqueios: [], // faixas [início, fim] em que o contexto ficou bloqueado (a previsão desconta)
    _bloqIni: null,
  };
}

function textoDoEvento(ev) {
  switch (ev.tipo) {
    case 'contexto.criar': return `contexto criado: ${ev.repo} (${ev.fluxoId})`;
    case 'contexto.status': return `status → ${ev.status}${ev.motivo ? `: ${ev.motivo}` : ''}`;
    case 'passo': return `passo ${ev.passo} → ${ev.status}${ev.resumo ? `: ${ev.resumo}` : ''}`;
    case 'pergunta.abrir': return `pergunta (${ev.tipo_pergunta || ev.tipoPergunta || 'duvida'}): ${ev.texto}`;
    case 'pergunta.responder': return `resposta: ${ev.texto}`;
    case 'mensagem.usuario': return `você: ${ev.texto}`;
    case 'contexto.renomear': return `renomeado: ${ev.titulo}`;
    case 'registro.pedido': return 'registro pedido pelo Office';
    case 'registro.feito': return `registro feito: ${ev.resumo || ''}`;
    case 'recado': return `decisão da conversa paralela para a líder: ${ev.texto}`;
    case 'contexto.bloqueio': return `bloqueado (${ev.motivo || 'outro'}${ev.quem ? `, de ${ev.quem}` : ''}): ${ev.texto || ''}`;
    case 'worker.inicio': return `worker ${ev.skill || '?'} começou${ev.descricao ? `: ${ev.descricao}` : ''}`;
    case 'worker.resumo': return `worker: ${ev.resumo}`;
    case 'worker.fim': return `worker ${ev.status === 'ERROR' ? 'falhou' : 'terminou'}${ev.resumo ? `: ${ev.resumo}` : ''}`;
    case 'guarda.bloqueio': return `guarda bloqueou: ${ev.alvo}`;
    case 'guarda.liberada': return `guarda liberada até ${ev.ate}`;
    case 'mensagem': return ev.texto;
    case 'metricas': return `turno em ${Math.round((ev.duracaoMs || 0) / 1000)}s · sessão US$ ${Number(ev.custoSessaoUsd != null ? ev.custoSessaoUsd : ev.custoUsd || 0).toFixed(3)}`;
    case 'retro': return `retro${ev.skill ? ` de ${ev.skill}` : ''}`;
    case 'skill.alternada': return `skill ${ev.skill} ${ev.ativa ? 'ativada' : 'desativada'}`;
    case 'sessao.vincular': case 'sessao.ativa': case 'sessao.ociosa': case 'worker.agente': case 'contexto.sessao': return null; // ruído interno
    default: return ev.tipo;
  }
}

function projetar(eventos, { fluxos = {}, config = {} } = {}) {
  const ctxs = new Map();
  const sessoes = new Map();
  const bloqueios = [];
  let liberadaAte = null;
  const recentes = [];

  const ativos = () => [...ctxs.values()].filter((c) => !c._dispensado && !TERMINAIS.has(c.status));
  const ocupaBaia = () => new Set(ativos().map((c) => c.baia).filter((b) => b != null));

  const resolver = (ev) => {
    if (ev.contexto && ctxs.has(ev.contexto)) return ctxs.get(ev.contexto);
    if (ev.sessao && sessoes.has(ev.sessao)) return ctxs.get(sessoes.get(ev.sessao)) || null;
    if (ev.repo) return ativos().find((c) => c.repo === ev.repo) || null;
    return null;
  };

  const marcarNo = (c, passoId, status, resumo, ts) => {
    if (!passoId) return;
    let no = c.atlas.nodes.find((n) => n.id === passoId);
    if (!no) {
      no = { id: passoId, skill: null, label: passoId, status: 'PENDING', resumo: null };
      const anterior = c.atlas.nodes[c.atlas.nodes.length - 1];
      c.atlas.nodes.push(no);
      if (anterior && !c._fluxo) c.atlas.edges.push({ from: anterior.id, to: passoId });
    }
    if (status) no.status = status;
    if (resumo != null) no.resumo = cortar(resumo, 300);
    if (status && ts) cronometrar(no, status, ts);
  };
  // previsão: quando cada etapa começou e terminou (a duração desconta o tempo em que o contexto ficou bloqueado)
  const cronometrar = (no, status, ts) => {
    if (['ACTIVE', 'WAITING_APPROVAL', 'ERROR'].includes(status)) {
      if (!no.inicio || no.fim) { no.inicio = no.fim ? no.inicio || ts : ts; no.fim = null; } // reaberta: segue contando de onde começou
    } else if (status === 'DONE' && no.inicio && !no.fim) no.fim = ts;
  };
  const sobreposicao = (ini, fim, faixas) => faixas.reduce((t, [a, b]) => t + Math.max(0, Math.min(fim, b) - Math.max(ini, a)), 0);

  eventos.forEach((ev, i) => {
    ev.seq = i + 1;
    const c = ev.tipo === 'contexto.criar' ? null : resolver(ev);
    if (c) c.atualizadoEm = ev.ts;

    switch (ev.tipo) {
      case 'contexto.criar': {
        if (!ev.contexto || ctxs.has(ev.contexto)) break;
        const novo = novoContexto(ev, fluxos);
        if (ev.fluxoId === FLUXO_CHAT) novo.baia = null; // chat livre não ocupa baia no escritório
        else {
          const ocupadas = ocupaBaia();
          let b = 0; while (ocupadas.has(b)) b++;
          novo.baia = b;
        }
        ctxs.set(novo.id, novo);
        if (novo.sessionId) sessoes.set(novo.sessionId, novo.id);
        break;
      }
      case 'contexto.sessao':
        if (c && ev.sessionId) { c.sessionId = ev.sessionId; sessoes.set(ev.sessionId, c.id); }
        break;
      case 'sessao.vincular':
        if (ev.sessao && ev.contexto && ctxs.has(ev.contexto)) {
          sessoes.set(ev.sessao, ev.contexto);
          const alvo = ctxs.get(ev.contexto);
          if (!alvo.sessionId) alvo.sessionId = ev.sessao;
        }
        break;
      case 'contexto.status':
        if (!c || !STATUS_CONTEXTO.includes(ev.status)) break;
        if (c.status === 'BLOQUEADO' && ev.status !== 'BLOQUEADO' && c._bloqIni) { c._bloqueios.push([Date.parse(c._bloqIni), Date.parse(ev.ts)]); c._bloqIni = null; }
        c.status = ev.status;
        c.motivo = ev.motivo || null;
        if (ev.status !== 'PRECISA_DE_VOCE') c.pergunta = null;
        if (ev.status !== 'BLOQUEADO') c.bloqueio = null; // desbloqueado
        if (TERMINAIS.has(ev.status)) {
          c.baia = null;
          for (const a of c.agents) if (a.status === 'WORKING') { a.status = ev.status === 'CONCLUIDO' ? 'DONE' : 'ERROR'; a.fim = ev.ts; }
        }
        // concluir o contexto fecha a etapa que ficou em andamento (a líder nem sempre marca o DONE antes de concluir)
        if (ev.status === 'CONCLUIDO') for (const n of c.atlas.nodes) if (n.status === 'ACTIVE' || n.status === 'WAITING_APPROVAL') { n.status = 'DONE'; cronometrar(n, 'DONE', ev.ts); }
        if (ev.status === 'ERRO') for (const a of c.agents) if (a.status === 'WORKING') { a.status = 'ERROR'; a.fim = ev.ts; }
        // quem estava rodando quando o turno parou (o Office manda a lista à líder ao retomar, para ela relançar só esses)
        if (TERMINAIS.has(ev.status) || ev.status === 'ERRO' || ev.status === 'PAUSADO_LIMITE') c.interrompidos = Array.isArray(ev.interrompidos) ? ev.interrompidos : [];
        // retomar um contexto que foi PARADO/CONCLUIDO (baia liberada) devolve a primeira baia livre; sem baia o escritório não o desenha
        if (!TERMINAIS.has(ev.status) && c.baia == null && c.fluxoId !== FLUXO_CHAT && !c._dispensado) {
          const ocupadas = ocupaBaia();
          let b = 0; while (ocupadas.has(b)) b++;
          c.baia = b;
        }
        break;
      case 'contexto.bloqueio': {
        // bloqueado por pendência externa (decisão de alguém, acesso, outra coisa): sai da baia, não conta como "esperando você"
        if (!c || TERMINAIS.has(c.status) || c.fluxoId === FLUXO_CHAT) break;
        const anterior = c.bloqueio;
        c.bloqueio = {
          motivo: MOTIVOS_BLOQUEIO.includes(ev.motivo) ? ev.motivo : 'outro',
          texto: cortar(String(ev.texto || ''), 600),
          quem: ev.quem ? cortar(String(ev.quem), 120) : (anterior && !ev.texto ? anterior.quem : null), // a área ou pessoa de quem depende
          desde: anterior ? anterior.desde : ev.ts, // trocar o texto não zera o "desde"
          por: ev.por === 'lider' ? 'lider' : 'voce',
          pergunta: c.pergunta ? cortar(c.pergunta.texto, 600) : (anterior ? anterior.pergunta : null),
        };
        if (!c._bloqIni) c._bloqIni = ev.ts;
        c.status = 'BLOQUEADO';
        c.motivo = c.bloqueio.texto;
        c.pergunta = null;
        c.baia = null;
        if (Array.isArray(ev.interrompidos)) {
          c.interrompidos = ev.interrompidos;
          for (const a of c.agents) if (a.status === 'WORKING') { a.status = 'ERROR'; a.fim = ev.ts; }
        }
        break;
      }
      case 'contexto.terminal':
        if (c) c.noTerminal = !!ev.valor;
        break;
      case 'contexto.renomear':
        if (c) c.titulo = cortar(String(ev.titulo || '').trim(), 60) || null;
        break;
      case 'registro.feito': // fim de um registro (botão Registrar): o próximo pega só o que veio depois
        if (c) c.ultimoRegistro = { ts: ev.ts, seq: ev.seq, resumo: cortar(String(ev.resumo || ''), 200) };
        break;
      case 'contexto.dispensar':
        if (c) { c._dispensado = true; c.baia = null; }
        break;
      case 'passo': {
        if (!c || !STATUS_PASSO.includes(ev.status)) break;
        if (c._fluxo && !c.atlas.nodes.some((n) => n.id === ev.passo)) break; // fora do fluxo: não vira etapa fantasma
        marcarNo(c, ev.passo, ev.status, ev.resumo, ev.ts);
        if (ev.status === 'DONE' || ev.status === 'ERROR') {
          // rede de segurança: worker do passo que ficou sem SubagentStop
          for (const a of c.agents) if (a.passo === ev.passo && a.status === 'WORKING') { a.status = ev.status === 'DONE' ? 'DONE' : 'ERROR'; a.fim = ev.ts; }
        }
        if (ev.status === 'ACTIVE') {
          c.passoAtual = ev.passo;
          const def = c._fluxo && c._fluxo.passos.find((p) => p.id === ev.passo);
          const skill = ev.skill || (def && def.skill);
          if (skill) c.heroi = skill;
          const no = c.atlas.nodes.find((n) => n.id === ev.passo);
          if (no && skill && !no.skill) no.skill = skill;
        }
        break;
      }
      case 'pergunta.abrir': {
        if (!c) break;
        const tipo = TIPOS_PERGUNTA.includes(ev.tipoPergunta) ? ev.tipoPergunta : 'duvida';
        // bloqueado, a pergunta vira parte da pendência (não volta a "esperando você")
        if (c.status === 'BLOQUEADO' && c.bloqueio) { c.bloqueio.pergunta = cortar(ev.texto || '', 600); break; }
        c.pergunta = {
          id: ev.perguntaId || `p${ev.seq}`, tipo, texto: ev.texto || '', explicacao: ev.explicacao || null,
          opcoes: Array.isArray(ev.opcoes) ? ev.opcoes.map(String) : [], desde: ev.ts,
          chave: ev.chave || null, passo: c.passoAtual || null, // a que etapa a pergunta se refere (para mostrar quem pede)
          ...(ev.silencioso ? { silencioso: true } : {}), // sem som nem notificação (ex.: chat reaberto)
        };
        c.status = 'PRECISA_DE_VOCE';
        c.motivo = null;
        c.decisoes.push({ id: c.pergunta.id, tipo, chave: ev.chave || null, texto: c.pergunta.texto, explicacao: c.pergunta.explicacao, opcoes: c.pergunta.opcoes, passo: c.passoAtual, desde: ev.ts, resposta: null, respondidaEm: null });
        if (tipo === 'chat') c.decisoes.pop(); // resposta de chat não é decisão
        if (c.decisoes.length > 40) c.decisoes.shift();
        if (tipo === 'checkpoint') {
          // o checkpoint libera a etapa da chave (passo:<id>); sem chave, a atual. Nunca rebaixa etapa concluída.
          const alvoNo = ev.chave && String(ev.chave).startsWith('passo:') ? String(ev.chave).slice(6) : c.passoAtual;
          const no = alvoNo && c.atlas.nodes.find((n) => n.id === alvoNo);
          if (alvoNo && (no ? (no.status !== 'DONE' && no.status !== 'ERROR') : !c._fluxo)) marcarNo(c, alvoNo, 'WAITING_APPROVAL', null, ev.ts);
        }
        for (const a of c.agents) if (a.status === 'WORKING' && tipo === 'checkpoint') a.status = 'WAITING_APPROVAL';
        break;
      }
      case 'pergunta.responder': {
        if (!c) break;
        const d = [...c.decisoes].reverse().find((x) => !x.resposta);
        if (d) { d.resposta = cortar(ev.texto || '', 2000); d.respondidaEm = ev.ts; d.por = ev.por || null; }
        c.pergunta = null;
        c.aguardandoTerminal = false;
        if (c.status === 'PRECISA_DE_VOCE') c.status = 'TRABALHANDO';
        for (const n of c.atlas.nodes) if (n.status === 'WAITING_APPROVAL') n.status = n.id === c.passoAtual ? 'ACTIVE' : 'PENDING';
        for (const a of c.agents) if (a.status === 'WAITING_APPROVAL') a.status = 'WORKING';
        break;
      }
      case 'worker.inicio': {
        if (!c) break;
        if (ev.sessao && !sessoes.has(ev.sessao)) sessoes.set(ev.sessao, c.id);
        const id = ev.workerId || `w${ev.seq}`;
        if (!c.agents.some((a) => a.id === id)) {
          c.agents.push({
            id, role: ev.papel || 'worker', skill: ev.skill || 'desconhecida', alvo: ev.alvo || c.repo,
            status: 'WORKING', summary: cortar(ev.descricao || '', 300), inicio: ev.ts, fim: null,
            passo: ev.passo || null, tipoAgente: ev.subagentType || null, agentId: null,
            pai: ev.pai || ((ev.paiAgentId && (c.agents.find((x) => x.agentId === ev.paiAgentId) || {}).id) || null),
          });
        }
        if (ev.skill) c.heroi = ev.skill;
        // passo que não existe no fluxo (ex.: o verificador ou uma skill de apoio) não vira etapa fantasma no organizador
        if (ev.passo && (!c._fluxo || c.atlas.nodes.some((n) => n.id === ev.passo))) { marcarNo(c, ev.passo, 'ACTIVE', null, ev.ts); c.passoAtual = ev.passo; }
        if (c.status === 'PAUSADO_LIMITE' || c.status === 'ERRO') c.status = 'TRABALHANDO';
        break;
      }
      case 'worker.agente': {
        if (!c || !ev.agentId) break;
        if (c.agents.some((x) => x.agentId === ev.agentId)) break;
        const livre = c.agents.find((x) => x.status === 'WORKING' && !x.agentId && (!x.tipoAgente || !ev.agentType || x.tipoAgente === ev.agentType));
        if (livre) livre.agentId = ev.agentId;
        break;
      }
      case 'worker.resumo': {
        if (!c) break;
        const a = (ev.workerId && c.agents.find((x) => x.id === ev.workerId))
          || [...c.agents].reverse().find((x) => x.status === 'WORKING');
        if (a) a.summary = cortar(ev.resumo || '', 300);
        break;
      }
      case 'worker.fim': {
        if (!c) break;
        const a = (ev.workerId && c.agents.find((x) => x.id === ev.workerId))
          || (ev.agentId && c.agents.find((x) => x.agentId === ev.agentId))
          || c.agents.find((x) => x.status === 'WORKING' && (!ev.agentType || !x.tipoAgente || x.tipoAgente === ev.agentType));
        if (a) { a.status = ev.status === 'ERROR' ? 'ERROR' : 'DONE'; a.fim = ev.ts; if (ev.resumo) a.summary = cortar(ev.resumo, 300); }
        break;
      }
      case 'mensagem':
        if (c) c.ultimaMensagem = cortar(ev.texto || '', 600);
        break;
      case 'metricas':
        if (c) {
          // o result do `claude -p` traz o custo ACUMULADO da sessão: guardamos o maior visto
          // (a conversa paralela soma à parte: o acumulado da líder não inclui as cópias)
          if (ev.paralelo) { c.metricas.paraleloUsd = (c.metricas.paraleloUsd || 0) + (Number(ev.custoUsd) || 0); c.metricas.custoUsd += Number(ev.custoUsd) || 0; break; }
          if (ev.custoSessaoUsd != null) c.metricas.custoUsd = Math.max(c.metricas.custoUsd, (Number(ev.custoSessaoUsd) || 0) + (c.metricas.paraleloUsd || 0));
          else c.metricas.custoUsd += Number(ev.custoUsd) || 0;
          c.metricas.duracaoMs += Number(ev.duracaoMs) || 0;
          c.metricas.turnos += 1;
        }
        break;
      case 'sessao.ociosa':
        if (c && c.origem === 'terminal') c.aguardandoTerminal = true;
        break;
      case 'sessao.ativa':
        if (c) c.aguardandoTerminal = false;
        break;
      case 'guarda.bloqueio':
        bloqueios.push({ seq: ev.seq, ts: ev.ts, contexto: c ? c.id : null, alvo: cortar(ev.alvo || '', 200), motivo: cortar(ev.motivo || '', 300) });
        break;
      case 'guarda.liberada':
        liberadaAte = ev.ate || null;
        break;
      default: break;
    }

    const texto = textoDoEvento(ev);
    if (texto != null) {
      recentes.push({ seq: ev.seq, ts: ev.ts, tipo: ev.tipo, contexto: c ? c.id : (ev.contexto || null), texto: cortar(texto, 240) });
      if (recentes.length > 60) recentes.shift();
    }
  });

  const lista = [...ctxs.values()].filter((c) => !c._dispensado);
  const esperando = lista.filter((c) => c.status === 'PRECISA_DE_VOCE' && c.fluxoId !== FLUXO_CHAT) // chat com a vez sua não é pendência
    .sort((a, b) => String(a.pergunta && a.pergunta.desde).localeCompare(String(b.pergunta && b.pergunta.desde)));
  const ativosLista = lista.filter((c) => !TERMINAIS.has(c.status));
  const foco = esperando[0]
    || [...ativosLista].sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm))[0]
    || [...lista].sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm))[0]
    || null;

  let status = 'IDLE';
  if (esperando.length) status = 'WAITING_APPROVAL';
  else if (lista.some((c) => c.status === 'TRABALHANDO')) status = 'RUNNING';
  else if (lista.some((c) => c.status === 'ERRO')) status = 'ERROR';

  // previsão: duração de cada etapa (sem o tempo bloqueado) e a média das últimas execuções por fluxo e passo
  const amostras = new Map(); // "fluxo\u0000passo" -> [{ ms, fim }]
  for (const c of ctxs.values()) {
    const faixas = c._bloqueios || [];
    for (const n of c.atlas.nodes) {
      if (!n.inicio) continue;
      const ini = Date.parse(n.inicio);
      if (n.fim) {
        const fim = Date.parse(n.fim);
        n.duracaoMs = Math.max(0, fim - ini - sobreposicao(ini, fim, faixas));
        if (c.fluxoId !== FLUXO_CHAT && n.duracaoMs > 0) {
          const k = `${c.fluxoId}\u0000${n.id}`;
          if (!amostras.has(k)) amostras.set(k, []);
          amostras.get(k).push({ ms: n.duracaoMs, fim });
        }
      } else n.bloqueadoMs = sobreposicao(ini, Infinity, faixas); // em andamento: o navegador desconta isto do tempo decorrido
    }
  }
  const previsoes = {};
  for (const [k, lista] of amostras) {
    const [fluxoId, passoId] = k.split('\u0000');
    const ultimas = lista.sort((a, b) => a.fim - b.fim).slice(-10).map((x) => x.ms);
    (previsoes[fluxoId] = previsoes[fluxoId] || {})[passoId] = { mediaMs: Math.round(ultimas.reduce((t, x) => t + x, 0) / ultimas.length), n: ultimas.length, amostras: ultimas };
  }

  const publico = (c) => {
    const { _dispensado, _fluxo, _bloqueios, _bloqIni, ...resto } = c;
    return resto;
  };

  if (liberadaAte && Date.parse(liberadaAte) < Date.now()) liberadaAte = null;

  return {
    schemaVersion: 1,
    orquestrador: config.nome || 'Orquestrador',
    modo: config.modo || 'aprendizado',
    maxContextos: config.maxContextos || 2,
    updatedAt: eventos.length ? eventos[eventos.length - 1].ts : agora(),
    status,
    currentFlow: foco ? foco.fluxoNome : null,
    foco: foco ? foco.id : null,
    agents: foco ? foco.agents : [],
    atlas: foco ? foco.atlas : { nodes: [], edges: [] },
    pendencias: esperando.length,
    contextos: lista.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm)).map(publico),
    guarda: { liberadaAte, bloqueios: bloqueios.slice(-10) },
    previsoes,
    eventosRecentes: recentes.slice(-40),
  };
}

/* ------------------------------------------------- operações de alto nível */

function contextosAtivos(loja, opts) {
  return projetar(loja.lerEventos(), opts).contextos.filter((c) => !TERMINAIS.has(c.status));
}

/** Cria um contexto respeitando maxContextos e um contexto por repo. Lança Error com .codigo. */
function criarContexto(loja, { repo, fluxoId, origem = 'terminal', sessionId, raiz = RAIZ, id, fluxos: fluxosDados, config: configDada } = {}) {
  const config = configDada || carregarConfig(raiz);
  const fluxos = fluxosDados || carregarFluxos(raiz);
  const erro = (codigo, msg) => Object.assign(new Error(msg), { codigo });
  if (!repo) throw erro(400, 'informe --repo');
  if (!fluxoId || !fluxos[fluxoId]) throw erro(400, `fluxo desconhecido: ${fluxoId || '(vazio)'} — veja time/fluxos/`);
  const ativos = contextosAtivos(loja, { fluxos, config });
  if (ativos.some((c) => c.repo === repo)) throw erro(409, `já existe um contexto ativo para o repo ${repo}`);
  // chat livre tem limite próprio (maxChats) e não ocupa vaga de missão (maxContextos)
  const chats = ativos.filter((c) => c.fluxoId === FLUXO_CHAT).length;
  const bloqueados = ativos.filter((c) => c.status === 'BLOQUEADO').length; // bloqueado não ocupa vaga
  if (fluxoId === FLUXO_CHAT) {
    if (chats >= (config.maxChats || 3)) throw erro(409, `limite de ${config.maxChats || 3} chats abertos atingido (maxChats): encerre um antes`);
  } else if (ativos.length - chats - bloqueados >= config.maxContextos) throw erro(409, `limite de ${config.maxContextos} contextos ativos atingido (maxContextos)`);
  let novoId = id || `${carimbo()}-${slug(fluxoId)}-${slug(repo)}`;
  const existentes = new Set(loja.lerEventos().filter((e) => e.tipo === 'contexto.criar').map((e) => e.contexto));
  let n = 2; const base = novoId;
  while (existentes.has(novoId)) novoId = `${base}-${n++}`;
  loja.registrar({ tipo: 'contexto.criar', contexto: novoId, repo, fluxoId, fluxoNome: fluxos[fluxoId].nome, origem, sessionId });
  return novoId;
}

/* -------------------------------------------------- validador de schema mini */

function validarSchema(schema, valor, raizSchema = schema, caminho = '$') {
  const erros = [];
  if (schema.$ref) {
    const alvo = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o && o[k], raizSchema);
    return validarSchema(alvo, valor, raizSchema, caminho);
  }
  const tipoDe = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  if (schema.type) {
    const tipos = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = tipoDe(valor);
    const ok = tipos.some((x) => x === t || (x === 'number' && t === 'integer'));
    if (!ok) { erros.push(`${caminho}: esperado ${tipos.join('|')}, veio ${t}`); return erros; }
  }
  if (schema.enum && !schema.enum.includes(valor)) erros.push(`${caminho}: valor ${JSON.stringify(valor)} fora de ${JSON.stringify(schema.enum)}`);
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
    for (const r of schema.required || []) if (!(r in valor)) erros.push(`${caminho}: falta ${r}`);
    for (const [k, sub] of Object.entries(schema.properties || {})) if (k in valor) erros.push(...validarSchema(sub, valor[k], raizSchema, `${caminho}.${k}`));
  }
  if (Array.isArray(valor) && schema.items) valor.forEach((v, i) => erros.push(...validarSchema(schema.items, v, raizSchema, `${caminho}[${i}]`)));
  return erros;
}

/* ------------------------------------------------------------------ autoteste */

function autoteste() {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-autoteste-'));
  const loja = new Loja(dir);
  const fluxos = {
    demo: { id: 'demo', nome: 'Demo', passos: [{ id: 'a', skill: 'skill-a', depende: [] }, { id: 'b', skill: 'skill-b', depende: ['a'] }] },
  };
  const config = { nome: 'Teste', modo: 'aprendizado', maxContextos: 2 };
  const falhas = [];
  const checar = (cond, msg) => { if (!cond) falhas.push(msg); };

  loja.registrar({ tipo: 'contexto.criar', contexto: 'c1', repo: 'r1', fluxoId: 'demo', origem: 'office', sessionId: 's1' });
  loja.registrar({ tipo: 'contexto.criar', contexto: 'c2', repo: 'r2', fluxoId: 'demo', origem: 'terminal' });
  loja.registrar({ tipo: 'passo', contexto: 'c1', passo: 'a', status: 'ACTIVE' });
  loja.registrar({ tipo: 'worker.inicio', sessao: 's1', workerId: 'w1', papel: 'Batedor', skill: 'skill-a', passo: 'a', descricao: 'lendo' });
  loja.registrar({ tipo: 'worker.resumo', contexto: 'c1', resumo: 'achei pom.xml' });
  loja.registrar({ tipo: 'worker.fim', sessao: 's1', workerId: 'w1', status: 'DONE', resumo: 'ok' });
  loja.registrar({ tipo: 'passo', contexto: 'c1', passo: 'a', status: 'DONE' });
  loja.registrar({ tipo: 'passo', contexto: 'c1', passo: 'b', status: 'ACTIVE' });
  loja.registrar({ tipo: 'pergunta.abrir', contexto: 'c1', tipoPergunta: 'checkpoint', texto: 'Posso seguir?', opcoes: ['Aprovar', 'Rejeitar'] });
  loja.registrar({ tipo: 'guarda.bloqueio', repo: 'r2', alvo: 'git push origin main', motivo: 'push é manual' });
  // worker assíncrono: inicio (PreToolUse) → agente (SubagentStart) → fim (SubagentStop por agentId)
  loja.registrar({ tipo: 'worker.inicio', contexto: 'c2', workerId: 'w9', skill: 'skill-a', passo: 'a', subagentType: 'skill-worker' });
  loja.registrar({ tipo: 'worker.agente', contexto: 'c2', agentId: 'ag9', agentType: 'skill-worker' });
  loja.registrar({ tipo: 'metricas', contexto: 'c2', custoSessaoUsd: 0.15, duracaoMs: 1000 });
  loja.registrar({ tipo: 'metricas', contexto: 'c2', custoSessaoUsd: 0.49, duracaoMs: 1000 });
  let a9 = projetar(loja.lerEventos(), { fluxos, config }).contextos.find((c) => c.id === 'c2').agents.find((x) => x.id === 'w9');
  checar(a9 && a9.status === 'WORKING' && a9.agentId === 'ag9', 'SubagentStart deveria ligar agentId ao worker e mantê-lo WORKING');
  loja.registrar({ tipo: 'worker.fim', contexto: 'c2', agentId: 'ag9', status: 'DONE', resumo: 'pronto' });
  const c2p = projetar(loja.lerEventos(), { fluxos, config }).contextos.find((c) => c.id === 'c2');
  a9 = c2p.agents.find((x) => x.id === 'w9');
  checar(a9.status === 'DONE' && a9.summary === 'pronto', 'SubagentStop deveria encerrar o worker pelo agentId');
  checar(Math.abs(c2p.metricas.custoUsd - 0.49) < 1e-9, 'custo deveria ser o acumulado da sessão (0.49), não a soma');
  loja.registrar({ tipo: 'worker.inicio', contexto: 'c2', workerId: 'w10', skill: 'skill-a', subagentType: 'skill-worker' });
  loja.registrar({ tipo: 'worker.agente', contexto: 'c2', agentId: 'ag10', agentType: 'skill-worker' });
  loja.registrar({ tipo: 'worker.inicio', contexto: 'c2', workerId: 'w11', skill: 'skill-b', paiAgentId: 'ag10' });
  const w11 = projetar(loja.lerEventos(), { fluxos, config }).contextos.find((c) => c.id === 'c2').agents.find((x) => x.id === 'w11');
  checar(w11 && w11.pai === 'w10', 'subagente lançado por subagente deveria apontar o pai (w10)');

  let e = projetar(loja.lerEventos(), { fluxos, config });
  const c1 = e.contextos.find((c) => c.id === 'c1');
  checar(c1.status === 'PRECISA_DE_VOCE', 'CA2.3: pergunta deveria deixar c1 em PRECISA_DE_VOCE');
  checar(c1.atlas.nodes.find((n) => n.id === 'b').status === 'WAITING_APPROVAL', 'checkpoint deveria marcar o nó b como WAITING_APPROVAL');
  checar(c1.atlas.nodes.find((n) => n.id === 'a').status === 'DONE', 'checkpoint não pode rebaixar etapa concluída (a)');
  checar(c1.agents[0].status === 'DONE' && c1.agents[0].summary === 'ok', 'worker w1 deveria estar DONE com resumo');
  checar(c1.heroi === 'skill-b', 'herói deveria ser o do passo atual (skill-b)');
  checar(e.pendencias === 1 && e.status === 'WAITING_APPROVAL' && e.foco === 'c1', 'topo deveria apontar a pendência de c1');
  checar(e.contextos.find((c) => c.id === 'c2').baia === 1 && c1.baia === 0, 'CA2.4: baias deveriam ser 0 e 1');
  checar(e.guarda.bloqueios.length === 1 && e.guarda.bloqueios[0].contexto === 'c2', 'bloqueio da guarda deveria resolver o contexto pelo repo');
  ['currentFlow', 'status', 'updatedAt', 'agents', 'atlas'].forEach((k) => checar(k in e, `CA1.3: falta ${k} no topo`));

  // limite e repo ocupado (CA2.1, CA2.2)
  const raizFalsa = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-raiz-'));
  fs.mkdirSync(path.join(raizFalsa, 'time', 'fluxos'), { recursive: true });
  fs.writeFileSync(path.join(raizFalsa, 'orquestrador.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(raizFalsa, 'time', 'fluxos', 'demo.json'), JSON.stringify(fluxos.demo));
  let codigo = null;
  try { criarContexto(loja, { repo: 'r1', fluxoId: 'demo', raiz: raizFalsa }); } catch (err) { codigo = err.codigo; }
  checar(codigo === 409, 'CA2.1: repo ocupado deveria dar 409');
  codigo = null;
  try { criarContexto(loja, { repo: 'r3', fluxoId: 'demo', raiz: raizFalsa }); } catch (err) { codigo = err.codigo; }
  checar(codigo === 409, 'CA2.2: estourar maxContextos deveria dar 409');

  // resposta, conclusão e liberação de baia
  loja.registrar({ tipo: 'pergunta.responder', contexto: 'c1', texto: 'Aprovar', por: 'office' });
  loja.registrar({ tipo: 'contexto.status', contexto: 'c2', status: 'CONCLUIDO' });
  const id3 = criarContexto(loja, { repo: 'r3', fluxoId: 'demo', raiz: raizFalsa, origem: 'office' });
  e = projetar(loja.lerEventos(), { fluxos, config });
  checar(e.contextos.find((c) => c.id === 'c1').status === 'TRABALHANDO', 'CA2.3: resposta deveria voltar para TRABALHANDO');
  checar(e.contextos.find((c) => c.id === id3).baia === 1, 'CA2.4: novo contexto deveria reaproveitar a baia livre (1)');
  checar(e.contextos.find((c) => c.id === 'c2').baia === null, 'contexto concluído deveria liberar a baia');
  // retomar um contexto parado devolve uma baia (sem ela o escritório não desenha líder nem agentes)
  loja.registrar({ tipo: 'contexto.status', contexto: 'c1', status: 'PARADO' });
  e = projetar(loja.lerEventos(), { fluxos, config });
  checar(e.contextos.find((c) => c.id === 'c1').baia === null, 'contexto parado deveria liberar a baia');
  loja.registrar({ tipo: 'contexto.status', contexto: 'c1', status: 'TRABALHANDO' });
  e = projetar(loja.lerEventos(), { fluxos, config });
  checar(e.contextos.find((c) => c.id === 'c1').baia === 0, 'retomar contexto parado deveria devolver a primeira baia livre (0)');
  checar(e.contextos.find((c) => c.id === id3).baia === 1, 'retomar não deve mexer na baia dos outros contextos');
  // parada guarda quem estava rodando (para a líder relançar só esses ao retomar); PAUSADO não mexe nos agentes
  loja.registrar({ tipo: 'worker.inicio', contexto: id3, workerId: 'wp', papel: 'worker', skill: 'skill-x', descricao: 'fazendo X' });
  loja.registrar({ tipo: 'contexto.status', contexto: id3, status: 'PAUSADO', motivo: 'pausado por você' });
  e = projetar(loja.lerEventos(), { fluxos, config });
  checar(e.contextos.find((c) => c.id === id3).agents.find((a) => a.id === 'wp').status === 'WORKING' && e.contextos.find((c) => c.id === id3).baia != null, 'pausar deveria manter os agentes (dormindo) e a baia');
  loja.registrar({ tipo: 'contexto.status', contexto: id3, status: 'PARADO', interrompidos: [{ skill: 'skill-x', descricao: 'fazendo X', passo: null }] });
  e = projetar(loja.lerEventos(), { fluxos, config });
  checar((e.contextos.find((c) => c.id === id3).interrompidos || []).length === 1, 'parar deveria guardar os agentes interrompidos');
  loja.registrar({ tipo: 'contexto.status', contexto: id3, status: 'TRABALHANDO' });
  // registro (botão Registrar): o fim fica no contexto para o próximo registro começar dali
  loja.registrar({ tipo: 'registro.feito', contexto: id3, resumo: 'congelamento registrado no /tasks' });
  e = projetar(loja.lerEventos(), { fluxos, config });
  checar(((e.contextos.find((c) => c.id === id3).ultimoRegistro) || {}).resumo === 'congelamento registrado no /tasks', 'registro feito deveria ficar como último registro do contexto');
  // etapas: passo fora do fluxo não cria etapa fantasma; concluir fecha a etapa que ficou em andamento
  const primeiro = e.contextos.find((c) => c.id === id3).atlas.nodes[0].id;
  loja.registrar({ tipo: 'passo', contexto: id3, passo: primeiro, status: 'ACTIVE' });
  loja.registrar({ tipo: 'worker.inicio', contexto: id3, workerId: 'wf', papel: 'verificador', skill: 'verificador', passo: 'fantasma' });
  e = projetar(loja.lerEventos(), { fluxos, config });
  let c3 = e.contextos.find((c) => c.id === id3);
  checar(!c3.atlas.nodes.some((n) => n.id === 'fantasma') && c3.passoAtual === primeiro, 'passo fora do fluxo não deveria virar etapa nem mudar a etapa atual');
  loja.registrar({ tipo: 'passo', contexto: id3, passo: 'fantasma2', status: 'ACTIVE' });
  loja.registrar({ tipo: 'pergunta.abrir', contexto: id3, tipoPergunta: 'checkpoint', chave: 'passo:fantasma3', texto: 'segue?', opcoes: ['Aprovar'] });
  loja.registrar({ tipo: 'pergunta.responder', contexto: id3, texto: 'Aprovar', por: 'office' });
  e = projetar(loja.lerEventos(), { fluxos, config });
  c3 = e.contextos.find((c) => c.id === id3);
  checar(!c3.atlas.nodes.some((n) => /^fantasma/.test(n.id)), 'passo e checkpoint fora do fluxo não deveriam criar etapa');
  loja.registrar({ tipo: 'contexto.status', contexto: id3, status: 'CONCLUIDO' });
  e = projetar(loja.lerEventos(), { fluxos, config });
  c3 = e.contextos.find((c) => c.id === id3);
  checar(c3.atlas.nodes.find((n) => n.id === primeiro).status === 'DONE', 'concluir o contexto deveria fechar (DONE) a etapa em andamento');
  loja.registrar({ tipo: 'contexto.status', contexto: id3, status: 'TRABALHANDO' }); // reativado: a etapa fechada continua DONE
  e = projetar(loja.lerEventos(), { fluxos, config });
  checar(e.contextos.find((c) => c.id === id3).atlas.nodes.find((n) => n.id === primeiro).status === 'DONE', 'reativar não deveria reabrir etapa já fechada');

  // bloqueado: pendência externa sai da baia, não é "esperando você", não ocupa vaga e volta com baia
  loja.registrar({ tipo: 'contexto.criar', contexto: 'ce', repo: 're', fluxoId: 'demo', origem: 'office', sessionId: 'se' });
  loja.registrar({ tipo: 'pergunta.abrir', contexto: 'ce', tipoPergunta: 'duvida', texto: 'Quando tiver o acesso, diga pronto.' });
  loja.registrar({ tipo: 'contexto.bloqueio', contexto: 'ce', motivo: 'acesso', texto: 'acesso ao banco de homologação', por: 'voce' });
  e = projetar(loja.lerEventos(), { fluxos, config });
  let ce = e.contextos.find((c) => c.id === 'ce');
  checar(ce.status === 'BLOQUEADO' && ce.baia === null && ce.pergunta === null, 'bloqueio: status BLOQUEADO, sem baia e sem pergunta aberta');
  checar(ce.bloqueio && ce.bloqueio.motivo === 'acesso' && /banco/.test(ce.bloqueio.texto) && /acesso/.test(ce.bloqueio.pergunta || ''), 'bloqueio: guarda motivo, texto e a pergunta que estava aberta');
  checar(!e.contextos.some((c) => c.id === 'ce' && c.status === 'PRECISA_DE_VOCE'), 'bloqueio: não conta como esperando você');
  loja.registrar({ tipo: 'pergunta.abrir', contexto: 'ce', tipoPergunta: 'duvida', texto: 'nova pergunta no bloqueio' });
  ce = projetar(loja.lerEventos(), { fluxos, config }).contextos.find((c) => c.id === 'ce');
  checar(ce.status === 'BLOQUEADO' && ce.bloqueio.pergunta === 'nova pergunta no bloqueio', 'bloqueio: pergunta nova entra na pendência, sem desbloquear');
  loja.registrar({ tipo: 'contexto.status', contexto: 'ce', status: 'TRABALHANDO', motivo: 'desbloqueado' });
  ce = projetar(loja.lerEventos(), { fluxos, config }).contextos.find((c) => c.id === 'ce');
  checar(ce.status === 'TRABALHANDO' && ce.bloqueio === null && ce.baia != null, 'desbloqueado: volta a trabalhar com baia e sem pendência');
  loja.registrar({ tipo: 'contexto.bloqueio', contexto: 'ce', motivo: 'decisao', texto: 'decisão do gestor', por: 'lider' });
  loja.registrar({ tipo: 'contexto.status', contexto: 'ce', status: 'PARADO', motivo: 'limpeza do teste' });

  // concorrência (CA1.2): 200 escritas intercaladas continuam linhas válidas
  for (let i = 0; i < 200; i++) loja.registrar({ tipo: 'mensagem', contexto: i % 2 ? 'c1' : id3, texto: 'x'.repeat(i * 7) });
  const bruto = fs.readFileSync(loja.arqEventos, 'utf8').split('\n').filter(Boolean);
  checar(bruto.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), 'CA1.2: todas as linhas deveriam ser JSON válido');

  // CA1.1: schema
  const schema = lerJson(path.join(OFFICE, 'state.schema.json'), null);
  e = loja.projetar({ fluxos, config });
  const errosSchema = schema ? validarSchema(schema, e) : ['state.schema.json não encontrado'];
  errosSchema.forEach((x) => falhas.push(`CA1.1 schema: ${x}`));

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(raizFalsa, { recursive: true, force: true });
  if (falhas.length) {
    console.error(`autoteste FALHOU (${falhas.length}):\n- ${falhas.join('\n- ')}`);
    return 1;
  }
  console.log('autoteste OK: eventos, contextos, perguntas, baias, guarda, limites, concorrência e schema');
  return 0;
}

/* ------------------------------------------------------- placar de autonomia */

/**
 * Para cada chave de checkpoint (spec, plano, passo:<id>), conta respostas e a sequência
 * atual de aprovações sem ajuste (resposta exatamente "Aprovar"/"ok"/"sim").
 */
function placar(eventos) {
  const abertas = new Map();
  const out = {};
  for (const ev of eventos) {
    if (ev.tipo === 'pergunta.abrir' && ev.tipoPergunta === 'checkpoint') abertas.set(ev.contexto, ev.chave || 'sem-chave');
    if (ev.tipo === 'pergunta.responder' && abertas.has(ev.contexto)) {
      const chave = abertas.get(ev.contexto);
      abertas.delete(ev.contexto);
      const limpo = /^\s*(aprovar|aprovado|ok|sim|pode seguir|segue)\s*\.?\s*$/i.test(ev.texto || '');
      const r = out[chave] || (out[chave] = { total: 0, semAjuste: 0, sequencia: 0, ultima: null });
      r.total += 1;
      if (limpo) { r.semAjuste += 1; r.sequencia += 1; } else r.sequencia = 0;
      r.ultima = ev.ts;
    }
  }
  return out;
}

function imprimirPlacar(p) {
  const chaves = Object.keys(p);
  if (!chaves.length) { console.log('Sem checkpoints respondidos ainda.'); return; }
  console.log('checkpoint'.padEnd(28) + 'respostas  sem ajuste  sequência');
  for (const k of chaves.sort()) console.log(`${k.padEnd(28)}${String(p[k].total).padStart(9)}  ${String(p[k].semAjuste).padStart(10)}  ${String(p[k].sequencia).padStart(9)}`);
}

/* ------------------------------------------------------------------------ CLI */

function parseArgs(argv) {
  const pos = []; const op = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'sim';
      op[k] = v;
    } else pos.push(a);
  }
  return { pos, op };
}

function imprimirStatus(estado) {
  const linhas = [`${estado.orquestrador} — modo ${estado.modo} — ${estado.pendencias} pendência(s) — ${estado.status}`];
  if (!estado.contextos.length) linhas.push('  (nenhum contexto)');
  for (const c of estado.contextos) {
    linhas.push(`  [${c.baia == null ? '-' : c.baia}] ${c.repo.padEnd(24)} ${c.fluxoId.padEnd(14)} ${c.status.padEnd(16)} ${c.id}`);
    if (c.pergunta) linhas.push(`       ? ${c.pergunta.texto}`);
  }
  if (estado.guarda.bloqueios.length) linhas.push(`  guarda: último bloqueio → ${estado.guarda.bloqueios[estado.guarda.bloqueios.length - 1].alvo}`);
  console.log(linhas.join('\n'));
}

function cli(argv) {
  const { pos, op } = parseArgs(argv);
  const [cmd, sub] = pos;
  const loja = new Loja();
  const config = carregarConfig();
  const fluxos = carregarFluxos();
  const opts = { fluxos, config };

  const alvo = () => {
    if (op.contexto) return op.contexto;
    if (!op.repo) throw Object.assign(new Error('informe --repo ou --contexto'), { codigo: 400 });
    const c = contextosAtivos(loja, opts).find((x) => x.repo === op.repo);
    if (!c) throw Object.assign(new Error(`nenhum contexto ativo para o repo ${op.repo}`), { codigo: 404 });
    return c.id;
  };
  const exigir = (k) => { if (!op[k]) throw Object.assign(new Error(`informe --${k}`), { codigo: 400 }); return op[k]; };

  switch (cmd) {
    case 'contexto': {
      if (sub === 'criar') {
        const id = criarContexto(loja, { repo: exigir('repo'), fluxoId: exigir('fluxo'), origem: op.origem || 'terminal', sessionId: op.sessao });
        console.log(id);
      } else if (sub === 'status') {
        const s = exigir('status');
        if (!STATUS_CONTEXTO.includes(s)) throw Object.assign(new Error(`status inválido: ${s}`), { codigo: 400 });
        loja.registrar({ tipo: 'contexto.status', contexto: alvo(), status: s, motivo: op.motivo });
      } else if (sub === 'concluir') {
        const id = alvo();
        if (op.resumo) { loja.registrar({ tipo: 'mensagem', contexto: id, texto: op.resumo }); loja.anotarConversa(id, { quem: 'agente', texto: op.resumo }); }
        loja.registrar({ tipo: 'contexto.status', contexto: id, status: 'CONCLUIDO' });
      } else if (sub === 'terminal') {
        loja.registrar({ tipo: 'contexto.terminal', contexto: alvo(), valor: op.valor !== 'nao' });
      } else if (sub === 'dispensar') {
        loja.registrar({ tipo: 'contexto.dispensar', contexto: alvo() });
      } else if (sub === 'renomear') {
        // título ao lado da chave no Office (ex.: o serviço de um card ou Epic)
        loja.registrar({ tipo: 'contexto.renomear', contexto: alvo(), titulo: exigir('titulo') });
      } else throw Object.assign(new Error('use: contexto criar|status|concluir|terminal|dispensar|renomear'), { codigo: 400 });
      break;
    }
    case 'passo': {
      const s = exigir('status');
      if (!STATUS_PASSO.includes(s)) throw Object.assign(new Error(`status de passo inválido: ${s}`), { codigo: 400 });
      const ctxPasso = alvo(), idPasso = exigir('passo');
      const cx = projetar(loja.lerEventos(), opts).contextos.find((x) => x.id === ctxPasso);
      const fl = cx && fluxos[cx.fluxoId];
      if (fl && Array.isArray(fl.passos) && !fl.passos.some((p) => p.id === idPasso)) {
        throw Object.assign(new Error(`o passo "${idPasso}" não existe no fluxo ${cx.fluxoId}. Etapas: ${fl.passos.map((p) => p.id).join(', ')}`), { codigo: 400 });
      }
      loja.registrar({ tipo: 'passo', contexto: ctxPasso, passo: idPasso, status: s, resumo: op.resumo, skill: op.skill });
      break;
    }
    case 'pergunta': {
      const id = alvo();
      const tipo = op.tipo || 'duvida';
      if (!TIPOS_PERGUNTA.includes(tipo)) throw Object.assign(new Error(`tipo inválido: ${tipo}`), { codigo: 400 });
      const opcoes = op.opcoes ? String(op.opcoes).split('|').map((s) => s.trim()).filter(Boolean) : [];
      loja.registrar({ tipo: 'pergunta.abrir', contexto: id, tipoPergunta: tipo, chave: op.chave, texto: exigir('texto'), explicacao: op.explicacao, opcoes });
      loja.anotarConversa(id, { quem: 'agente', tipo: 'pergunta', texto: op.explicacao ? `${op.texto}\n\n${op.explicacao}` : op.texto });
      break;
    }
    case 'resposta': {
      const id = alvo();
      loja.registrar({ tipo: 'pergunta.responder', contexto: id, texto: exigir('texto'), por: op.por || 'terminal' });
      loja.anotarConversa(id, { quem: 'voce', texto: op.texto });
      break;
    }
    case 'worker':
      loja.registrar({ tipo: 'worker.resumo', contexto: alvo(), workerId: op.id, resumo: exigir('resumo') });
      break;
    case 'registro': {
      const id = alvo();
      loja.registrar({ tipo: 'registro.feito', contexto: id, resumo: exigir('resumo') });
      break;
    }
    case 'bloquear': {
      // a líder (ou o terminal) marca o contexto como bloqueado: pendência externa, sem pergunta para o ENG agora
      const id = alvo();
      const motivo = op.motivo || 'outro';
      if (!MOTIVOS_BLOQUEIO.includes(motivo)) throw new Error(`--motivo deve ser ${MOTIVOS_BLOQUEIO.join('|')}`);
      loja.registrar({ tipo: 'contexto.bloqueio', contexto: id, motivo, texto: cortar(exigir('texto'), 600), ...(op.quem ? { quem: cortar(op.quem, 120) } : {}), por: 'lider' });
      console.log('Bloqueado (aguardando pendência): foi para a área de bloqueados. Encerre o turno: quando o ENG escrever que resolveu, o Office desbloqueia e retoma com a mensagem dele.');
      break;
    }
    case 'recado': {
      // da conversa paralela: o Office lê runs/<ctx>/recados.jsonl em até 1 s e põe na fila da líder
      const id = alvo();
      const t = cortar(exigir('texto'), 4000);
      loja.registrar({ tipo: 'recado', contexto: id, texto: t });
      const arq = loja.arquivoRun(id, 'recados.jsonl');
      fs.mkdirSync(path.dirname(arq), { recursive: true });
      fs.appendFileSync(arq, JSON.stringify({ ts: agora(), texto: t }) + '\n');
      console.log('Encaminhado à líder: ela recebe no próximo passo, sem interromper o turno.');
      break;
    }
    case 'mensagem': {
      const id = alvo();
      loja.registrar({ tipo: 'mensagem', contexto: id, texto: exigir('texto') });
      loja.anotarConversa(id, { quem: 'agente', texto: op.texto });
      break;
    }
    case 'retro':
      loja.registrar({ tipo: 'retro', contexto: op.repo || op.contexto ? alvo() : undefined, skill: op.skill });
      break;
    case 'skill': {
      const nome = pos[2] || op.nome;
      if (sub === 'ativar' || sub === 'desativar') {
        const r = alternarSkill(nome, sub === 'ativar');
        new Loja().registrar({ tipo: 'skill.alternada', skill: r.nome, ativa: r.ativa });
        console.log(`${r.nome}: ${r.ativa ? 'ativa' : 'desativada'}${r.mudou ? '' : ' (já estava)'}`);
      } else if (sub === 'lista') {
        for (const [rot, dir] of [['ativas', 'skills'], ['desativadas', 'skills-desativadas']]) {
          let n = []; try { n = fs.readdirSync(path.join(RAIZ, '.claude', dir)); } catch { /* vazia */ }
          console.log(`${rot}: ${n.map((x) => x.replace(/\.md$/, '')).join(', ') || '(nenhuma)'}`);
        }
      } else throw Object.assign(new Error('use: skill ativar|desativar <nome> | skill lista'), { codigo: 400 });
      break;
    }
    case 'liberar-guarda': {
      const min = Math.min(Math.max(parseInt(sub || op.minutos || '30', 10) || 30, 1), 240);
      const ate = new Date(Date.now() + min * 60000).toISOString();
      gravarAtomico(path.join(OFFICE, '.liberar-guarda'), ate + '\n');
      loja.registrar({ tipo: 'guarda.liberada', ate });
      console.log(`guarda liberada até ${ate} (${min} min). Para fechar antes: rm .claude/office/.liberar-guarda`);
      break;
    }
    case 'placar':
      imprimirPlacar(placar(loja.lerEventos()));
      break;
    case 'projetar':
      loja.projetar(opts);
      console.log(loja.arqEstado);
      break;
    case 'status':
      imprimirStatus(projetar(loja.lerEventos(), opts));
      break;
    case 'autoteste':
      return autoteste();
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 18).join('\n'));
      return cmd ? 1 : 0;
  }
  return 0;
}

module.exports = {
  Loja, projetar, placar, FLUXO_CHAT, alternarSkill, SKILLS_ESSENCIAIS, criarContexto, carregarConfig, carregarFluxos, atlasDoFluxo, desativadoDo, arestasDoFluxo, validarSchema,
  slug, carimbo, cortar, gravarAtomico, lerJson, RAIZ, OFFICE, TERMINAIS, STATUS_CONTEXTO,
};

if (require.main === module) {
  try { process.exitCode = cli(process.argv.slice(2)); } catch (err) {
    console.error(`estado.js: ${err.message}`);
    process.exitCode = err.codigo === 409 ? 3 : err.codigo === 404 ? 4 : 1;
  }
}
