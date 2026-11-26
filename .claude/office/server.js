#!/usr/bin/env node
'use strict';
/*
 * server.js — Office local do orquestrador. Node puro, sem npm install.
 *
 *   node .claude/office/server.js              # modo real (turnos com `claude -p`)
 *   node .claude/office/server.js --simular    # protótipo: sem Claude, eventos falsos
 *   node .claude/office/server.js --porta 4322
 *
 * Escuta só em 127.0.0.1. Toda escrita exige o token desta execução (injetado no
 * HTML servido) e Origin/Host locais.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn, execFileSync } = require('child_process');
const os = require('os');
const E = require('./estado.js');
const WINDOWS = process.platform === 'win32'; // Windows sem WSL: sem ps, sem SIGSTOP/SIGCONT, claude pode ser .cmd

/**
 * O claude no Windows pode ser claude.exe (instalador nativo) ou claude.cmd (npm). O spawn não acha .cmd,
 * então, nesse caso, roda o cli.js do pacote com o próprio node. No Linux e no WSL, é só "claude".
 */
let claudeResolvido = null;
function comandoClaude() {
  if (!WINDOWS) return { cmd: 'claude', pre: [] };
  if (claudeResolvido) return claudeResolvido;
  claudeResolvido = { cmd: 'claude', pre: [] };
  for (const d of (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)) {
    if (fs.existsSync(path.join(d, 'claude.exe'))) { claudeResolvido = { cmd: path.join(d, 'claude.exe'), pre: [] }; break; }
    const cli = path.join(d, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    if (fs.existsSync(path.join(d, 'claude.cmd')) && fs.existsSync(cli)) { claudeResolvido = { cmd: process.execPath, pre: [cli] }; break; }
  }
  return claudeResolvido;
}
function iniciarClaude(argv, opcoes) {
  const c = comandoClaude();
  const { limiteSeg, ...resto } = opcoes || {};
  // limite de duração pelo `timeout` do sistema: vale mesmo com o servidor desligado (TERM, e KILL 30 s depois). Sem timeout no Windows nativo.
  if (limiteSeg > 0 && !WINDOWS) return spawn('timeout', ['-k', '30', String(limiteSeg), c.cmd, ...c.pre, ...argv], { windowsHide: true, ...resto });
  return spawn(c.cmd, [...c.pre, ...argv], { windowsHide: true, ...resto });
}
const { Transcricao, detalhesFerramenta } = require('./transcritos.js');

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const SIMULAR = args.includes('--simular');
const CENARIO = (() => { const i = args.indexOf('--cenario'); return i >= 0 ? args[i + 1] : null; })(); // --cenario lotado: teste de escala
const RAIZ = E.RAIZ;
const OFFICE = E.OFFICE;
const DADOS = SIMULAR ? path.join(OFFICE, '.simulacao') : (process.env.ORQ_DADOS || OFFICE);
const TOKEN = crypto.randomBytes(18).toString('hex');
const VERSAO = (() => { try { return fs.readFileSync(path.join(RAIZ, 'VERSAO'), 'utf8').trim(); } catch { return '?'; } })();

if (SIMULAR) fs.rmSync(DADOS, { recursive: true, force: true });
const fsp = fs.promises;

/**
 * Loja em memória. O disco (/mnt/c no WSL custa 50–130 ms por operação) fica fora do caminho
 * das requisições: o servidor guarda eventos e conversas em memória, grava em fila assíncrona
 * e relê o arquivo em background quando alguém de fora (hooks, CLI) acrescenta eventos.
 */
class LojaRapida {
  constructor(disco) {
    this.disco = disco;
    this.eventos = disco.lerEventos();
    try { this.tamanho = fs.statSync(disco.arqEventos).size; } catch { this.tamanho = 0; }
    this.versao = 1;
    this.fila = Promise.resolve();
    this.pendentes = 0;
    this.conversas = new Map();
  }
  enfileirar(trabalho) {
    this.pendentes++;
    this.fila = this.fila.then(trabalho).catch(() => {}).finally(() => { this.pendentes--; });
  }
  registrar(ev) {
    const obj = { ts: new Date().toISOString() };
    for (const [k, v] of Object.entries(ev)) if (v !== undefined) obj[k] = typeof v === 'string' ? E.cortar(v) : v;
    const linha = JSON.stringify(obj) + '\n';
    this.eventos.push(obj);
    this.tamanho += Buffer.byteLength(linha);
    this.versao++;
    this.enfileirar(async () => { await fsp.mkdir(this.disco.dir, { recursive: true }); await fsp.appendFile(this.disco.arqEventos, linha); });
    return obj;
  }
  lerEventos() { return this.eventos; }
  async sincronizarDisco() {
    if (this.pendentes) return;
    let st; try { st = await fsp.stat(this.disco.arqEventos); } catch { return; }
    if (st.size === this.tamanho || this.pendentes) return;
    const bruto = await fsp.readFile(this.disco.arqEventos, 'utf8');
    if (this.pendentes) return;
    const evs = [];
    for (const l of bruto.split('\n')) { if (!l.trim()) continue; try { evs.push(JSON.parse(l)); } catch { /* linha ruim */ } }
    this.eventos = evs; this.tamanho = Buffer.byteLength(bruto); this.versao++;
  }
  async garantirConversa(id) {
    let c = this.conversas.get(id);
    if (!c) {
      c = { mensagens: [], tamanho: 0, lidoEm: 0 };
      this.conversas.set(id, c);
      await this.recarregarConversa(id, true);
    } else if (Date.now() - c.lidoEm > 1500 && !this.pendentes) {
      this.recarregarConversa(id, false); // em background: pega o que o terminal/CLI escreveu
    }
    return c;
  }
  async recarregarConversa(id, obrigatorio) {
    const c = this.conversas.get(id);
    const arq = this.disco.arquivoRun(id, 'conversa.jsonl');
    c.lidoEm = Date.now();
    let st; try { st = await fsp.stat(arq); } catch { return; }
    if (!obrigatorio && st.size === c.tamanho) return;
    const bruto = await fsp.readFile(arq, 'utf8');
    if (this.pendentes && !obrigatorio) return;
    c.mensagens = bruto.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    c.tamanho = Buffer.byteLength(bruto);
  }
  anotarConversa(id, msg) {
    const obj = { ts: new Date().toISOString(), ...msg, texto: E.cortar(msg.texto, 20000) };
    const linha = JSON.stringify(obj) + '\n';
    if (!this.conversas.has(id)) this.conversas.set(id, { mensagens: [], tamanho: 0, lidoEm: Date.now() });
    const c = this.conversas.get(id);
    c.mensagens.push(obj); c.tamanho += Buffer.byteLength(linha);
    const arq = this.disco.arquivoRun(id, 'conversa.jsonl');
    this.enfileirar(async () => { await fsp.mkdir(path.dirname(arq), { recursive: true }); await fsp.appendFile(arq, linha); });
  }
  async lerConversa(id) { return (await this.garantirConversa(id)).mensagens; }
  arquivoRun(id, nome) { return this.disco.arquivoRun(id, nome); }
}
const loja = new LojaRapida(new E.Loja(DADOS));

/* ------------------------------------------------------------ config / catálogo */

const cache = { config: E.carregarConfig(), fluxos: E.carregarFluxos(), catalogo: null, tema: null, hooks: [], estaticos: new Map() };
function config() {
  const c = { ...cache.config };
  if (SIMULAR) c.maxContextos = Math.max(c.maxContextos, CENARIO === 'lotado' ? 6 : 3);
  return c;
}
const PORTA = Number(arg('--porta')) || config().porta || 4321;

let sim = null;
if (SIMULAR) {
  const { criarSimulador } = require('./simulador.js');
  const lojaSim = {
    registrar(ev) { const r = loja.registrar(ev); espelharSim(ev); return r; },
    anotarConversa: (id, m) => loja.anotarConversa(id, m),
    lerEventos: () => loja.lerEventos(),
  };
  sim = criarSimulador({ loja: lojaSim, atividade: (id, quem, tipo, alvo) => anotarAtividade(id, quem, tipo, alvo) });
}

// chat livre: um contexto sem fluxo nem repositório, só a conversa (não aparece no catálogo)
const FLUXO_CHAT = { id: E.FLUXO_CHAT, nome: 'Chat livre', missao: 'Conversa livre com o orquestrador', descricao: '', passos: [], oculto: true };
function fluxos() {
  return { ...(SIMULAR ? { ...cache.fluxos, ...sim.FLUXOS } : cache.fluxos), [E.FLUXO_CHAT]: FLUXO_CHAT };
}

function frontmatter(arq) {
  try {
    const t = fs.readFileSync(arq, 'utf8');
    const m = t.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!m) return {};
    const out = {};
    let chave = null; // bloco de várias linhas (`>-`, `|`): as linhas indentadas seguintes são o valor
    for (const linha of m[1].replace(/\r/g, '').split('\n')) {
      const kv = linha.match(/^(\w[\w-]*):\s*(.*)$/);
      if (kv) {
        const v = kv[2].trim();
        chave = /^[>|][+-]?$/.test(v) ? kv[1] : null;
        out[kv[1]] = chave ? '' : v.replace(/^["']|["']$/g, '');
      } else if (chave && /^\s+\S/.test(linha)) out[chave] = `${out[chave]} ${linha.trim()}`.trim();
    }
    return out;
  } catch { return {}; }
}

/** Resolve a pasta de uma skill do time fora do projeto: `~` vira o HOME e `<versão>` vira a maior versão instalada no cache do plugin. */
function pastaExterna(rel) {
  let p = String(rel).replace(/^~(?=[\\/])/, os.homedir());
  if (!path.isAbsolute(p)) p = path.join(RAIZ, p);
  if (!p.includes('<versão>')) return p;
  const [antes, depois] = p.split('<versão>');
  let versoes = [];
  try { versoes = fs.readdirSync(antes).filter((v) => /^\d+(\.\d+)*$/.test(v)); } catch { return null; }
  if (!versoes.length) return null;
  const num = (v) => v.split('.').map(Number);
  versoes.sort((a, b) => { const x = num(a), y = num(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; });
  return path.join(antes, versoes[versoes.length - 1], depois);
}

function catalogo() { return cache.catalogo || (cache.catalogo = montarCatalogo()); }
function montarCatalogo() {
  const origemTime = (E.lerJson(path.join(RAIZ, 'time', 'skills-origem.json'), {}).skills) || [];
  const doTime = new Set(origemTime.map((s) => (typeof s === 'string' ? s : s.nome)));
  const skills = [];
  for (const [pasta, ativa] of [['skills', true], ['skills-desativadas', false]]) {
    const dirSkills = path.join(RAIZ, '.claude', pasta);
    let nomes = [];
    try { nomes = fs.readdirSync(dirSkills); } catch { continue; }
    for (const nome of nomes) {
      const p = path.join(dirSkills, nome);
      let arq = null;
      try { arq = fs.statSync(p).isDirectory() ? path.join(p, 'SKILL.md') : (nome.endsWith('.md') ? p : null); } catch { continue; }
      if (!arq || !fs.existsSync(arq)) continue;
      const fm = frontmatter(arq);
      const id = fm.name || nome.replace(/\.md$/, '');
      skills.push({
        nome: id, pasta: nome.replace(/\.md$/, ''), descricao: fm.description || '', caminho: path.relative(RAIZ, arq), ativa,
        doTime: doTime.has(id), origem: doTime.has(id) ? 'time' : 'nucleo', essencial: E.SKILLS_ESSENCIAIS.has(nome),
      });
    }
  }
  // skills do time instaladas fora de .claude/skills (plugins do Claude Code ou workspace repos/): só leitura aqui
  for (const s of origemTime) {
    if (typeof s === 'string' || !s.pasta || skills.some((x) => x.nome === s.nome)) continue;
    const dir = pastaExterna(s.pasta);
    const arq = dir && path.join(dir, 'SKILL.md');
    const fm = arq && fs.existsSync(arq) ? frontmatter(arq) : null;
    skills.push({
      nome: s.nome, pasta: s.nome, descricao: (fm && fm.description) || '', caminho: !arq ? s.pasta : arq.startsWith(RAIZ) ? path.relative(RAIZ, arq) : arq.replace(os.homedir(), '~'),
      ativa: Boolean(fm), doTime: true, origem: 'time', externa: true, instalacao: s.instalacao || '', invocar: s.invocar || '', fonte: s.origem || '',
      essencial: true,
    });
  }
  const agents = [];
  try {
    for (const f of fs.readdirSync(path.join(RAIZ, '.claude', 'agents')).filter((x) => x.endsWith('.md'))) {
      const fm = frontmatter(path.join(RAIZ, '.claude', 'agents', f));
      agents.push({ nome: fm.name || f.replace(/\.md$/, ''), descricao: fm.description || '' });
    }
  } catch { /* sem agents */ }
  let repos = [];
  if (SIMULAR) repos = sim.REPOS;
  else {
    try { repos = fs.readdirSync(path.join(RAIZ, 'repos'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name); } catch { /* sem repos */ }
  }
  const fl = Object.values(fluxos()).filter((f) => !f.oculto).map((f) => ({ id: f.id, nome: f.nome, missao: f.missao || f.nome, descricao: f.descricao || '', alvo: f.alvo || 'repo', passos: f.passos }));
  return { skills, agents, fluxos: fl, repos };
}

function mesclar(a, b) {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b === undefined ? a : b;
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) out[k] = mesclar(out[k], v);
  return out;
}

function tema() { return cache.tema || (cache.tema = montarTema()); }
function montarTema() {
  const doTime = E.lerJson(path.join(RAIZ, 'time', 'tema.json'), {});
  const base = String(arg('--tema') || doTime.base || 'neutro').replace(/[^\w-]/g, '');
  const preset = E.lerJson(path.join(OFFICE, 'escritorio', 'temas', `${base}.json`), null)
    || E.lerJson(path.join(OFFICE, 'escritorio', 'temas', 'neutro.json'), {});
  const { base: _b, ...resto } = doTime;
  return mesclar(preset, resto);
}

/* ------------------------------------------------------------------- estado */

let cacheEstado = { versao: 0, valor: null, gravado: 0 };
function estadoProjetado() {
  if (cacheEstado.versao !== loja.versao || !cacheEstado.valor) {
    cacheEstado = { ...cacheEstado, versao: loja.versao, valor: E.projetar(loja.lerEventos(), { fluxos: fluxos(), config: config() }) };
  }
  return cacheEstado.valor;
}
async function gravarStateJson() {
  if (cacheEstado.gravado === cacheEstado.versao || !cacheEstado.valor) return;
  const versao = cacheEstado.versao;
  const arq = path.join(DADOS, 'state.json');
  const tmp = `${arq}.${process.pid}.tmp`;
  await fsp.mkdir(DADOS, { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify(cacheEstado.valor, null, 2));
  await fsp.rename(tmp, arq);
  cacheEstado.gravado = versao;
}

function contexto(id) { return estadoProjetado().contextos.find((c) => c.id === id) || null; }

/* atividade efêmera: memória (stream/simulador) + arquivos dos hooks */
/* ------------------------------------------------------- terminal (console) */

class TerminalSim {
  constructor() { this.entradas = []; this.pendentes = []; this.custo = 0; this.existe = true; this.sessionId = null; this.abertos = new Map(); this.n = 0; }
  empurrar(e) { this.pendentes.push({ ts: new Date().toISOString(), ...e }); }
  async atualizar() { const n = this.pendentes.splice(0); this.entradas.push(...n); return n; }
}
const terminais = new Map();
function fonteTerminal(ctxId, sessionId) {
  let t = terminais.get(ctxId);
  if (!t) { t = { fonte: SIMULAR ? new TerminalSim() : new Transcricao(RAIZ, sessionId), ouvintes: new Set(), custo: null }; terminais.set(ctxId, t); }
  else if (!SIMULAR && sessionId && t.fonte.sessionId !== sessionId) t.fonte = new Transcricao(RAIZ, sessionId);
  return t;
}
setInterval(async () => {
  for (const [, t] of terminais) {
    if (!t.ouvintes.size && !SIMULAR) continue;
    let novas = [];
    try { novas = await t.fonte.atualizar(); } catch { continue; }
    if (!novas.length && t.fonte.custo === t.custo) continue;
    t.custo = t.fonte.custo;
    for (const o of t.ouvintes) o({ entradas: novas, custo: t.fonte.custo });
  }
}, 700);

const SAIDA_SIM = {
  Read: (a) => `     1\t<!-- ${a} -->\n     2\t…\n(42 linhas)`,
  Grep: (a) => `3 ocorrências de "${a}"\nsrc/main/java/App.java:12\nsrc/main/java/Config.java:40\nsrc/test/java/AppTest.java:7`,
  Edit: (a) => `The file ${a} has been updated.`,
  Bash: (a) => `$ ${a}\n[INFO] Scanning for projects...\n[INFO] BUILD SUCCESS\n[INFO] Total time: 4.2 s`,
};
const NOME_SIM = { lendo: 'Read', buscando: 'Grep', digitando: 'Edit', rodando: 'Bash' };
function espelharAtividadeSim(ctxId, quem, tipo, alvo) {
  const t = fonteTerminal(ctxId).fonte;
  const chave = `${quem}`;
  const aberto = t.abertos.get(chave);
  if (aberto) { t.empurrar({ t: 'resultado', id: aberto.id, texto: SAIDA_SIM[aberto.nome](aberto.alvo) }); t.abertos.delete(chave); }
  const nome = NOME_SIM[tipo];
  if (!nome) return;
  const id = `sim-t${++t.n}`;
  const det = nome === 'Edit'
    ? { titulo: alvo, diff: [{ antes: '<version>1.5.22.RELEASE</version>', depois: '<version>2.7.18</version>' }] }
    : detalhesFerramenta(nome, nome === 'Bash' ? { command: alvo } : nome === 'Grep' ? { pattern: alvo } : { file_path: alvo });
  t.empurrar({ t: 'ferramenta', id, nome, ...det, dentro: quem === 'lider' ? null : quem });
  t.abertos.set(chave, { id, nome, alvo });
}
function espelharSim(ev) {
  if (!ev.contexto) return;
  const t = fonteTerminal(ev.contexto).fonte;
  switch (ev.tipo) {
    case 'worker.inicio': t.empurrar({ t: 'ferramenta', id: ev.workerId, nome: 'Agent', titulo: `${ev.papel || 'worker'} · ${ev.skill}`, prompt: `[orq] contexto=${ev.contexto} passo=${ev.passo || ''} skill=${ev.skill}\nExecute o passo seguindo a skill ${ev.skill}.`, dentro: ev.pai || null }); break;
    case 'worker.fim': {
      const ab = t.abertos.get(ev.workerId);
      if (ab) { t.empurrar({ t: 'resultado', id: ab.id, texto: SAIDA_SIM[ab.nome](ab.alvo) }); t.abertos.delete(ev.workerId); }
      t.empurrar({ t: 'resultado', id: ev.workerId, texto: ev.resumo || 'feito', erro: ev.status === 'ERROR' });
      break;
    }
    case 'mensagem': t.empurrar({ t: 'texto', texto: ev.texto }); break;
    case 'pergunta.abrir': t.empurrar({ t: 'texto', texto: `❓ ${ev.texto}${ev.explicacao ? `\n\n${ev.explicacao}` : ''}` }); break;
    case 'pergunta.responder': case 'mensagem.usuario': t.empurrar({ t: 'voce', texto: ev.texto }); break;
    case 'guarda.bloqueio': {
      const id = `sim-t${++t.n}`;
      t.empurrar({ t: 'ferramenta', id, nome: 'Bash', titulo: ev.alvo });
      t.empurrar({ t: 'resultado', id, texto: `[guarda] ${ev.motivo}`, erro: true });
      break;
    }
    default: break;
  }
}

const atividadeMem = new Map();
function anotarAtividade(ctxId, quem, tipo, alvo = '') {
  if (SIMULAR) espelharAtividadeSim(ctxId, quem, tipo, alvo);
  if (!atividadeMem.has(ctxId)) atividadeMem.set(ctxId, { lider: null, workers: {} });
  const a = atividadeMem.get(ctxId);
  const item = tipo ? { tipo, alvo: String(alvo || '').slice(0, 60), ts: new Date().toISOString() } : null;
  if (quem === 'lider') a.lider = item;
  else if (item) a.workers[quem] = item;
  else delete a.workers[quem];
}

function atividadeDosHooks() { return cache.hooks; }

/* limites de uso (sessão de 5 h e semana). Duas fontes, e vale a mais recente:
 * 1) a ponte da statusline grava ~/.claude/orq-limites.json, mas só quando uma sessão
 *    interativa do Claude Code desenha a statusline;
 * 2) os turnos do Office (`claude -p`) trazem `rate_limit_event` no stream, com o uso das
 *    janelas a cada chamada. Com isso o painel anda junto com a missão, sem sessão aberta. */
const ARQ_LIMITES = path.join(require('os').homedir(), '.claude', 'orq-limites.json');
const quandoLimite = (v) => (v == null ? null : typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v).toISOString() : String(v));
let limitesDoStream = null;
function anotarLimitesDoStream(info) {
  const w = info && info.unifiedWindows;
  if (!w) return;
  // utilization vem de 0 a 1; arredonda em décimos para 0.07 virar 7 (e não 7.000000000000001)
  const norm = (x) => (x && x.utilization != null ? { pct: Math.round(Number(x.utilization) * 1000) / 10, renova: quandoLimite(x.resetsAt) } : null);
  const cincoHoras = norm(w.five_hour), semana = norm(w.seven_day);
  if (cincoHoras || semana) limitesDoStream = { atualizadoEm: new Date().toISOString(), cincoHoras, semana, fonte: 'missao' };
}
async function lerLimites() {
  let doArquivo = null;
  try {
    const j = JSON.parse(await fsp.readFile(ARQ_LIMITES, 'utf8'));
    const norm = (x) => (x ? { pct: x.used_percentage != null ? Number(x.used_percentage) : null, renova: quandoLimite(x.resets_at) } : null);
    doArquivo = { atualizadoEm: j.ts, cincoHoras: norm(j.rate_limits && j.rate_limits.five_hour), semana: norm(j.rate_limits && j.rate_limits.seven_day), fonte: 'statusline' };
  } catch { /* sem ponte ainda: fica só o que veio das missões */ }
  const [novo, velho] = [doArquivo, limitesDoStream].filter(Boolean).sort((a, b) => (Date.parse(b.atualizadoEm) || 0) - (Date.parse(a.atualizadoEm) || 0));
  cache.limites = novo ? { ...novo, cincoHoras: novo.cincoHoras || (velho && velho.cincoHoras) || null, semana: novo.semana || (velho && velho.semana) || null } : null;
}

/* aprendizado: lições por skill (formato do /retro) + diário por repo + execuções e placar */
let cacheAprendizado = { em: 0, valor: null };
function lerLicoes(texto) {
  const out = { atualizado: null, ciclos: null, licoes: [] };
  const m = texto.match(/_Atualizado em ([^·_]+?)\s*·\s*ciclos:\s*(\d+)_/);
  if (m) { out.atualizado = m[1].trim(); out.ciclos = Number(m[2]); }
  let tipo = null;
  for (const linha of texto.split('\n')) {
    const h = linha.match(/^##\s+(.*)$/);
    if (h) { tipo = /lacuna/i.test(h[1]) ? 'lacuna' : /evite/i.test(h[1]) ? 'evite' : /fa[çc]a/i.test(h[1]) ? 'faca' : null; continue; }
    const b = linha.match(/^\s*[-*]\s+(.+)$/);
    if (b && tipo) {
      const v = b[1].match(/\(visto (\d+)x\)\s*$/i);
      out.licoes.push({ tipo, texto: b[1].replace(/\s*\(visto \d+x\)\s*$/i, '').trim(), vezes: v ? Number(v[1]) : 1 });
    }
  }
  return out;
}
function lerDiario(texto) {
  const entradas = [];
  const partes = texto.split(/^#{2,3}\s+/m).slice(1);
  for (const p of partes) {
    const [titulo, ...resto] = p.split('\n');
    entradas.push({ titulo: titulo.trim(), texto: E.cortar(resto.join(' ').replace(/\s+/g, ' ').trim(), 600) });
  }
  return entradas.slice(-8);
}
async function montarAprendizado() {
  if (cacheAprendizado.valor && Date.now() - cacheAprendizado.em < 5000) return cacheAprendizado.valor;
  const ler = async (dir) => {
    const out = {};
    let nomes = [];
    try { nomes = (await fsp.readdir(dir)).filter((n) => n.endsWith('.md')); } catch { return out; }
    for (const n of nomes) { try { out[n.slice(0, -3)] = await fsp.readFile(path.join(dir, n), 'utf8'); } catch { /* ignora */ } }
    return out;
  };
  const licoesArq = await ler(path.join(RAIZ, 'aprendizado', 'skills'));
  const diarioArq = await ler(path.join(RAIZ, 'aprendizado', 'repos'));
  const porSkill = {};
  for (const [k, t] of Object.entries(licoesArq)) porSkill[k] = lerLicoes(t);
  const repos = Object.entries(diarioArq).map(([repo, t]) => ({ repo, entradas: lerDiario(t) })).filter((r) => r.entradas.length);
  if (SIMULAR) {
    const { APRENDIZADO_SIM } = require('./simulador.js');
    for (const [k, v] of Object.entries(APRENDIZADO_SIM.skills)) if (!porSkill[k]) porSkill[k] = v;
    for (const [repo, entradas] of Object.entries(APRENDIZADO_SIM.repos)) if (!repos.some((r) => r.repo === repo)) repos.push({ repo, entradas });
  }
  const eventos = loja.lerEventos();
  const execucoes = {};
  for (const ev of eventos) if (ev.tipo === 'worker.inicio' && ev.skill) execucoes[ev.skill] = (execucoes[ev.skill] || 0) + 1;
  const pl = E.placar(eventos);
  const skillDoPasso = {};
  for (const f of Object.values(fluxos())) for (const p of f.passos) skillDoPasso[p.id] = p.skill;
  const placarSkill = {};
  for (const [chave, v] of Object.entries(pl)) {
    const s = chave.startsWith('passo:') ? skillDoPasso[chave.slice(6)] : null;
    if (!s) continue;
    const a = placarSkill[s] || (placarSkill[s] = { respostas: 0, sequencia: 0 });
    a.respostas += v.total; a.sequencia = Math.max(a.sequencia, v.sequencia);
  }
  const cat = catalogo();
  const emFluxo = new Set(Object.values(fluxos()).flatMap((f) => f.passos.map((p) => p.skill)).filter(Boolean));
  const nomes = new Set([...emFluxo, ...cat.skills.filter((s) => s.doTime).map((s) => s.nome), ...Object.keys(porSkill)].filter(Boolean));
  const skills = [...nomes].sort().map((nome) => {
    const info = cat.skills.find((s) => s.nome === nome) || {};
    const l = porSkill[nome] || { licoes: [], atualizado: null, ciclos: null };
    const ex = execucoes[nome] || 0;
    const pz = placarSkill[nome] || { respostas: 0, sequencia: 0 };
    const lacunas = l.licoes.filter((x) => x.tipo === 'lacuna').length;
    const maturidade = !ex && !l.licoes.length ? 'inexplorada' : pz.sequencia >= 3 && !lacunas ? 'madura' : 'aprendendo';
    return { nome, descricao: info.descricao || '', doTime: !!info.doTime, ativa: info.ativa !== false, emFluxo: emFluxo.has(nome), execucoes: ex, respostas: pz.respostas, sequencia: pz.sequencia, atualizado: l.atualizado, ciclos: l.ciclos, licoes: l.licoes, maturidade };
  });
  const valor = {
    nome: `${config().nome}${config().time ? ` · ${config().time}` : ''}`,
    skills, repos,
    totalLicoes: skills.reduce((s, x) => s + x.licoes.length, 0),
    totalLacunas: skills.reduce((s, x) => s + x.licoes.filter((l) => l.tipo === 'lacuna').length, 0),
  };
  cacheAprendizado = { em: Date.now(), valor };
  return valor;
}
async function lerAtividadeDosHooks() {
  const dir = path.join(DADOS, 'atividade');
  let nomes = [];
  try { nomes = (await fsp.readdir(dir)).filter((x) => x.endsWith('.json')); } catch { cache.hooks = []; return; }
  const out = [];
  for (const f of nomes) {
    try { const j = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')); if (j && Date.now() - Date.parse(j.ts) < 6 * 3600e3) out.push(j); } catch { /* arquivo em escrita */ }
  }
  cache.hooks = out;
}

/* recarga em background: nada disso roda no caminho de uma requisição */
const ESTATICOS = ['index.html', 'painel.js', 'chats.js', 'dialogo.js', 'registro.js', 'fluxos.js', 'aprendizado.js', 'biblioteca.js', 'terminal.js', 'markdown.js', 'imagens.js', 'favicon.svg', 'estilo.css', 'escritorio/motor.js', 'escritorio/cena.js', 'escritorio/mapa.js', 'escritorio/sprites.js'];
async function recarregarEstaticos() {
  for (const rel of ESTATICOS) {
    const abs = path.join(OFFICE, rel);
    try {
      const st = await fsp.stat(abs);
      const atual = cache.estaticos.get(rel);
      if (atual && atual.mtime === st.mtimeMs) continue;
      let dados = await fsp.readFile(abs);
      if (rel === 'index.html') dados = Buffer.from(dados.toString('utf8').replace('__ORQ_TOKEN__', TOKEN));
      cache.estaticos.set(rel, { mtime: st.mtimeMs, dados });
    } catch { /* arquivo ausente */ }
  }
}
let tique = 0, ocupado = false;
async function refrescar() {
  if (ocupado) return;
  ocupado = true;
  try {
    tique++;
    await loja.sincronizarDisco();
    for (const id of processos.keys()) absorverEntregues(id); // o gancho entregou à líder no meio do turno
    // decisões da conversa paralela (ou `estado.js recado` do terminal): contextos abertos e cópias rodando
    for (const id of new Set([...processos.keys(), ...paralelos.keys(), ...estadoProjetado().contextos.filter((x) => !E.TERMINAIS.has(x.status)).map((x) => x.id)])) absorverRecados(id);
    await lerAtividadeDosHooks();
    await lerLimites();
    if (tique % 3 === 0) await recarregarEstaticos();
    if (tique % 5 === 0) {
      cache.config = E.carregarConfig(); cache.fluxos = E.carregarFluxos();
      cache.catalogo = montarCatalogo(); cache.tema = montarTema();
    }
    estadoProjetado();
    await gravarStateJson();
  } catch { /* tenta de novo no próximo tique */ } finally { ocupado = false; }
}

function comAtividade(estado) {
  const hooks = atividadeDosHooks();
  const agora = Date.now();
  return {
    ...estado,
    contextos: estado.contextos.map((c) => {
      const mem = atividadeMem.get(c.id) || { lider: null, workers: {} };
      let lider = mem.lider;
      const workers = { ...mem.workers };
      const h = hooks.find((x) => x.contexto === c.id || (c.sessionId && x.sessao === c.sessionId));
      if (h) {
        if (h.lider && (!lider || h.lider.ts > lider.ts)) lider = h.lider;
        const ativos = c.agents.filter((a) => a.status === 'WORKING').sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
        const sub = h.sub || {};
        for (const a of ativos) if (a.agentId && sub[a.agentId] && !workers[a.id]) workers[a.id] = sub[a.agentId];
        const usados = new Set(ativos.map((a) => a.agentId).filter(Boolean));
        const soltos = Object.entries(sub).filter(([k]) => !usados.has(k)).map(([, v]) => v)
          .sort((a, b) => String(a.primeiroVisto).localeCompare(String(b.primeiroVisto)));
        ativos.filter((a) => !a.agentId && !workers[a.id]).forEach((a, i) => { if (soltos[i]) workers[a.id] = soltos[i]; });
      }
      if (lider && lider.tipo === 'ocioso') lider = null;
      if (lider && c.status === 'TRABALHANDO' && agora - Date.parse(lider.ts) > 45000) lider = { tipo: 'pensando', alvo: '', ts: lider.ts };
      const fila = (respostasPendentes.get(c.id) || []).map(({ id, texto: t, desde, deParalelo }) => ({ id, texto: t, desde, ...(deParalelo ? { deParalelo: true } : {}) }));
      const par = paralelos.get(c.id);
      const reg = registros.get(c.id);
      return {
        ...c, atividade: { lider, workers }, fila, paralelo: par ? { desde: par.desde, naFila: par.fila.length } : null,
        registro: reg ? { fase: reg.fase, versao: reg.versao, desde: reg.desde, ...(reg.fase === 'pronto' ? { rascunho: reg.rascunho } : {}) } : null,
      };
    }),
  };
}

/* -------------------------------------------------------------- turnos reais */

const processos = new Map();
// Fila do turno: mensagens que o usuário mandou enquanto a líder trabalhava. Aparecem na conversa com ⏱
// (o /state leva a fila) e só entram na conversa de fato quando são entregues a ela.
const respostasPendentes = new Map();
let seqFila = 0;
function enfileirarMensagem(id, prompt, textoOriginal, extra = {}) {
  if (!respostasPendentes.has(id)) respostasPendentes.set(id, []);
  respostasPendentes.get(id).push({ id: `f${++seqFila}`, prompt, texto: textoOriginal, desde: new Date().toISOString(), ...extra });
  espelharFila(id);
}

/*
 * Entrega no meio do turno: enquanto a líder trabalha, a fila fica espelhada em runs/<ctx>/fila.json (ORQ_FILA
 * no ambiente do turno). O gancho .claude/hooks/recado.js, depois de cada ferramenta da líder, entrega o que
 * estiver lá sem cortar o turno e anota os ids em fila.entregues. O que ela não recebeu segue no fim do turno.
 */
const arqFila = (id) => loja.arquivoRun(id, 'fila.json');
const arqEntregues = (id) => loja.arquivoRun(id, 'fila.entregues');
function espelharFila(id) {
  const itens = (respostasPendentes.get(id) || []).filter((x) => !x.registro && x.texto)
    .map((x) => ({ id: x.id, texto: x.texto, deParalelo: !!x.deParalelo }));
  try {
    if (!itens.length || !processos.has(id)) { fs.rmSync(arqFila(id), { force: true }); return; }
    fs.mkdirSync(path.dirname(arqFila(id)), { recursive: true });
    E.gravarAtomico(arqFila(id), JSON.stringify(itens));
  } catch { /* sem o espelho, a fila só segue no fim do turno */ }
}
/** O gancho entregou à líder no meio do turno: a mensagem sai da fila e entra na conversa. */
function absorverEntregues(id) {
  let ids;
  try { ids = new Set(fs.readFileSync(arqEntregues(id), 'utf8').split('\n').filter(Boolean)); } catch { return; }
  const fila = respostasPendentes.get(id) || [];
  const entregues = fila.filter((x) => ids.has(x.id));
  if (!entregues.length) return;
  const resto = fila.filter((x) => !ids.has(x.id));
  if (resto.length) respostasPendentes.set(id, resto); else respostasPendentes.delete(id);
  for (const x of entregues) loja.anotarConversa(id, { quem: 'voce', texto: x.texto, entregueNoTurno: true, ...(x.deParalelo ? { deParalelo: true } : {}) });
  espelharFila(id);
}
/** Mensagem livre do usuário para a líder (fora de uma pergunta). */
function promptMensagem(c, msg) {
  if (ehChat(c)) return promptChat(c, msg, false);
  return [`[orq] contexto=${c.id} — mensagem do usuário pelo Office (fora de uma pergunta):`, `<<<MENSAGEM\n${msg}\nMENSAGEM>>>`,
    `Leve em conta e continue. Se precisar decidir algo com ele, use estado.js pergunta --contexto ${c.id} e encerre o turno.`].join('\n');
}

/*
 * Recados da conversa paralela (`estado.js recado`, que grava runs/<ctx>/recados.jsonl): com a líder trabalhando,
 * entram na fila dela (e chegam no próximo passo, pelo gancho); sem turno rodando, ficam guardados e vão no
 * começo do próximo turno, seja ele qual for (nunca respondem sozinhos uma pergunta aberta).
 */
const recadosGuardados = new Map(); // contexto -> [texto]
function absorverRecados(id) {
  const arq = loja.arquivoRun(id, 'recados.jsonl');
  const lendo = `${arq}.${process.pid}.lendo`;
  try { fs.renameSync(arq, lendo); } catch { return; }
  let linhas = [];
  try { linhas = fs.readFileSync(lendo, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && x.texto); } catch { /* vazio */ }
  try { fs.rmSync(lendo, { force: true }); } catch { /* já saiu */ }
  const c = contexto(id);
  if (!c) return;
  for (const r of linhas) {
    const t = E.cortar(String(r.texto), 4000);
    if (processos.has(id)) { enfileirarMensagem(id, promptMensagem(c, t), t, { deParalelo: true }); continue; }
    if (!recadosGuardados.has(id)) recadosGuardados.set(id, []);
    recadosGuardados.get(id).push(t);
    loja.anotarConversa(id, { quem: 'voce', texto: t, deParalelo: true, guardado: true });
  }
}
function blocoRecadosGuardados(id) {
  const lista = recadosGuardados.get(id);
  if (!lista || !lista.length) return '';
  recadosGuardados.delete(id);
  return ['Decisões que o ENG deu na conversa paralela (com uma cópia sua) depois que o seu último turno terminou. Leve em conta junto com o que vem abaixo:',
    ...lista.map((t) => `- ${t}`), ''].join('\n');
}

/* ------------------------------------------------------------- conversa paralela */
// Enquanto a líder trabalha (ou dorme), o ENG conversa com uma CÓPIA dela: `--resume <sessão> --fork-session`,
// com as mesmas flags do turno (aproveita o cache do prompt). A cópia só lê (gancho .claude/hooks/paralelo.js)
// e encaminha as decisões com `estado.js recado`. Uma cópia nova a cada mensagem, com o que já se falou aqui.
const paralelos = new Map(); // contexto -> { filho, desde, fila: [texto], sessao }
const MAX_HIST_PARALELO = 8;

function promptParalelo(c, msgs, hist) {
  const rodando = agentesRodando(c.id);
  return [
    `[orq] conversa-paralela contexto=${c.id} origem=office`,
    'Você é uma CÓPIA da líder deste contexto, aberta pelo Office só para conversar com o ENG enquanto a líder original continua trabalhando. Ela não foi interrompida e não vê esta conversa.',
    `Agora: status ${c.status}${c.passoAtual ? `, etapa ${c.passoAtual}` : ''}. ${rodando.length ? `Agentes rodando: ${rodando.map((a) => `${a.skill}${a.descricao ? ` (${a.descricao})` : ''}`).join('; ')}.` : 'Nenhum agente rodando.'}`,
    `O seu histórico vai até o momento da cópia. Para ver o que mudou depois: node .claude/office/estado.js status (ou os arquivos do ciclo).`,
    '',
    'Regras desta conversa:',
    '- Responda curto e direto, em português, como na conversa da missão.',
    '- Só leia e consulte. Não edite arquivos, não rode build, teste ou git que mude algo, não lance agentes nem skills, não registre pergunta nem mude o estado do contexto. Não continue o trabalho: a líder já está fazendo isso. A guarda bloqueia o que não for leitura.',
    '- Se o ENG der uma decisão ou instrução para a líder, encaminhe com',
    `    node .claude/office/estado.js recado --contexto ${c.id} --texto "<a decisão, completa e clara para quem não viu esta conversa>"`,
    '  e diga em uma linha que encaminhou: a líder recebe no próximo passo dela, sem ser interrompida. Encaminhe só decisão ou instrução; pergunta e conversa ficam aqui. Na dúvida se é decisão, pergunte a ele antes.',
    '- Se for urgente a ponto de parar a líder agora, diga que ele pode usar o Corrigir.',
    ...(hist.length ? ['', 'Conversa paralela até aqui (mais antiga primeiro):', ...hist.map((m) => `${m.quem === 'paralelo' ? 'Você' : 'ENG'}: ${E.cortar(m.texto, 1500)}`)] : []),
    '',
    'Mensagem do ENG:',
    `<<<MENSAGEM\n${msgs.join('\n\n')}\nMENSAGEM>>>`,
  ].join('\n');
}

/** Abre a cópia com o que já se falou na conversa paralela (sem repetir as mensagens que vão agora). */
async function rodarParalelo(c, msgs) {
  const agora = new Set(msgs);
  const hist = (await loja.lerConversa(c.id)).filter((m) => m.quem === 'paralelo' || (m.paralelo && !agora.has(m.texto))).slice(-MAX_HIST_PARALELO);
  const flags = flagsTurno();
  const argv = [flags[0], '--resume', c.sessionId, '--fork-session', ...flags.slice(1)];
  const env = { ...process.env, ORQ_PARALELO: c.id, ORQ_RAIZ: RAIZ };
  delete env.ORQ_CONTEXTO; delete env.ORQ_FILA; // a cópia não mexe na telemetria nem na fila da líder
  const filho = iniciarClaude(argv, { cwd: RAIZ, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const antes = paralelos.get(c.id) || {}; // o lugar já foi reservado por pedirParalelo (e pode ter fila)
  const p = { filho, desde: antes.desde || new Date().toISOString(), fila: antes.fila || [], sessao: null, resultado: null, stderr: '', inicio: Date.now(), respondeu: false };
  paralelos.set(c.id, p);
  filho.on('error', (err) => { p.stderr += err.code === 'ENOENT' ? 'claude não encontrado no PATH' : String(err.message); });
  filho.stdin.on('error', () => {});
  filho.stdin.end(promptParalelo(c, msgs, hist));
  filho.stderr.on('data', (d) => { p.stderr = (p.stderr + d.toString()).slice(-4000); });
  readline.createInterface({ input: filho.stdout }).on('line', (linha) => {
    let m; try { m = JSON.parse(linha); } catch { return; }
    if (m.type === 'system' && m.subtype === 'init' && m.session_id) p.sessao = m.session_id;
    if (m.type === 'assistant' && m.message && Array.isArray(m.message.content) && !m.parent_tool_use_id) {
      for (const b of m.message.content) {
        if (b.type === 'text' && b.text && b.text.trim()) { loja.anotarConversa(c.id, { quem: 'paralelo', texto: b.text }); p.respondeu = true; }
      }
    }
    if (m.type === 'result') p.resultado = m;
  });
  filho.on('close', (codigo) => {
    paralelos.delete(c.id);
    const r = p.resultado;
    if (r && r.total_cost_usd) loja.registrar({ tipo: 'metricas', contexto: c.id, paralelo: true, custoUsd: r.total_cost_usd, duracaoMs: Date.now() - p.inicio });
    if (!p.respondeu || (r && r.is_error) || (!r && codigo !== 0)) {
      const motivo = E.cortar((r && (r.result || r.subtype)) || p.stderr || `claude saiu com código ${codigo}`, 300);
      loja.anotarConversa(c.id, { quem: 'sistema', texto: `A conversa paralela não respondeu: ${motivo}` });
    }
    apagarCopia(p.sessao);
    absorverRecados(c.id);
    if (p.fila.length) { const atual = contexto(c.id); if (atual && atual.sessionId) pedirParalelo(atual, p.fila); }
  });
}
/** Reserva o lugar na hora (duas mensagens seguidas não abrem duas cópias) e abre a cópia. */
function pedirParalelo(c, msgs) {
  paralelos.set(c.id, { filho: null, desde: new Date().toISOString(), fila: [] });
  rodarParalelo(c, msgs).catch((e) => {
    paralelos.delete(c.id);
    loja.anotarConversa(c.id, { quem: 'sistema', texto: `A conversa paralela não abriu: ${e.message}` });
  });
}
/** A cópia é descartável: apaga a transcrição dela (é a sessão inteira da líder, duplicada). */
function apagarCopia(sessao) {
  if (!sessao || !/^[0-9a-f-]{36}$/i.test(sessao)) return;
  try {
    const dir = require('./transcritos.js').pastaProjeto(RAIZ);
    fs.rmSync(path.join(dir, `${sessao}.jsonl`), { force: true });
    fs.rmSync(path.join(dir, sessao), { recursive: true, force: true });
  } catch { /* fica para trás: não atrapalha */ }
}

/* --------------------------------------------------------------------- registro */
// 📝 Registrar: uma CÓPIA da sessão onde o ENG clicou (--resume --fork-session, em paralelo: o que está rodando
// não para) prepara o rascunho do que vai registrar, só lendo (gancho paralelo.js, ORQ_PARALELO_MODO=registro).
// O ENG lê o rascunho num popup e aprova, pede ajuste ou descarta. Aprovado, a mesma cópia (--resume da sessão
// dela) grava, só com as ferramentas de orquestrador.json → registro.permitir (ORQ_PARALELO_MODO=registro-gravar).
const registros = new Map(); // contexto -> { fase: preparando|pronto|gravando, sessao, rascunho, versao, desde, filho }
const PADRAO_REGISTRO = {
  resumo: 'Acrescenta uma entrada datada no diário do ciclo: o que foi feito, as decisões com o porquê, o que mudou e onde, e os números.',
  onde: ['Diário do ciclo: aprendizado/repos/<repo>.md'],
  instrucoes: 'Acrescente uma entrada datada no diário do ciclo (aprendizado/repos/<repo>.md).',
  permitir: ['Edit(aprendizado/repos/*)', 'Write(aprendizado/repos/*)'],
};
/** A anotação configurada em orquestrador.json → registro (resumo, onde, instrucoes, permitir); sem ela, o diário do ciclo. */
function cfgRegistro() {
  const r = config().registro || {};
  const lista = (v, padrao) => (Array.isArray(v) && v.length ? v.map(String) : padrao);
  return {
    configurado: !!(r.resumo || r.instrucoes),
    resumo: String(r.resumo || PADRAO_REGISTRO.resumo),
    onde: lista(r.onde, PADRAO_REGISTRO.onde),
    instrucoes: String(r.instrucoes || PADRAO_REGISTRO.instrucoes),
    permitir: lista(r.permitir, PADRAO_REGISTRO.permitir),
  };
}
function promptRegistroPreparar(c, cr) {
  const quando = (ts) => new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const desde = c.ultimoRegistro ? `desde o último registro (${quando(c.ultimoRegistro.ts)}: "${c.ultimoRegistro.resumo}")` : `desde o início deste contexto (${quando(c.criadoEm)})`;
  return [
    `[orq] registro-preparar contexto=${c.id} origem=office${ehChat(c) ? ' tipo=chat' : ''}`,
    'Você é uma CÓPIA desta sessão, aberta pelo Office porque o ENG clicou em 📝 Registrar. A sessão original segue o trabalho dela e não vê esta cópia. Não continue o trabalho: só prepare o registro.',
    `Tarefa: montar o RASCUNHO do registro do que foi feito ${desde}. Nesta fase você não grava nada: só lê e consulta (a guarda bloqueia o resto). O ENG lê o rascunho num popup do Office e aprova; só depois você grava, nesta mesma sessão.`,
    `Onde e como registrar: ${cr.instrucoes}`,
    `Destinos: ${cr.onde.join('; ')}.`,
    'Conteúdo: o que foi feito no período, as decisões com o porquê, o que mudou e onde, e os números (cards, MRs, testes, custo). Linguagem simples, sem caveman, sem credencial nem dado sensível. Acrescente, nunca apague o que já está lá.',
    'Antes, consulte o destino (a página, a tarefa ou o arquivo que já existe) para não repetir o que já foi registrado e para mostrar exatamente o que muda.',
    'A sua resposta final é SÓ o rascunho, em markdown, sem preâmbulo e sem pergunta:',
    '- primeira linha: o registro numa frase (vira o resumo);',
    '- uma seção `### <destino>` por lugar que muda: onde (link, página ou arquivo), o que acontece (acrescenta, cria, move) e o texto exato que vai ser gravado;',
    '- se um trecho for rascunho para outro lugar (ex.: autoavaliação), uma seção própria para ele;',
    '- no fim, `### Fica de fora`, com o que você decidiu não registrar e por quê (só se houver).',
  ].join('\n');
}
const promptRegistroAjustar = (c, ajuste) => [
  `[orq] registro-ajustar contexto=${c.id}`,
  'O ENG leu o rascunho no Office e pediu ajuste:', `<<<AJUSTE\n${ajuste}\nAJUSTE>>>`,
  'Refaça o rascunho inteiro com o ajuste, no mesmo formato (a resposta final é só o rascunho). Ainda não grave nada.',
].join('\n');
function promptRegistroGravar(c, cr) {
  return [
    `[orq] registro-gravar contexto=${c.id}`,
    'O ENG aprovou no Office o seu último rascunho. Grave agora exatamente o que está nele, no destino e do jeito combinados acima. Nada além do rascunho.',
    `Nesta fase a guarda libera, além de leitura: ${cr.permitir.join(', ')} e estado.js registro.`,
    `Ao terminar, marque o fim do registro: node .claude/office/estado.js registro --contexto ${c.id} --resumo "<a primeira linha do rascunho>".`,
    'Resposta final: o que gravou e onde, com os links, em poucas linhas. Se algo falhar (conector sem autorização, página que não existe), comece com "Não gravei:" e diga o que faltou; nesse caso não marque o fim do registro.',
  ].join('\n');
}
const RASCUNHO_SIMULADO = 'Registro da simulação: inventário e spec da missão.\n\n### Tarefa da frente\n- **Onde:** `anotacoes/tarefas/<frente>.md` (status: A fazer → Fazendo)\n- **Acrescenta em "O que foi feito":**\n  > **25/11:** rodei o inventário e escrevi a spec; decidi seguir com o plano A porque já tinha teste.\n- **Subtarefa:** `[x] demo · inventário (25/11)`\n\n### Daily de hoje\n- **Hoje:** <repo>: rodei o fluxo, etapa spec (em andamento)\n\n### Fica de fora\n- Conversa sobre o nome das branches: nada decidido ainda.';

/** Roda a cópia do registro (fork da sessão do contexto, ou --resume da cópia já aberta) e devolve o texto final. */
function rodarRegistro(c, reg, prompt, modo) {
  if (SIMULAR) {
    return new Promise((ok) => setTimeout(() => ok(modo === 'registro-gravar'
      ? { ok: true, texto: '(simulação) No modo real, a cópia grava aqui o rascunho aprovado, no destino configurado, e mostra os links.' }
      : { ok: true, texto: RASCUNHO_SIMULADO }), 1500));
  }
  const cr = cfgRegistro();
  const flags = flagsTurno();
  const argv = reg.sessao ? [flags[0], '--resume', reg.sessao, ...flags.slice(1)] : [flags[0], '--resume', c.sessionId, '--fork-session', ...flags.slice(1)];
  const env = { ...process.env, ORQ_PARALELO: c.id, ORQ_PARALELO_MODO: modo, ORQ_REGISTRO_PERMITIR: JSON.stringify(cr.permitir), ORQ_RAIZ: RAIZ };
  delete env.ORQ_CONTEXTO; delete env.ORQ_FILA; // a cópia não mexe na telemetria nem na fila da líder
  const filho = iniciarClaude(argv, { cwd: RAIZ, env, stdio: ['pipe', 'pipe', 'pipe'] });
  reg.filho = filho;
  const inicio = Date.now();
  let resultado = null, stderr = '';
  filho.on('error', (err) => { stderr += err.code === 'ENOENT' ? 'claude não encontrado no PATH' : String(err.message); });
  filho.stdin.on('error', () => {});
  filho.stdin.end(prompt);
  filho.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });
  readline.createInterface({ input: filho.stdout }).on('line', (linha) => {
    let m; try { m = JSON.parse(linha); } catch { return; }
    if (m.type === 'system' && m.subtype === 'init' && m.session_id) reg.sessao = m.session_id;
    if (m.type === 'result') resultado = m;
  });
  return new Promise((ok) => filho.on('close', (codigo) => {
    reg.filho = null;
    if (resultado && resultado.total_cost_usd) loja.registrar({ tipo: 'metricas', contexto: c.id, paralelo: true, custoUsd: resultado.total_cost_usd, duracaoMs: Date.now() - inicio });
    const texto = resultado && !resultado.is_error ? String(resultado.result || '').trim() : '';
    ok({ ok: !!texto, texto, motivo: E.cortar((resultado && (resultado.result || resultado.subtype)) || stderr || `claude saiu com código ${codigo}`, 300) });
  }));
}
/** O rascunho pronto sobrevive a um reinício do servidor (runs/<ctx>/registro.json); as outras fases, não. */
function salvarRegistro(id) {
  const reg = registros.get(id);
  const arq = loja.arquivoRun(id, 'registro.json');
  try {
    if (!reg || reg.fase !== 'pronto') { fs.rmSync(arq, { force: true }); return; }
    fs.mkdirSync(path.dirname(arq), { recursive: true });
    E.gravarAtomico(arq, JSON.stringify({ fase: reg.fase, sessao: reg.sessao, rascunho: reg.rascunho, versao: reg.versao, desde: reg.desde }));
  } catch { /* sem o arquivo, o rascunho só vive na memória */ }
}
function encerrarRegistro(id) {
  const reg = registros.get(id);
  registros.delete(id);
  if (reg) { try { encerrarProcesso(reg.filho); } catch { /* já saiu */ } apagarCopia(reg.sessao); }
  salvarRegistro(id);
}
async function prepararRegistro(c, reg, prompt) {
  reg.fase = 'preparando';
  salvarRegistro(c.id);
  const r = await rodarRegistro(c, reg, prompt, 'registro');
  if (registros.get(c.id) !== reg) return; // descartado enquanto preparava
  if (!r.ok) {
    loja.anotarConversa(c.id, { quem: 'sistema', texto: `📝 O rascunho do registro não ficou pronto: ${r.motivo}` });
    if (reg.versao) { reg.fase = 'pronto'; salvarRegistro(c.id); } else encerrarRegistro(c.id); // ajuste que falhou: fica o rascunho anterior
    return;
  }
  reg.rascunho = E.cortar(r.texto, 20000);
  reg.versao += 1;
  reg.fase = 'pronto';
  salvarRegistro(c.id);
  loja.anotarConversa(c.id, { quem: 'sistema', texto: '📝 Rascunho do registro pronto: leia e aprove no popup (ou em 📝 Ver rascunho).' });
}
async function gravarRegistro(c, reg) {
  reg.fase = 'gravando';
  salvarRegistro(c.id);
  const r = await rodarRegistro(c, reg, promptRegistroGravar(c, cfgRegistro()), 'registro-gravar');
  if (registros.get(c.id) !== reg) return;
  if (r.ok) loja.anotarConversa(c.id, { quem: 'paralelo', texto: r.texto, registro: true });
  else loja.anotarConversa(c.id, { quem: 'sistema', texto: `📝 O registro não foi gravado: ${r.motivo}` });
  if (!r.ok || /^\W*não gravei/i.test(r.texto)) { reg.fase = 'pronto'; salvarRegistro(c.id); return; } // dá para aprovar de novo ou descartar
  encerrarRegistro(c.id);
}
function recuperarRegistros(c) {
  try {
    const r = JSON.parse(fs.readFileSync(loja.arquivoRun(c.id, 'registro.json'), 'utf8'));
    if (r && r.fase === 'pronto' && r.rascunho) registros.set(c.id, { fase: 'pronto', sessao: r.sessao || null, rascunho: r.rascunho, versao: r.versao || 1, desde: r.desde, filho: null });
  } catch { /* nenhum rascunho esperando */ }
}

function limparFilaDoTurno(id) {
  for (const a of [arqFila(id), arqEntregues(id), `${arqFila(id).replace(/\.json$/, '')}.trava`]) { try { fs.rmSync(a, { force: true }); } catch { /* já saiu */ } }
}
/** O que vai para a líder de cada item da fila quando o turno é cortado: o texto dele, ou o pedido inteiro (registro). */
const textoParaLider = (x) => (x.registro ? x.prompt : x.texto);
/** Entregou a fila à líder: as mensagens entram na conversa, na ordem em que foram escritas. */
function anotarFila(ctxId, fila) {
  for (const x of fila) if (x.texto) loja.anotarConversa(ctxId, { quem: 'voce', texto: x.texto });
}
const TIPO_FERRAMENTA = (() => {
  try { return require(path.join(RAIZ, '.claude', 'hooks', 'telemetria.js')); } catch { return { tipoAtividade: () => 'pensando', alvoAtividade: () => '' }; }
})();

function flagsTurno() {
  const cfg = config();
  const m = (cfg.modelos && cfg.modelos.orquestrador) || {};
  const g = cfg.gatilho || {};
  const out = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', g.permissionMode || 'auto'];
  if (m.model) out.push('--model', m.model);
  if (m.effort) out.push('--effort', m.effort);
  if (cfg.orcamento && cfg.orcamento.maxUsdPorTurno) out.push('--max-budget-usd', String(cfg.orcamento.maxUsdPorTurno));
  // skills instaladas na workspace repos/ (repos/.claude/skills): só o --add-dir faz o Claude carregá-las
  const reposDir = path.join(RAIZ, 'repos');
  if (fs.existsSync(path.join(reposDir, '.claude', 'skills'))) out.push('--add-dir', reposDir);
  if (Array.isArray(g.disallowedTools) && g.disallowedTools.length) out.push('--disallowedTools', ...g.disallowedTools);
  return out;
}

function promptInicial(c, nota) {
  return [
    `[orq] contexto=${c.id} origem=office`,
    `Você é o orquestrador deste projeto. Inicie o ciclo do fluxo "${c.fluxoId}" no repositório "${c.repo}" seguindo a skill /iniciar-fluxo.`,
    `O contexto já foi criado pelo Office com o id ${c.id}; use --contexto ${c.id} em todas as chamadas do estado.js.`,
    'Este turno roda pelo Office, sem terminal: toda pergunta ao usuário deve ser registrada com',
    `  node .claude/office/estado.js pergunta --contexto ${c.id} --tipo checkpoint|duvida|escolha --texto "..." --explicacao "..." --opcoes "A|B"`,
    'e, logo depois, você encerra o turno. A resposta chega no próximo turno.',
    nota ? `\nNota do usuário:\n<<<NOTA\n${nota}\nNOTA>>>` : '',
  ].join('\n');
}

const ehChat = (c) => c && c.fluxoId === E.FLUXO_CHAT;

/** Chat livre: o texto do usuário vai quase puro; a resposta é o texto final do turno. */
function promptChat(c, texto, primeiro) {
  return [
    primeiro ? `[orq] contexto=${c.id} origem=office tipo=chat` : `[orq] contexto=${c.id} tipo=chat${c.titulo ? ` título="${c.titulo}"` : ''} — nova mensagem do usuário pelo Office:`,
    ...(primeiro ? [
      'Chat livre com o usuário pelo Office, sem terminal: ele lê só o texto das suas mensagens. Responda direto, em português.',
      'Não inicie fluxo, não crie contexto nem spec a menos que ele peça. As regras do núcleo valem (push, MR, merge e deploy são dele).',
      'Se precisar que ele decida algo, pergunte no próprio texto e encerre o turno: a resposta chega na próxima mensagem. Não use o estado.js pergunta aqui.',
    ] : []),
    `<<<MENSAGEM\n${texto}\nMENSAGEM>>>`,
  ].join('\n');
}

function promptResposta(c, pergunta, texto) {
  return [
    `[orq] contexto=${c.id} — resposta do usuário pelo Office${pergunta ? ` à pergunta: "${pergunta.texto}"` : ''}`,
    `<<<RESPOSTA\n${texto}\nRESPOSTA>>>`,
    `Continue o ciclo. Novas perguntas: estado.js pergunta --contexto ${c.id} ... e encerre o turno.`,
  ].join('\n');
}

/** Correção: o usuário cortou o turno no meio (botão Corrigir) e manda o que mudou. */
function promptCorrecao(c, correcao, pendentes = [], interrompidos) {
  return [
    `[orq] contexto=${c.id}${ehChat(c) ? ' tipo=chat' : ''} — CORREÇÃO do usuário pelo Office: ele interrompeu o seu turno anterior no meio.`,
    'O turno anterior foi cortado: a última ação pode ter ficado pela metade. Antes de seguir, confira o que já foi feito (arquivos, comandos, estado.js) e não repita o que já saiu.',
    'A correção vale por cima da mensagem anterior dele. Se ela pede para desfazer algo que você já fez, diga o que foi feito e pergunte antes de desfazer.',
    ...(pendentes.length ? [`Mensagens que ele mandou durante o turno cortado (não chegaram a você):\n<<<MENSAGENS\n${pendentes.join('\n\n')}\nMENSAGENS>>>`] : []),
    `<<<CORRECAO\n${correcao}\nCORRECAO>>>`,
    ...blocoInterrompidos(interrompidos),
    ehChat(c) ? 'Responda direto no texto; se precisar que ele decida, pergunte e encerre o turno.' : `Para decidir algo com ele, use estado.js pergunta --contexto ${c.id} e encerre o turno.`,
  ].join('\n');
}

const ROTULO_BLOQUEIO = { decisao: 'decisão', acesso: 'acesso', credencial: 'credencial', area: 'outra área', outro: 'outra pendência' };
/** Desbloqueado: a líder confere a pendência e segue de onde parou. */
function promptDesbloqueio(c, nota) {
  const e = c.bloqueio || {};
  const quando = e.desde ? new Date(e.desde).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  return [
    `[orq] contexto=${c.id} origem=office — o contexto foi desbloqueado: o ENG diz que a pendência foi resolvida.`,
    `Estava bloqueado por (${ROTULO_BLOQUEIO[e.motivo] || 'pendência'}): ${e.texto || '(sem descrição)'}${e.quem ? ` · depende de: ${e.quem}` : ''}${quando ? ` · desde ${quando}` : ''}${e.por === 'lider' ? ' · bloqueado por você (líder)' : ' · bloqueado pelo ENG'}.`,
    ...(e.pergunta ? [`A pergunta que estava aberta: "${E.cortar(e.pergunta, 400)}"`] : []),
    nota ? `Mensagem do ENG:\n<<<MENSAGEM\n${nota}\nMENSAGEM>>>` : 'Ele só retomou, sem mensagem.',
    'Confira que a pendência está mesmo resolvida (o acesso funciona, o arquivo existe, a decisão está registrada; nunca leia valor de segredo) e siga de onde parou.',
    `Se ainda faltar algo, bloqueie de novo com node .claude/office/estado.js bloquear --contexto ${c.id} --motivo decisao|acesso|credencial|area|outro --texto "<o que falta>" --quem "<área ou pessoa>" e encerre o turno.`,
    ...((c.interrompidos || []).length ? blocoInterrompidos(c.interrompidos) : []),
  ].join('\n');
}

/** Agentes que estavam rodando agora (sem relatório): o que se perde se o turno for cortado. */
function agentesRodando(ctxId) {
  const c = contexto(ctxId);
  return c ? c.agents.filter((a) => a.status === 'WORKING').map((a) => ({ skill: a.skill, descricao: E.cortar(a.summary || '', 160), passo: a.passo || null })) : [];
}
/** Trecho do prompt de volta: quais agentes foram interrompidos e a regra para relançar só esses. */
function blocoInterrompidos(lista) {
  if (!Array.isArray(lista)) return [];
  if (!lista.length) return ['Nenhum agente estava rodando quando o turno foi cortado: não relance nenhum; siga do ponto em que parou.'];
  return [
    `Agentes que estavam rodando e foram interrompidos (não entregaram relatório):\n${lista.map((a) => `- ${a.skill}${a.passo ? ` (passo ${a.passo})` : ''}: ${a.descricao || 'sem descrição'}`).join('\n')}`,
    'Relance só estes, um de cada (nunca em dobro), e só depois de conferir o que cada um já deixou feito (git status, arquivos, estado.js): o que ficou pela metade se completa, não se refaz. Os que já entregaram relatório não rodam de novo.',
  ];
}

/** Mandar agora: o usuário cortou o turno para entregar as mensagens que estavam na fila (seta ➤). */
function promptFilaAgora(c, textos, interrompidos) {
  return [
    `[orq] contexto=${c.id}${ehChat(c) ? ' tipo=chat' : ''} — o usuário INTERROMPEU o seu turno pelo Office para mandar agora o que estava na fila:`,
    'O turno anterior foi cortado: a última ação pode ter ficado pela metade. Antes de seguir, confira o que já foi feito (arquivos, comandos, estado.js) e não repita o que já saiu.',
    `<<<MENSAGEM\n${textos.join('\n\n')}\nMENSAGEM>>>`,
    'A mensagem vale por cima do que você estava fazendo: leve em conta e siga a partir dela.',
    ...blocoInterrompidos(interrompidos),
    ehChat(c) ? 'Responda direto no texto; se precisar que ele decida, pergunte e encerre o turno.' : `Para decidir algo com ele, use estado.js pergunta --contexto ${c.id} e encerre o turno.`,
  ].join('\n');
}

/** Contextos cujo turno foi cortado pelo Corrigir sem texto: a próxima mensagem vai como correção. */
const aguardandoCorrecao = new Set();
/** Corrigir sem texto: quem estava rodando no corte, para ir junto com a correção que vier depois. */
const interrompidosNoCorte = new Map();

/** Contextos reativados sem mensagem (id → status de antes): a próxima mensagem vai com o aviso de reativação. */
const reativados = new Map();

/** Reativação: o contexto estava concluído ou parado e o usuário quer continuar a mesma sessão. */
function promptReativado(c, texto, anterior) {
  const atual = contexto(c.id);
  return [
    `[orq] contexto=${c.id} origem=office — o usuário REATIVOU este contexto pelo Office (estava ${anterior === 'PARADO' ? 'parado' : 'concluído'}) e mandou:`,
    `<<<MENSAGEM\n${texto}\nMENSAGEM>>>`,
    'O contexto voltou a ficar ativo no Office, na mesma sessão. Atenda o pedido dele a partir de onde a conversa parou: o que já foi concluído continua valendo, não refaça etapas.',
    ...(anterior === 'PARADO' ? blocoInterrompidos((atual && atual.interrompidos) || []) : []),
    `Para perguntar, use estado.js pergunta --contexto ${c.id} ... e encerre o turno. Quando terminar o que ele pediu, conclua de novo com estado.js contexto concluir --contexto ${c.id} --resumo "...".`,
  ].join('\n');
}

/** Só reativa missão do Office com sessão, sem outro contexto ativo no mesmo repo e com vaga (maxContextos). */
function checarReativacao(c) {
  const erro = (codigo, msg) => Object.assign(new Error(msg), { codigo });
  if (ehChat(c)) throw erro(409, 'chat salvo: reabra pelos Salvos, na tela de Chats');
  if (c.origem === 'terminal') throw erro(409, 'esta sessão é do seu terminal: continue por lá (claude --resume)');
  if (c.noTerminal) throw erro(409, 'este contexto está no terminal; devolva ao Office antes de reativar');
  if (!c.sessionId) throw erro(409, 'contexto sem sessão do Claude para continuar');
  const ativos = estadoProjetado().contextos.filter((x) => x.id !== c.id && !E.TERMINAIS.has(x.status));
  if (ativos.some((x) => x.repo === c.repo)) throw erro(409, `já há outro contexto ativo para ${c.repo}: conclua ou pare aquele antes de reativar este`);
  const missoes = ativos.filter((x) => !ehChat(x)).length;
  const max = config().maxContextos || 3;
  if (missoes >= max) throw erro(409, `já há ${missoes} contextos ativos (maxContextos ${max}): conclua ou pare um antes de reativar`);
}

/**
 * Encerra o processo do turno e tudo o que ele abriu (comandos, scripts das skills), para nada
 * continuar rodando depois do Parar ou do Corrigir. Sem `ps` (Windows nativo), só o processo do turno.
 */
function arvoreDe(filho) {
  const alvos = filho.pid ? [filho.pid] : [];
  if (WINDOWS) return alvos; // sem ps: no Windows, quem derruba a árvore é o taskkill /T (encerrarProcesso)
  try {
    const filhosDe = new Map();
    for (const l of execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8', timeout: 3000 }).split('\n')) {
      const [pid, ppid] = l.trim().split(/\s+/).map(Number);
      if (pid && ppid) { if (!filhosDe.has(ppid)) filhosDe.set(ppid, []); filhosDe.get(ppid).push(pid); }
    }
    for (let i = 0; i < alvos.length; i++) alvos.push(...(filhosDe.get(alvos[i]) || []));
  } catch { /* sem ps: só o processo do turno */ }
  return alvos;
}
/** Manda um sinal para o turno e tudo o que ele abriu. Devolve false se nem o processo do turno aceitou. */
function sinalizarArvore(filho, sinal) {
  if (WINDOWS) return false; // SIGSTOP/SIGCONT não existem no Windows: Pausar fica indisponível
  const alvos = arvoreDe(filho);
  let ok = false;
  for (const pid of alvos) { try { process.kill(pid, sinal); ok = true; } catch { /* já saiu ou sinal sem suporte */ } }
  return ok;
}
function encerrarProcesso(filho) {
  if (!filho) return;
  if (WINDOWS) {
    // o taskkill /T derruba o turno e tudo o que ele abriu (comandos, scripts das skills)
    try { if (filho.pid) execFileSync('taskkill', ['/PID', String(filho.pid), '/T', '/F'], { stdio: 'ignore', timeout: 8000, windowsHide: true }); }
    catch { try { filho.kill(); } catch { /* já saiu */ } }
    return;
  }
  const alvos = arvoreDe(filho);
  try { filho.kill('SIGTERM'); } catch { /* já saiu */ }
  for (const pid of alvos.slice(1)) { try { process.kill(pid, 'SIGTERM'); } catch { /* já saiu */ } }
  // pausado (SIGSTOP) só age no SIGTERM depois de acordar
  for (const pid of alvos) { try { process.kill(pid, 'SIGCONT'); } catch { /* já saiu */ } }
}

/** Depois que o turno cortado pelo Corrigir fechou: segue com a correção ou espera o usuário escrever. */
function seguirCorrecao(c, correcoes, motivo = 'corrigir', interrompidos) {
  const atual = contexto(c.id);
  const fila = respostasPendentes.get(c.id) || [];
  respostasPendentes.delete(c.id);
  espelharFila(c.id);
  if (!atual || E.TERMINAIS.has(atual.status)) return;
  if (atual.status === 'PAUSADO') loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'TRABALHANDO' }); // cortado enquanto dormia
  anotarFila(c.id, fila);
  const pendentes = fila.map(textoParaLider).filter(Boolean);
  if (motivo === 'fila' && (pendentes.length || correcoes.length)) {
    const textos = [...pendentes, ...correcoes]; // a fila e o que ele mandou pelo Corrigir enquanto o turno fechava
    if (atual.pergunta) loja.registrar({ tipo: 'pergunta.responder', contexto: c.id, texto: textos.join('\n'), por: 'office' });
    iniciarTurno(atual, promptFilaAgora(atual, textos, interrompidos), false);
    return;
  }
  if (!correcoes.length && !pendentes.length) {
    // só cortou: espera a correção. Se o agente já tinha deixado uma pergunta, ela fica (a resposta vai como correção).
    aguardandoCorrecao.add(c.id);
    interrompidosNoCorte.set(c.id, interrompidos);
    if (!atual.pergunta) loja.registrar({ tipo: 'pergunta.abrir', contexto: c.id, tipoPergunta: 'chat', texto: 'Turno interrompido: escreva a correção para continuar.', opcoes: [], silencioso: true });
    return;
  }
  // sem texto no Corrigir, a última mensagem da fila é a correção
  const correcao = correcoes.length ? correcoes.join('\n\n') : pendentes.pop();
  if (atual.pergunta) loja.registrar({ tipo: 'pergunta.responder', contexto: c.id, texto: correcao, por: 'office' });
  iniciarTurno(atual, promptCorrecao(atual, correcao, pendentes, interrompidos), false);
}

/*
 * Turno solto do servidor (decisão do ENG em 26/11/2026): o claude de cada turno roda DESACOPLADO do Office
 * (detached, em outra sessão de processo), com o prompt lido de um arquivo e a saída gravada em
 * runs/<ctx>/turno.out. O servidor só acompanha esse arquivo (lê os bytes novos a cada POLL_TURNO_MS) e guarda
 * em runs/<ctx>/turno.json o pid, o início do processo e até onde já leu. Reiniciar o servidor não derruba o turno:
 * ao subir, `recuperarAoIniciar` reanexa pelo turno.json e continua do offset (ou fecha o turno que terminou
 * enquanto o servidor estava fora). O Parar, o Pausar e o Corrigir continuam matando o turno de propósito.
 */
const POLL_TURNO_MS = 300;

const { statProcesso, turnoVivo } = E;
function lerMetaTurno(id) {
  try {
    const m = JSON.parse(fs.readFileSync(loja.arquivoRun(id, 'turno.json'), 'utf8'));
    return m && typeof m.offset === 'number' ? m : null;
  } catch { return null; }
}

/** Lança o claude solto: prompt por arquivo (stdin), saída e erro em arquivos. Devolve o filho (só para o 'exit') e o meta. */
function lancarTurnoSolto(c, argv, texto) {
  const f = (nome) => loja.arquivoRun(c.id, nome);
  fs.mkdirSync(path.dirname(f('turno.json')), { recursive: true });
  fs.writeFileSync(f('turno.prompt'), texto);
  fs.writeFileSync(f('turno.out'), '');
  fs.writeFileSync(f('turno.err'), '');
  const fds = [fs.openSync(f('turno.prompt'), 'r'), fs.openSync(f('turno.out'), 'a'), fs.openSync(f('turno.err'), 'a')];
  let filho;
  try {
    filho = iniciarClaude(argv, {
      cwd: RAIZ, env: { ...process.env, ORQ_CONTEXTO: c.id, ORQ_RAIZ: RAIZ, ORQ_FILA: arqFila(c.id) }, stdio: fds, detached: true,
      limiteSeg: Math.round(((config().turnos || {}).maxMinutos || 0) * 60),
    });
  } finally { for (const fd of fds) { try { fs.closeSync(fd); } catch { /* ok */ } } }
  filho.unref();
  const proc = statProcesso(filho.pid);
  const meta = { pid: filho.pid || 0, procInicio: proc ? proc.inicio : undefined, inicio: Date.now(), offset: 0, limiteSeg: Math.round(((config().turnos || {}).maxMinutos || 0) * 60) };
  fs.writeFileSync(f('turno.json'), JSON.stringify(meta));
  return { filho, meta };
}

/**
 * Acompanha um turno (novo ou reanexado): lê o turno.out, trata cada linha como antes e, quando o processo termina,
 * roda o fechamento. `filhoReal` só existe quando este servidor lançou o turno (dá o código de saída).
 */
function acompanharTurno(c, meta, filhoReal, opcoes = {}) {
  const id = c.id;
  const arqOut = loja.arquivoRun(id, 'turno.out');
  const arqErr = loja.arquivoRun(id, 'turno.err');
  const arqMeta = loja.arquivoRun(id, 'turno.json');
  const saida = fs.createWriteStream(loja.arquivoRun(id, 'stream.jsonl'), { flags: 'a' });
  const proxy = { pid: meta.pid, kill: (sinal) => process.kill(meta.pid, sinal) }; // mesma interface do ChildProcess para parar, pausar e corrigir
  const turno = { filho: proxy, resultado: null, stderr: '', parado: false, pausado: Boolean(opcoes.pausado), inicio: meta.inicio, saiu: null, timer: null, sujo: false };
  processos.set(id, turno);
  espelharFila(id); // mensagem que chegou entre um turno e outro
  anotarAtividade(id, 'lider', 'pensando', '');
  if (filhoReal) {
    filhoReal.on('exit', (cod) => { turno.saiu = cod == null ? 1 : cod; });
    filhoReal.on('error', (err) => {
      turno.stderr += err.code === 'ENOENT' ? 'claude não encontrado no PATH' : String(err.message);
      turno.saiu = -1;
    });
  }
  turno.salvar = (sincrono) => {
    turno.sujo = false;
    const dados = JSON.stringify(meta);
    if (sincrono) { try { fs.writeFileSync(arqMeta, dados); } catch { /* ok */ } } else fsp.writeFile(arqMeta, dados).catch(() => {});
  };

  const tratar = (linha) => {
    saida.write(linha + '\n');
    let m; try { m = JSON.parse(linha); } catch { return; }
    if (m.type === 'system' && m.subtype === 'init' && m.session_id && m.session_id !== c.sessionId) {
      loja.registrar({ tipo: 'contexto.sessao', contexto: id, sessionId: m.session_id });
    }
    if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
      const sub = m.parent_tool_use_id || null;
      for (const b of m.message.content) {
        if (b.type === 'tool_use') {
          anotarAtividade(id, sub || 'lider', TIPO_FERRAMENTA.tipoAtividade(b.name), TIPO_FERRAMENTA.alvoAtividade(b.name, b.input || {}));
        } else if (b.type === 'text' && b.text && b.text.trim() && !sub) {
          loja.registrar({ tipo: 'mensagem', contexto: id, texto: b.text });
          loja.anotarConversa(id, { quem: 'agente', texto: b.text });
          anotarAtividade(id, 'lider', 'pensando', '');
        }
      }
    }
    if (m.type === 'rate_limit_event') anotarLimitesDoStream(m.rate_limit_info);
    if (m.type === 'result') turno.resultado = m;
  };

  // lê só linhas completas (o offset avança até o último \n); `final` aceita a última linha sem \n
  let fd = null;
  const drenar = (final) => {
    let tam; try { tam = fs.statSync(arqOut).size; } catch { return; }
    if (tam <= meta.offset) return;
    if (fd === null) fd = fs.openSync(arqOut, 'r');
    const buf = Buffer.alloc(tam - meta.offset);
    const n = fs.readSync(fd, buf, 0, buf.length, meta.offset);
    if (!n) return;
    let fim = buf.lastIndexOf(10, n - 1) + 1;
    if (final && fim < n) fim = n;
    if (!fim) return;
    meta.offset += fim;
    turno.sujo = true;
    for (const l of buf.slice(0, fim).toString('utf8').split('\n')) if (l) tratar(l);
  };

  const fechar = () => {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ok */ } }
    saida.end();
    try { turno.stderr = (turno.stderr + fs.readFileSync(arqErr, 'utf8')).slice(-4000); } catch { /* sem erro gravado */ }
    for (const nome of ['turno.json', 'turno.prompt']) fs.rmSync(loja.arquivoRun(id, nome), { force: true }); // turno tratado: nada a reanexar
    const r = turno.resultado;
    const codigo = turno.saiu !== null ? turno.saiu : (r ? (r.is_error ? 1 : 0) : 1); // reanexado: sem código, vale o resultado
    absorverEntregues(id); // o que o gancho já entregou no meio do turno não vai de novo
    processos.delete(id);
    limparFilaDoTurno(id);
    anotarAtividade(id, 'lider', null);
    if (r) loja.registrar({ tipo: 'metricas', contexto: id, custoSessaoUsd: r.total_cost_usd || 0, duracaoMs: Date.now() - turno.inicio });
    if (turno.parado) return;
    if (turno.corrigir) { seguirCorrecao(c, turno.corrigir, turno.motivoCorte, turno.interrompidos); return; }
    const fila = respostasPendentes.get(id);
    if (fila && fila.length) {
      // o usuário escreveu enquanto o turno rodava/fechava: segue direto com o que ele mandou
      respostasPendentes.delete(id);
      anotarFila(id, fila);
      const agora = contexto(id);
      if (agora && agora.pergunta) loja.registrar({ tipo: 'pergunta.responder', contexto: id, texto: fila.map((x) => x.texto).join('\n'), por: 'office' });
      if (agora && agora.status === 'BLOQUEADO') loja.registrar({ tipo: 'contexto.status', contexto: id, status: 'TRABALHANDO', motivo: 'desbloqueado' }); // ele escreveu: segue
      iniciarTurno(c, fila.map((x) => x.prompt).join('\n\n'), false);
      return;
    }
    const atual = contexto(id);
    if (!atual) return;
    const textoFinal = (r && (r.result || r.subtype)) || '';
    const tudo = `${textoFinal}\n${turno.stderr}`;
    if (r && r.is_error && /usage limit|rate.?limit|hit your limit|\b429\b/i.test(tudo)) {
      loja.registrar({ tipo: 'contexto.status', contexto: id, status: 'PAUSADO_LIMITE', motivo: 'limite de uso atingido', interrompidos: agentesRodando(id) });
    } else if (!r || r.is_error || codigo !== 0) {
      const passouDoLimite = codigo === 124 || (!r && meta.limiteSeg > 0 && Date.now() - meta.inicio >= meta.limiteSeg * 1000);
      const motivo = passouDoLimite ? `turno passou do limite de ${Math.round(meta.limiteSeg / 60)} min (turnos.maxMinutos em orquestrador.json) e foi encerrado: clique em Retomar` : r && /budget/i.test(r.subtype || '') ? 'teto de US$ por turno atingido (orcamento.maxUsdPorTurno)' : E.cortar(textoFinal || turno.stderr || `claude saiu com código ${codigo}`, 300);
      loja.registrar({ tipo: 'contexto.status', contexto: id, status: 'ERRO', motivo, interrompidos: agentesRodando(id) });
      loja.anotarConversa(id, { quem: 'sistema', texto: `Turno terminou com erro: ${motivo}` });
    } else if (atual.status === 'TRABALHANDO' && !atual.pergunta && ehChat(atual)) {
      // chat: a resposta já está na conversa; só sinaliza que é a vez do usuário
      const linha = String(r.result || '').split('\n').map((x) => x.trim()).find(Boolean) || 'respondeu';
      loja.registrar({ tipo: 'pergunta.abrir', contexto: id, tipoPergunta: 'chat', texto: E.cortar(linha, 160), opcoes: [] });
    } else if (atual.status === 'TRABALHANDO' && !atual.pergunta) {
      // terminou o turno sem registrar pergunta nem concluir: quase sempre é só um resumo (ex.: um worker rodava em segundo plano).
      // Não é decisão do usuário: a líder segue sozinha (até MAX_AUTO_CONTINUACOES vezes seguidas); só depois vira um aviso de "status".
      const n = autoContinuacoes.get(id) || 0;
      if (n < MAX_AUTO_CONTINUACOES && !agentesRodando(id).length) {
        autoContinuacoes.set(id, n + 1);
        loja.anotarConversa(id, { quem: 'sistema', texto: 'A líder terminou o turno só com um resumo, sem pergunta nem conclusão. Ela segue sozinha para a próxima parte; você não precisa responder.' });
        iniciarTurno(atual, promptContinuar(atual, r.result), false, true);
      } else {
        // só status, sem decisão: o resumo já está na conversa. Fica em espera (sem cartão, pendência, som nem alerta); escrever retoma.
        autoContinuacoes.delete(id);
        loja.registrar({ tipo: 'contexto.status', contexto: id, status: 'EM_ESPERA', motivo: 'resumo' });
      }
    }
  };

  const tick = () => {
    const terminou = turno.saiu !== null || !turnoVivo(meta); // checa antes de ler: o que sobrar no arquivo ainda é lido
    try { drenar(false); } catch (e) { console.error('turno:', e.message); }
    if (terminou) {
      clearInterval(turno.timer);
      try { drenar(true); } catch (e) { console.error('turno:', e.message); }
      fechar();
    } else if (turno.sujo) turno.salvar(false);
  };
  turno.timer = setInterval(tick, POLL_TURNO_MS);
  return turno;
}

/*
 * Sessão nova por etapa (config `sessao.novaPorEtapa`, desligada por padrão): quando uma etapa do fluxo fecha, o
 * próximo turno abre uma sessão limpa do Claude em vez de reler a conversa inteira (a maior parte do custo é reler
 * contexto). Nada se perde porque o estado vive em arquivos; o prompt de passagem aponta para eles.
 */
const etapasFechadas = (c) => ((c.atlas && c.atlas.nodes) || []).filter((n) => n.status === 'DONE');
const arqSessao = (id) => loja.arquivoRun(id, 'sessao.json');
function lerSessaoMarca(id) { try { return JSON.parse(fs.readFileSync(arqSessao(id), 'utf8')); } catch { return null; } }
function marcarSessao(c) { try { fs.writeFileSync(arqSessao(c.id), JSON.stringify({ sessionId: c.sessionId, fechadasAoAbrir: etapasFechadas(c).length })); } catch { /* ok */ } }

function promptPassagem(c, fechadas) {
  const decididas = (c.decisoes || []).filter((d) => d.resposta).slice(-8)
    .map((d) => `- ${E.cortar(String(d.texto || ''), 160)} → ${E.cortar(String(d.resposta), 160)}`);
  return [
    `[orq] contexto=${c.id} origem=office — SESSÃO NOVA (troca por etapa, para economizar token). A conversa anterior NÃO está no seu contexto: o que vale está nos arquivos.`,
    `Retome por eles, sem refazer etapa concluída:`,
    `1. node .claude/office/estado.js status --contexto ${c.id}`,
    `2. a pasta do ciclo em specs/${c.repo}/ (spec.md, plano.md, tarefas.md) e o diário aprendizado/repos/${c.repo}.md`,
    `3. os relatórios de worker e verificador da pasta do ciclo.`,
    fechadas.length ? `Etapas concluídas até aqui:\n${fechadas.map((n) => `- ${n.id}${n.resumo ? `: ${E.cortar(String(n.resumo), 200)}` : ''}`).join('\n')}` : '',
    decididas.length ? `Decisões do ENG já dadas (as últimas):\n${decididas.join('\n')}` : '',
    'Se algo que você precisa não estiver nos arquivos, pergunte ao ENG em vez de supor. Antes de fechar a próxima etapa, grave as decisões novas no diário e no estado: a próxima sessão também começa limpa.',
    '',
  ].filter((x) => x !== '').join('\n');
}

/** Decide se este turno abre sessão nova. Só missão (chat não tem etapa) e só quando uma etapa fechou desde que a sessão abriu. */
function trocarSessaoSeCabe(c, texto, primeiro) {
  if (primeiro || ehChat(c) || !(config().sessao || {}).novaPorEtapa) return { c, texto, primeiro };
  const atual = contexto(c.id) || c;
  const fechadas = etapasFechadas(atual);
  const marca = lerSessaoMarca(c.id);
  if (!marca) { marcarSessao(atual); return { c, texto, primeiro }; } // primeira vez: só marca o ponto de partida
  if (fechadas.length <= marca.fechadasAoAbrir) return { c, texto, primeiro };
  const novaSessao = crypto.randomUUID();
  loja.registrar({ tipo: 'contexto.sessao', contexto: c.id, sessionId: novaSessao, rotacao: true });
  const novo = { ...(contexto(c.id) || c), sessionId: novaSessao };
  marcarSessao(novo);
  loja.anotarConversa(c.id, { quem: 'sistema', texto: `Sessão nova do Claude a partir daqui (${fechadas.length} etapa(s) fechada(s)): o contexto anterior foi deixado para trás e o estado vem dos arquivos do ciclo. Sessão antiga: claude --resume ${c.sessionId}` });
  return { c: novo, texto: `${promptPassagem(novo, fechadas)}\n${texto}`, primeiro: true };
}

/** Seguir sozinha quando o turno acaba só com um resumo (veja o fechamento do turno). */
const autoContinuacoes = new Map(); // contexto -> vezes seguidas sem o usuário falar
const MAX_AUTO_CONTINUACOES = 2;
function promptContinuar(c, ultimo) {
  return [
    `[orq] contexto=${c.id} origem=office — o seu turno terminou sem pergunta nem conclusão (último texto: "${E.cortar(String(ultimo || ''), 300)}"). Isso é só um resumo, não uma decisão do usuário.`,
    `Veja o que mudou desde então (node .claude/office/estado.js status --contexto ${c.id}, os relatórios dos workers, tarefas em segundo plano que terminaram) e siga o fluxo:`,
    `- chegou a um checkpoint ou portão: registre com estado.js pergunta e encerre o turno;`,
    `- terminou o ciclo: conclua com estado.js contexto concluir;`,
    `- ainda falta o resultado de algo: diga em uma linha o que espera e encerre.`,
    'Não repita o resumo anterior.',
  ].join('\n');
}

function iniciarTurno(c0, texto0, primeiro0, auto = false) {
  if (!auto) autoContinuacoes.delete(c0.id); // o usuário falou (ou outro motivo): zera a conta
  const { c, texto: texto1, primeiro } = trocarSessaoSeCabe(c0, texto0, primeiro0);
  let texto = texto1;
  if (primeiro0 && !ehChat(c)) marcarSessao(c);
  absorverRecados(c.id); // recado que acabou de chegar vai junto neste turno
  const recados = blocoRecadosGuardados(c.id);
  if (recados) texto = `${recados}\n${texto}`;
  const flags = flagsTurno();
  const argv = [...flags.slice(0, 1), ...(primeiro ? ['--session-id', c.sessionId] : ['--resume', c.sessionId]), ...flags.slice(1)];
  limparFilaDoTurno(c.id); // o que ficou de um turno anterior não vale para este
  const { filho, meta } = lancarTurnoSolto(c, argv, texto);
  acompanharTurno(c, meta, filho);
}

function chatDe(corpo) {
  const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
  if (!c || !ehChat(c)) throw Object.assign(new Error('chat não encontrado'), { codigo: 404 });
  return c;
}
function checarVagaChat(id) {
  const max = config().maxChats || 3;
  const abertos = estadoProjetado().contextos.filter((x) => ehChat(x) && x.id !== id && !E.TERMINAIS.has(x.status)).length;
  if (abertos >= max) throw Object.assign(new Error(`já há ${max} chats abertos (maxChats): salve um antes de abrir outro`), { codigo: 409 });
}

/** Simulação do chat: responde com um texto fixo, sem Claude. */
function simularChat(c, msg) {
  setTimeout(() => {
    const t = `(simulação) Recebi: "${E.cortar(msg, 120)}". No modo real, quem responde aqui é o Claude, na pasta do orquestrador.`;
    loja.registrar({ tipo: 'mensagem', contexto: c.id, texto: t });
    loja.anotarConversa(c.id, { quem: 'agente', texto: t });
    loja.registrar({ tipo: 'pergunta.abrir', contexto: c.id, tipoPergunta: 'chat', texto: 'respondeu (simulação)', opcoes: [] });
  }, 1500);
}

function recuperarAoIniciar() {
  if (SIMULAR) return;
  for (const c of estadoProjetado().contextos) {
    const solto = c.origem === 'office' && (c.status === 'TRABALHANDO' || c.status === 'PAUSADO') ? lerMetaTurno(c.id) : null;
    if (solto) {
      // o turno rodou solto do servidor: reanexa e continua do offset (ou fecha o que terminou enquanto o servidor estava fora)
      recuperarRegistros(c);
      acompanharTurno(c, solto, null, { pausado: c.status === 'PAUSADO' });
      loja.anotarConversa(c.id, { quem: 'sistema', texto: 'O servidor reiniciou; o turno continuou rodando e foi reanexado.' });
      continue;
    }
    limparFilaDoTurno(c.id); // espelho de um turno que morreu com o servidor
    recuperarRegistros(c); // rascunho do 📝 Registrar que esperava aprovação
    absorverRecados(c.id); // decisão encaminhada pela conversa paralela pouco antes de reiniciar: vai no próximo turno
    if (c.origem === 'office' && (c.status === 'TRABALHANDO' || c.status === 'PAUSADO')) {
      const motivo = c.status === 'PAUSADO' ? 'o servidor reiniciou com o contexto pausado — clique em Retomar' : 'o servidor reiniciou no meio do turno — clique em Retomar';
      loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'ERRO', motivo, interrompidos: agentesRodando(c.id) });
    }
  }
}

/* ------------------------------------------------------------------ rotas */

const TIPOS_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

function enviar(res, status, corpo, tipo = 'application/json; charset=utf-8') {
  const dados = typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo);
  res.writeHead(status, { 'Content-Type': tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(dados);
}
const falha = (res, status, mensagem) => enviar(res, status, { erro: mensagem });

function hostLocal(req) {
  const h = String(req.headers.host || '');
  return h === `localhost:${PORTA}` || h === `127.0.0.1:${PORTA}` || h === `[::1]:${PORTA}`;
}
function autorizado(req) {
  const origem = req.headers.origin;
  const origemOk = !origem || [`http://localhost:${PORTA}`, `http://127.0.0.1:${PORTA}`, `http://[::1]:${PORTA}`].includes(origem);
  const tok = String(req.headers['x-orq-token'] || '');
  return origemOk && tok.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(TOKEN));
}

function lerCorpo(req, max = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on('data', (p) => { tam += p.length; if (tam > max) { reject(Object.assign(new Error('corpo grande demais'), { codigo: 413 })); req.destroy(); } else partes.push(p); });
    req.on('end', () => { try { resolve(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('JSON inválido'), { codigo: 400 })); } });
    req.on('error', reject);
  });
}

function servirEstatico(req, res, rota) {
  const rel = rota === '/' ? 'index.html' : decodeURIComponent(rota.slice(1));
  const item = ESTATICOS.includes(rel) && cache.estaticos.get(rel);
  if (!item) return falha(res, 404, 'não encontrado');
  enviar(res, 200, item.dados, TIPOS_MIME[path.extname(rel)] || 'application/octet-stream');
}

const TEXTO_MAX = 8000;
function texto(v, campo, max = TEXTO_MAX) {
  if (typeof v !== 'string' || !v.trim()) throw Object.assign(new Error(`informe ${campo}`), { codigo: 400 });
  if (v.length > max) throw Object.assign(new Error(`${campo} passa de ${max} caracteres`), { codigo: 400 });
  return v.trim();
}

const IMAGENS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const MAX_IMAGEM = 8 * 1024 * 1024;
/** Confere os primeiros bytes: o tipo declarado pelo navegador não basta. */
function imagemValida(buf, ext) {
  if (ext === 'png') return buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG';
  if (ext === 'jpg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (ext === 'gif') return buf.toString('latin1', 0, 4) === 'GIF8';
  return buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
}

const acoes = {
  /** Guarda a imagem colada ou escolhida no chat e devolve o caminho (relativo à raiz) que a líder abre com o Read. */
  async imagem(corpo) {
    const ext = IMAGENS[String(corpo.tipo || '')];
    if (!ext) throw Object.assign(new Error('só png, jpg, gif ou webp'), { codigo: 400 });
    if (typeof corpo.dados !== 'string' || !corpo.dados) throw Object.assign(new Error('imagem vazia'), { codigo: 400 });
    const buf = Buffer.from(corpo.dados, 'base64');
    if (!buf.length) throw Object.assign(new Error('imagem vazia'), { codigo: 400 });
    if (buf.length > MAX_IMAGEM) throw Object.assign(new Error('a imagem passa de 8 MB'), { codigo: 413 });
    if (!imagemValida(buf, ext)) throw Object.assign(new Error('o arquivo não é uma imagem válida'), { codigo: 400 });
    const nome = `${E.carimbo()}-${crypto.randomBytes(3).toString('hex')}.${ext}`; // nome gerado aqui: nada do usuário vai para o caminho
    const dir = path.join(DADOS, 'imagens');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, nome), buf);
    return { caminho: path.relative(RAIZ, path.join(dir, nome)).split(path.sep).join('/'), url: `/imagens/${nome}` };
  },

  async trigger(corpo) {
    const cfg = config();
    if (!SIMULAR && cfg.gatilho && cfg.gatilho.habilitado === false) throw Object.assign(new Error('gatilho desligado em orquestrador.json (gatilho.habilitado)'), { codigo: 403 });
    const cat = catalogo();
    const fluxoId = texto(corpo.fluxoId, 'fluxoId', 80);
    const repo = texto(corpo.repo, 'repo', 120);
    const fl = cat.fluxos.find((f) => f.id === fluxoId);
    if (!fl) throw Object.assign(new Error(fluxoId === E.FLUXO_CHAT ? 'chat livre se abre pelo botão Novo chat' : `fluxo desconhecido: ${fluxoId}`), { codigo: 400 });
    if (fl.alvo === 'jira') {
      if (!/^[A-Z][A-Z0-9]+-\d+$/.test(repo)) throw Object.assign(new Error(`este fluxo é por card do Jira: informe a chave (ex.: PROJ-123), não ${repo}`), { codigo: 400 });
    } else if (!cat.repos.includes(repo)) throw Object.assign(new Error(`repo fora da lista (precisa existir em repos/): ${repo}`), { codigo: 400 });
    const nota = corpo.nota ? texto(corpo.nota, 'nota', 2000) : '';
    const sessionId = crypto.randomUUID();
    const id = E.criarContexto(loja, { repo, fluxoId, origem: SIMULAR ? 'simulacao' : 'office', sessionId, fluxos: fluxos(), config: cfg });
    if (nota) loja.anotarConversa(id, { quem: 'voce', texto: nota });
    const c = contexto(id);
    if (SIMULAR) sim.iniciar(c, fluxos()[fluxoId], corpo.cenas || ['guarda']);
    else iniciarTurno(c, promptInicial(c, nota), true);
    return { contextoId: id };
  },

  /** Chat livre: abre um contexto sem fluxo nem repositório e manda a primeira mensagem. */
  async chat(corpo) {
    const msg = texto(corpo.texto, 'texto');
    const titulo = corpo.titulo ? texto(corpo.titulo, 'titulo', 60) : msg.split(/\s+/).slice(0, 6).join(' ');
    const repo = `chat-${E.slug(titulo).slice(0, 40) || 'conversa'}`;
    const sessionId = crypto.randomUUID();
    let id;
    try { id = E.criarContexto(loja, { repo, fluxoId: E.FLUXO_CHAT, origem: SIMULAR ? 'simulacao' : 'office', sessionId, fluxos: fluxos(), config: config() }); }
    catch (err) {
      if (err.codigo === 409 && /repo/.test(err.message)) id = E.criarContexto(loja, { repo: `${repo}-${E.carimbo().slice(-6)}`, fluxoId: E.FLUXO_CHAT, origem: SIMULAR ? 'simulacao' : 'office', sessionId, fluxos: fluxos(), config: config() });
      else throw err;
    }
    loja.registrar({ tipo: 'contexto.renomear', contexto: id, titulo: E.cortar(titulo, 60) }); // título com acentos (o id usa o slug)
    loja.registrar({ tipo: 'mensagem.usuario', contexto: id, texto: msg });
    loja.anotarConversa(id, { quem: 'voce', texto: msg });
    const c = contexto(id);
    if (SIMULAR) simularChat(c, msg);
    else iniciarTurno(c, promptChat(c, msg, true), true);
    return { contextoId: id };
  },

  /** Renomeia um chat (o título aparece na aba e na lista). */
  async 'chat-renomear'(corpo) {
    const c = chatDe(corpo);
    const titulo = texto(corpo.titulo, 'titulo', 60);
    loja.registrar({ tipo: 'contexto.renomear', contexto: c.id, titulo });
    return { ok: true };
  },

  /** Salva e fecha a aba: o chat sai das abas, fica em "salvos" e libera a vaga (maxChats). */
  async 'chat-salvar'(corpo) {
    const c = chatDe(corpo);
    if (processos.has(c.id)) throw Object.assign(new Error('o orquestrador ainda está respondendo neste chat; salve quando ele terminar'), { codigo: 409 });
    if (c.status !== 'PARADO') loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'PARADO', motivo: 'salvo' });
    aguardandoCorrecao.delete(c.id);
    return { ok: true };
  },

  /** Reabre um chat salvo numa aba, sem mandar mensagem. */
  async 'chat-reabrir'(corpo) {
    const c = chatDe(corpo);
    if (c.status !== 'PARADO') return { ok: true };
    checarVagaChat(c.id);
    loja.registrar({ tipo: 'pergunta.abrir', contexto: c.id, tipoPergunta: 'chat', texto: 'reaberto: escreva para continuar', opcoes: [], silencioso: true });
    return { ok: true };
  },

  /** Exclui o chat da lista (a conversa fica no histórico do Claude Code). */
  async 'chat-excluir'(corpo) {
    const c = chatDe(corpo);
    if (processos.has(c.id)) throw Object.assign(new Error('o orquestrador ainda está respondendo neste chat; exclua quando ele terminar'), { codigo: 409 });
    if (c.status !== 'PARADO') loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'PARADO', motivo: 'excluído' });
    aguardandoCorrecao.delete(c.id);
    loja.registrar({ tipo: 'contexto.dispensar', contexto: c.id });
    return { ok: true };
  },

  async responder(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    if (c.status !== 'PRECISA_DE_VOCE') throw Object.assign(new Error(`o contexto não está esperando resposta (status ${c.status})`), { codigo: 409 });
    if (c.noTerminal) throw Object.assign(new Error('este contexto está no terminal; devolva ao Office antes de responder por aqui'), { codigo: 409 });
    const resposta = texto(corpo.texto, 'texto');
    const pergunta = c.pergunta;
    loja.registrar({ tipo: 'pergunta.responder', contexto: c.id, texto: resposta, por: 'office' });
    if (SIMULAR || !processos.has(c.id)) loja.anotarConversa(c.id, { quem: 'voce', texto: resposta }); // na fila, entra na conversa ao ser entregue
    if (SIMULAR) {
      if (ehChat(c)) { loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'TRABALHANDO' }); simularChat(c, resposta); return { ok: true }; }
      if (!sim.responder(c.id, resposta)) loja.anotarConversa(c.id, { quem: 'sistema', texto: '(simulação: ninguém estava esperando essa resposta)' });
      return { ok: true };
    }
    const anteriorReativado = reativados.get(c.id);
    reativados.delete(c.id);
    const promptR = anteriorReativado ? promptReativado(c, resposta, anteriorReativado)
      : aguardandoCorrecao.delete(c.id) ? promptCorrecao(c, resposta, [], interrompidosNoCorte.get(c.id))
        : ehChat(c) ? promptChat(c, resposta, false) : promptResposta(c, pergunta, resposta);
    if (processos.has(c.id)) {
      // o agente registrou a pergunta e o processo ainda está fechando: enfileira
      enfileirarMensagem(c.id, promptR, resposta);
      return { ok: true, enfileirada: true };
    }
    iniciarTurno(c, promptR, false);
    return { ok: true };
  },

  /** Mensagem livre, a qualquer momento: vira resposta, entra na fila do turno ou retoma com a instrução. */
  async mensagem(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    if (c.status === 'PRECISA_DE_VOCE') return acoes.responder(corpo);
    if (c.status === 'BLOQUEADO' && !processos.has(c.id)) return acoes.desbloquear(corpo); // escrever num bloqueado = resolvi, pode seguir
    if (ehChat(c) && c.status === 'PARADO') {
      // chat salvo: escrever nele reabre a conversa (mesma sessão do Claude)
      checarVagaChat(c.id);
      const msgR = texto(corpo.texto, 'texto');
      loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'TRABALHANDO' });
      loja.registrar({ tipo: 'mensagem.usuario', contexto: c.id, texto: msgR });
      loja.anotarConversa(c.id, { quem: 'voce', texto: msgR });
      if (SIMULAR) simularChat(c, msgR); else iniciarTurno(c, [promptChat(c, msgR, false), ...((c.interrompidos || []).length ? blocoInterrompidos(c.interrompidos) : [])].join('\n'), false);
      return { ok: true, reaberto: true };
    }
    if (E.TERMINAIS.has(c.status)) return acoes.reativar(corpo); // concluído ou parado: escrever reativa na mesma sessão
    if (c.noTerminal) throw Object.assign(new Error('este contexto está no terminal; devolva ao Office antes de escrever por aqui'), { codigo: 409 });
    if (c.origem === 'terminal') throw Object.assign(new Error('esta sessão está aberta no seu terminal: escreva por lá'), { codigo: 409 });
    const msg = texto(corpo.texto, 'texto');
    loja.registrar({ tipo: 'mensagem.usuario', contexto: c.id, texto: msg });
    if (SIMULAR || !processos.has(c.id)) loja.anotarConversa(c.id, { quem: 'voce', texto: msg }); // na fila, entra na conversa ao ser entregue
    if (SIMULAR) { sim.mensagem(c.id, msg); return { ok: true }; }
    const prompt = promptMensagem(c, msg);
    if (processos.has(c.id)) { enfileirarMensagem(c.id, prompt, msg); return { ok: true, enfileirada: true }; }
    const voltando = ['PAUSADO_LIMITE', 'ERRO', 'EM_ESPERA'].includes(c.status);
    if (voltando) loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'TRABALHANDO' });
    iniciarTurno(c, voltando && c.status !== 'EM_ESPERA' ? [prompt, ...blocoInterrompidos(c.interrompidos || [])].join('\n') : prompt, false);
    return { ok: true };
  },

  async retomar(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    if (c.status === 'BLOQUEADO') return acoes.desbloquear({ contextoId: c.id });
    if (!['PAUSADO', 'PAUSADO_LIMITE', 'ERRO'].includes(c.status)) throw Object.assign(new Error(`só dá para retomar contexto pausado ou com erro (status ${c.status})`), { codigo: 409 });
    const turno = processos.get(c.id);
    if (c.status === 'PAUSADO' && turno && turno.pausado) {
      // acorda a líder e os agentes exatamente onde estavam: nada é relançado
      sinalizarArvore(turno.filho, 'SIGCONT');
      turno.pausado = false;
      loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'TRABALHANDO' });
      loja.anotarConversa(c.id, { quem: 'sistema', texto: 'Retomado por você: a líder e os agentes continuam de onde estavam.' });
      return { ok: true, acordou: true };
    }
    if (turno) throw Object.assign(new Error('ainda há um turno rodando neste contexto'), { codigo: 409 });
    loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'TRABALHANDO' });
    loja.anotarConversa(c.id, { quem: 'voce', texto: '(retomar)' });
    if (SIMULAR) {
      if (!sim.retomar(c.id)) sim.iniciar(contexto(c.id), fluxos()[c.fluxoId], []);
    } else {
      iniciarTurno(c, [
        `[orq] contexto=${c.id} — o usuário pediu para retomar. Continue de onde parou${c.motivo ? ` (motivo da parada: ${c.motivo})` : ''}.`,
        ...blocoInterrompidos(c.interrompidos || []),
      ].join('\n'), false);
    }
    return { ok: true };
  },

  /**
   * Pausar: congela a líder e os agentes onde estão (SIGSTOP no turno e em tudo o que ele abriu).
   * Eles aparecem dormindo; o Retomar acorda (SIGCONT) e continua do ponto exato, sem relançar nada.
   */
  async pausar(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    const turno = processos.get(c.id);
    if (WINDOWS) throw Object.assign(new Error('Pausar não existe no Windows sem WSL (não há SIGSTOP): use ⛔ Bloquear ou Parar'), { codigo: 409 });
    if (!turno || SIMULAR) throw Object.assign(new Error('não há turno rodando para pausar'), { codigo: 409 });
    if (turno.pausado) return { ok: true };
    if (turno.corrigir || turno.parado) throw Object.assign(new Error('o turno já está sendo interrompido'), { codigo: 409 });
    if (!sinalizarArvore(turno.filho, 'SIGSTOP')) throw Object.assign(new Error('este sistema não permite pausar o processo (use Parar)'), { codigo: 409 });
    turno.pausado = true;
    loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'PAUSADO', motivo: 'pausado por você' });
    loja.anotarConversa(c.id, { quem: 'sistema', texto: 'Pausado por você: a líder e os agentes ficam dormindo onde estão. Clique em Retomar para continuar do mesmo ponto.' });
    return { ok: true };
  },

  async parar(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    if (E.TERMINAIS.has(c.status)) throw Object.assign(new Error('o contexto já terminou'), { codigo: 409 });
    const turno = processos.get(c.id);
    const interrompidos = agentesRodando(c.id);
    absorverEntregues(c.id);
    if (turno) { turno.parado = true; encerrarProcesso(turno.filho); }
    const naoEntregues = respostasPendentes.get(c.id) || [];
    respostasPendentes.delete(c.id);
    if (naoEntregues.length) loja.anotarConversa(c.id, { quem: 'sistema', texto: `Mensagens que estavam na fila e não foram entregues (o contexto parou):\n\n${naoEntregues.map((x) => `- ${x.texto}`).join('\n')}` });
    aguardandoCorrecao.delete(c.id);
    reativados.delete(c.id);
    if (SIMULAR) sim.parar(c.id);
    loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'PARADO', motivo: 'parado pelo usuário', interrompidos });
    loja.anotarConversa(c.id, { quem: 'sistema', texto: 'Contexto parado por você.' });
    anotarAtividade(c.id, 'lider', null);
    return { ok: true };
  },

  /**
   * ⛔ Bloquear: o contexto aguarda uma pendência externa (decisão de alguém, acesso, outra coisa). Sai da baia
   * para a área de bloqueados, não conta como "esperando você" nem ocupa vaga. Com turno rodando (ou pausado), o turno
   * é encerrado e os agentes em andamento ficam anotados para a líder relançar só eles ao desbloquear.
   */
  async bloquear(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    if (E.TERMINAIS.has(c.status)) throw Object.assign(new Error('o contexto já terminou'), { codigo: 409 });
    if (ehChat(c)) throw Object.assign(new Error('chat não se bloqueia: salve o chat e reabra depois'), { codigo: 409 });
    const motivo = ['decisao', 'acesso', 'credencial', 'area', 'outro'].includes(corpo.motivo) ? corpo.motivo : 'outro';
    const t = E.cortar(texto(corpo.texto, 'texto'), 600).replace(/[.\s]+$/, '');
    const quem = typeof corpo.quem === 'string' && corpo.quem.trim() ? E.cortar(corpo.quem.trim(), 120) : null;
    const turno = processos.get(c.id);
    const interrompidos = turno ? agentesRodando(c.id) : null;
    absorverEntregues(c.id);
    if (turno) {
      turno.parado = true;
      if (turno.pausado) { sinalizarArvore(turno.filho, 'SIGCONT'); turno.pausado = false; } // acorda para conseguir encerrar
      encerrarProcesso(turno.filho);
    }
    const naoEntregues = respostasPendentes.get(c.id) || [];
    respostasPendentes.delete(c.id);
    if (naoEntregues.length) loja.anotarConversa(c.id, { quem: 'sistema', texto: `Mensagens que estavam na fila e não foram entregues (o contexto foi bloqueado):\n\n${naoEntregues.map((x) => `- ${x.texto}`).join('\n')}` });
    aguardandoCorrecao.delete(c.id);
    reativados.delete(c.id);
    if (SIMULAR) sim.parar(c.id);
    const jaEstava = c.status === 'BLOQUEADO';
    loja.registrar({ tipo: 'contexto.bloqueio', contexto: c.id, motivo, texto: t, ...(quem ? { quem } : {}), por: 'voce', ...(interrompidos ? { interrompidos } : {}) });
    loja.anotarConversa(c.id, { quem: 'sistema', bloqueio: true, texto: jaEstava ? `⛔ Pendência atualizada (${ROTULO_BLOQUEIO[motivo]}${quem ? `, de ${quem}` : ''}): ${t}`
      : `⛔ Bloqueado (${ROTULO_BLOQUEIO[motivo]}${quem ? `, de ${quem}` : ''}): ${t}. O contexto foi para a sala de bloqueados${turno ? ' e o turno em andamento foi encerrado' : ''}. Quando resolver, escreva aqui: a líder confere e retoma de onde parou.` });
    anotarAtividade(c.id, 'lider', null);
    return { ok: true };
  },

  /** Desbloquear: volta para uma baia e a líder retoma com a mensagem (opcional) do ENG. */
  async desbloquear(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    if (c.status !== 'BLOQUEADO') throw Object.assign(new Error(`o contexto não está bloqueado (status ${c.status})`), { codigo: 409 });
    if (processos.has(c.id)) throw Object.assign(new Error('ainda há um turno fechando neste contexto; tente de novo em instantes'), { codigo: 409 });
    const nota = typeof corpo.texto === 'string' && corpo.texto.trim() ? texto(corpo.texto, 'texto') : '';
    const prompt = promptDesbloqueio(c, nota);
    loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'TRABALHANDO', motivo: 'desbloqueado' }); // devolve uma baia
    if (nota) { loja.registrar({ tipo: 'mensagem.usuario', contexto: c.id, texto: nota }); loja.anotarConversa(c.id, { quem: 'voce', texto: nota }); }
    loja.anotarConversa(c.id, { quem: 'sistema', texto: '✅ Desbloqueado: a pendência foi resolvida e a líder retoma de onde parou.' });
    if (SIMULAR) { if (!sim.retomar(c.id)) sim.iniciar(contexto(c.id), fluxos()[c.fluxoId], []); return { ok: true }; }
    iniciarTurno(contexto(c.id), prompt, false);
    return { ok: true };
  },

  /**
   * Corrigir: corta o turno que está rodando (como o Esc no terminal) e manda a correção no lugar.
   * Sem texto, só corta e espera a correção. Sem turno rodando, o texto vai como mensagem normal.
   */
  async corrigir(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    const msg = typeof corpo.texto === 'string' && corpo.texto.trim() ? texto(corpo.texto, 'texto') : '';
    const turno = processos.get(c.id);
    if (!turno) {
      if (msg) return acoes.mensagem({ ...corpo, texto: msg });
      throw Object.assign(new Error('não há turno rodando para interromper: escreva a mensagem e envie'), { codigo: 409 });
    }
    if (!turno.corrigir) {
      turno.corrigir = [];
      turno.interrompidos = agentesRodando(c.id);
      loja.anotarConversa(c.id, { quem: 'sistema', texto: 'Turno interrompido por você para corrigir.' });
      anotarAtividade(c.id, 'lider', null);
      encerrarProcesso(turno.filho);
    }
    if (msg) {
      turno.corrigir.push(msg); // o turno já está fechando: a correção segue assim que ele sair
      loja.registrar({ tipo: 'mensagem.usuario', contexto: c.id, texto: msg });
      loja.anotarConversa(c.id, { quem: 'voce', texto: msg });
    }
    return { ok: true, interrompido: true };
  },

  /**
   * 📝 Registrar: uma cópia da sessão onde o ENG clicou prepara o rascunho, em paralelo (nada para). O rascunho
   * aparece num popup; só com o "Aprovar" a cópia grava (registro-aprovar). Ajustar refaz, Descartar joga fora.
   */
  async registrar(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    if (c.origem === 'terminal') throw Object.assign(new Error('esta sessão é do seu terminal: registre por lá'), { codigo: 409 });
    if (c.noTerminal) throw Object.assign(new Error('este contexto está no terminal; devolva ao Office antes de registrar'), { codigo: 409 });
    const atual = registros.get(c.id);
    if (atual) return { ok: true, fase: atual.fase, jaExistia: true };
    if (!c.sessionId) throw Object.assign(new Error('esta conversa ainda não tem sessão do Claude: ainda não há o que registrar'), { codigo: 409 });
    loja.registrar({ tipo: 'registro.pedido', contexto: c.id });
    const reg = { fase: 'preparando', sessao: null, rascunho: '', versao: 0, desde: new Date().toISOString(), filho: null };
    registros.set(c.id, reg);
    loja.anotarConversa(c.id, { quem: 'voce', texto: '📝 Registrar o que foi feito até aqui', registro: true });
    prepararRegistro(c, reg, promptRegistroPreparar(c, cfgRegistro())).catch((e) => {
      encerrarRegistro(c.id);
      loja.anotarConversa(c.id, { quem: 'sistema', texto: `📝 O registro não abriu: ${e.message}` });
    });
    return { ok: true, fase: 'preparando' };
  },

  /** Aprovou o rascunho no popup: a mesma cópia grava (só a versão que ele leu). */
  async 'registro-aprovar'(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    const reg = registros.get(c.id);
    if (!reg || reg.fase !== 'pronto') throw Object.assign(new Error('não há rascunho de registro esperando aprovação'), { codigo: 409 });
    if (corpo.versao != null && Number(corpo.versao) !== reg.versao) throw Object.assign(new Error('o rascunho mudou desde que você abriu: leia a versão nova'), { codigo: 409 });
    loja.anotarConversa(c.id, { quem: 'voce', texto: '📝 Aprovei o rascunho do registro: pode gravar.', registro: true });
    gravarRegistro(c, reg).catch((e) => { reg.fase = 'pronto'; salvarRegistro(c.id); loja.anotarConversa(c.id, { quem: 'sistema', texto: `📝 O registro não foi gravado: ${e.message}` }); });
    return { ok: true };
  },

  /** Pediu ajuste no rascunho: a cópia refaz com o que ele escreveu (ainda sem gravar). */
  async 'registro-ajustar'(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    const ajuste = texto(corpo.texto, 'texto');
    const reg = registros.get(c.id);
    if (!reg || reg.fase !== 'pronto') throw Object.assign(new Error('não há rascunho de registro para ajustar'), { codigo: 409 });
    loja.anotarConversa(c.id, { quem: 'voce', texto: `📝 Ajuste no rascunho: ${ajuste}`, registro: true });
    prepararRegistro(c, reg, SIMULAR ? '' : promptRegistroAjustar(c, ajuste)).catch((e) => { reg.fase = 'pronto'; salvarRegistro(c.id); loja.anotarConversa(c.id, { quem: 'sistema', texto: `📝 O ajuste não rodou: ${e.message}` }); });
    return { ok: true };
  },

  /** Descartou: nada é gravado e a cópia some (também no meio do preparo). */
  async 'registro-descartar'(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    const reg = registros.get(c.id);
    if (!reg) return { ok: true, vazio: true };
    if (reg.fase === 'gravando') throw Object.assign(new Error('o registro já está sendo gravado: espere terminar'), { codigo: 409 });
    encerrarRegistro(c.id);
    loja.anotarConversa(c.id, { quem: 'sistema', texto: '📝 Registro descartado: nada foi gravado.' });
    return { ok: true };
  },

  /**
   * Conversa paralela: com a líder trabalhando (ou pausada), uma cópia dela responde na hora, sem interromper.
   * As decisões que você der ali ela encaminha à líder, que recebe no próximo passo. Sem turno rodando, vira mensagem normal.
   */
  async paralelo(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    const msg = texto(corpo.texto, 'texto');
    if (c.noTerminal || c.origem === 'terminal') throw Object.assign(new Error('esta sessão está no terminal: converse por lá'), { codigo: 409 });
    if (SIMULAR) {
      loja.anotarConversa(c.id, { quem: 'voce', texto: msg, paralelo: true });
      setTimeout(() => loja.anotarConversa(c.id, { quem: 'paralelo', texto: `(simulação) Recebi: "${E.cortar(msg, 120)}". No modo real, uma cópia da líder responde aqui enquanto ela segue trabalhando.` }), 1200);
      return { ok: true };
    }
    if (!processos.has(c.id)) return acoes.mensagem({ ...corpo, texto: msg }); // a líder já está livre: fala direto com ela
    if (!c.sessionId) throw Object.assign(new Error('a líder ainda não tem sessão do Claude para copiar; tente em instantes'), { codigo: 409 });
    loja.anotarConversa(c.id, { quem: 'voce', texto: msg, paralelo: true });
    const p = paralelos.get(c.id);
    if (p) { p.fila.push(msg); return { ok: true, naFila: true }; }
    pedirParalelo(c, [msg]);
    return { ok: true };
  },

  /**
   * ✕ numa mensagem da fila: cancela o envio, se a líder ainda não recebeu. Pega a mesma trava do gancho
   * recado.js, para não cancelar algo que ele está entregando agora.
   */
  async 'fila-cancelar'(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    const itemId = texto(corpo.itemId, 'itemId', 40);
    const jaFoi = () => Object.assign(new Error('a líder já recebeu esta mensagem: não dá mais para cancelar'), { codigo: 409 });
    const trava = `${arqFila(c.id).replace(/\.json$/, '')}.trava`;
    let fd = null;
    if (fs.existsSync(arqFila(c.id))) {
      try { fd = fs.openSync(trava, 'wx'); } catch {
        try { if (Date.now() - fs.statSync(trava).mtimeMs > 30000) { fs.rmSync(trava, { force: true }); fd = fs.openSync(trava, 'wx'); } } catch { /* segue ocupada */ }
        if (fd === null) throw Object.assign(new Error('a líder está recebendo a fila agora; tente de novo em um instante'), { codigo: 409 });
      }
    }
    let item;
    try {
      absorverEntregues(c.id);
      const fila = respostasPendentes.get(c.id) || [];
      item = fila.find((x) => x.id === itemId);
      if (!item) throw jaFoi();
      const resto = fila.filter((x) => x.id !== itemId);
      if (resto.length) respostasPendentes.set(c.id, resto); else respostasPendentes.delete(c.id);
      espelharFila(c.id);
    } finally {
      if (fd !== null) { try { fs.closeSync(fd); fs.rmSync(trava, { force: true }); } catch { /* ok */ } }
    }
    return { ok: true, texto: item.texto, registro: !!item.registro };
  },

  /** Seta ➤ numa mensagem da fila: corta o turno e entrega agora tudo o que estava na fila. */
  async 'fila-enviar'(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    absorverEntregues(c.id);
    const fila = respostasPendentes.get(c.id) || [];
    if (!fila.length) return { ok: true, vazia: true }; // já foi entregue (no fim do turno ou no meio dele)
    const turno = processos.get(c.id);
    if (!turno) return { ok: true, vazia: true };
    if (!turno.corrigir) {
      turno.corrigir = [];
      turno.motivoCorte = 'fila';
      turno.interrompidos = agentesRodando(c.id);
      loja.anotarConversa(c.id, { quem: 'sistema', texto: 'Turno interrompido por você para mandar agora a mensagem da fila.' });
      anotarAtividade(c.id, 'lider', null);
      encerrarProcesso(turno.filho);
    }
    return { ok: true, interrompido: true };
  },

  /**
   * Reativar: um contexto concluído ou parado volta ao Office na mesma sessão do Claude (--resume), com a
   * baia de volta. Com texto, já manda a mensagem; sem texto, fica esperando você escrever (sem custo).
   */
  async reativar(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    if (!E.TERMINAIS.has(c.status)) throw Object.assign(new Error(`o contexto não está encerrado (status ${c.status})`), { codigo: 409 });
    if (processos.has(c.id)) throw Object.assign(new Error('ainda há um turno fechando neste contexto; tente de novo em instantes'), { codigo: 409 });
    checarReativacao(c);
    const msg = typeof corpo.texto === 'string' && corpo.texto.trim() ? texto(corpo.texto, 'texto') : '';
    const anterior = c.status;
    loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'TRABALHANDO', motivo: 'reativado pelo usuário' }); // devolve a baia
    loja.anotarConversa(c.id, { quem: 'sistema', texto: `Contexto reativado por você (estava ${anterior === 'PARADO' ? 'parado' : 'concluído'}).` });
    if (!msg) {
      reativados.set(c.id, anterior);
      loja.registrar({ tipo: 'pergunta.abrir', contexto: c.id, tipoPergunta: 'chat', texto: 'Contexto reativado: escreva o que quer continuar.', opcoes: [], silencioso: true });
      return { ok: true, reativado: true };
    }
    loja.registrar({ tipo: 'mensagem.usuario', contexto: c.id, texto: msg });
    loja.anotarConversa(c.id, { quem: 'voce', texto: msg });
    if (SIMULAR) simularChat(c, msg);
    else iniciarTurno(contexto(c.id), promptReativado(c, msg, anterior), false);
    return { ok: true, reativado: true };
  },

  async skills(corpo) {
    const nome = texto(corpo.nome, 'nome', 120);
    const r = E.alternarSkill(nome, corpo.ativa !== false);
    if (r.mudou) loja.registrar({ tipo: 'skill.alternada', skill: nome, ativa: r.ativa });
    cache.catalogo = montarCatalogo();
    cacheAprendizado.em = 0;
    return r;
  },

  async dispensar(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    if (!E.TERMINAIS.has(c.status)) throw Object.assign(new Error('só dá para dispensar contexto concluído ou parado'), { codigo: 409 });
    loja.registrar({ tipo: 'contexto.dispensar', contexto: c.id });
    return { ok: true };
  },

  async terminal(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    const levar = corpo.valor !== false;
    if (levar && processos.has(c.id)) throw Object.assign(new Error('espere o turno atual terminar para levar ao terminal'), { codigo: 409 });
    loja.registrar({ tipo: 'contexto.terminal', contexto: c.id, valor: levar });
    return { ok: true, comando: c.sessionId ? `cd "${RAIZ}" && claude --resume ${c.sessionId}` : null };
  },
};

async function atender(req, res) {
  try {
    if (!hostLocal(req)) return falha(res, 421, 'host não permitido');
    const url = new URL(req.url, `http://localhost:${PORTA}`);
    const rota = url.pathname;

    if (req.method === 'GET') {
      if (rota === '/state') {
        const cfg = config();
        return enviar(res, 200, {
          state: comAtividade(estadoProjetado()),
          catalogo: catalogo(),
          tema: tema(),
          config: { nome: cfg.nome, time: cfg.time, modo: cfg.modo, maxContextos: cfg.maxContextos, gatilho: cfg.gatilho.habilitado !== false, registro: (({ configurado, resumo, onde }) => ({ configurado, resumo, onde }))(cfgRegistro()) },
          servidor: { simulado: SIMULAR, versao: VERSAO, raiz: RAIZ, turnosRodando: [...processos.keys()], pausar: !WINDOWS },
          limites: cache.limites || null,
        });
      }
      if (rota === '/aprendizado') return enviar(res, 200, await montarAprendizado());
      const term = rota.match(/^\/contextos\/([^/]+)\/terminal$/);
      if (term) {
        const c = contexto(decodeURIComponent(term[1]));
        if (!c) return falha(res, 404, 'contexto não encontrado');
        const t = fonteTerminal(c.id, c.sessionId);
        try { await t.fonte.atualizar(); } catch { /* transcript ainda não existe */ }
        const metaT = { sessionId: c.sessionId, origem: c.origem, noTerminal: c.noTerminal, existe: t.fonte.existe, simulado: SIMULAR, comando: c.sessionId ? `cd "${RAIZ}" && claude --resume ${c.sessionId}` : null };
        if (url.searchParams.has('desde')) {
          // plano B sem streaming (proxy que quebra SSE, captura de tela): entradas a partir do índice pedido
          const desde = Math.max(0, parseInt(url.searchParams.get('desde'), 10) || 0);
          return enviar(res, 200, { entradas: t.fonte.entradas.slice(desde), total: t.fonte.entradas.length, custo: t.fonte.custo, meta: metaT });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        const ev = (nome, d) => res.write(`event: ${nome}\ndata: ${JSON.stringify(d)}\n\n`);
        ev('inicio', {
          entradas: t.fonte.entradas.slice(-2500), custo: t.fonte.custo,
          meta: { sessionId: c.sessionId, origem: c.origem, noTerminal: c.noTerminal, existe: t.fonte.existe, simulado: SIMULAR, comando: c.sessionId ? `cd "${RAIZ}" && claude --resume ${c.sessionId}` : null },
        });
        const ouvinte = (d) => ev('mais', d);
        t.ouvintes.add(ouvinte);
        const vivo = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => { t.ouvintes.delete(ouvinte); clearInterval(vivo); });
        return undefined;
      }
      const imagem = rota.match(/^\/imagens\/([\w-]+\.(png|jpg|gif|webp))$/);
      if (imagem) {
        let dados;
        try { dados = await fsp.readFile(path.join(DADOS, 'imagens', imagem[1])); } catch { return falha(res, 404, 'imagem não encontrada'); }
        const tipo = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[imagem[2]];
        res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        return res.end(dados);
      }
      const conversa = rota.match(/^\/contextos\/([^/]+)\/conversa$/);
      if (conversa) {
        const todas = await loja.lerConversa(decodeURIComponent(conversa[1]));
        const total = todas.length;
        const num = (k) => { const v = Number(url.searchParams.get(k)); return Number.isFinite(v) && v > 0 ? Math.floor(v) : null; };
        const ult = num('ultimas'), antes = num('antes'), lim = Math.min(num('limite') || 60, 500);
        // ?ultimas=N: só o fim da conversa; ?antes=I&limite=N: o bloco que vem antes da posição I. Sem parâmetro: tudo.
        if (ult) { const ini = Math.max(0, total - ult); return enviar(res, 200, { mensagens: todas.slice(ini), inicio: ini, total }); }
        if (antes !== null) { const fim = Math.min(antes, total), ini = Math.max(0, fim - lim); return enviar(res, 200, { mensagens: todas.slice(ini, fim), inicio: ini, total }); }
        return enviar(res, 200, { mensagens: todas, inicio: 0, total });
      }
      return servirEstatico(req, res, rota);
    }

    if (req.method === 'POST') {
      if (!autorizado(req)) return falha(res, 403, 'token ou origem inválidos');
      const nome = rota.replace(/^\//, '');
      if (!Object.prototype.hasOwnProperty.call(acoes, nome)) return falha(res, 404, 'rota desconhecida');
      const corpo = await lerCorpo(req, nome === 'imagem' ? 12 * 1024 * 1024 : undefined); // imagem vai em base64
      const r = await acoes[nome](corpo);
      return enviar(res, 200, r);
    }
    return falha(res, 405, 'método não permitido');
  } catch (err) {
    return falha(res, err.codigo && err.codigo >= 400 && err.codigo < 600 ? err.codigo : 500, err.message || 'erro');
  }
}
const servidor = http.createServer(atender);
// também no loopback IPv6: o Windows tenta ::1 primeiro em "localhost" e, sem isso, espera ~2 s
const servidor6 = http.createServer(atender);
servidor6.on('error', () => { /* sem IPv6: segue só no IPv4 */ });

// porta ocupada = outro Office já está no ar: sai sem tocar no estado (nada de recuperação nem de state.json)
servidor.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') { console.error(`porta ${PORTA} ocupada: outro Office já está no ar; este sai sem mexer no estado`); process.exit(1); }
  throw err;
});
recarregarEstaticos().then(() => servidor6.listen(PORTA, '::1')).catch(() => {}).then(() => servidor.listen(PORTA, '127.0.0.1', () => {
  // só depois de conseguir a porta: a recuperação marca turnos interrompidos e o refresco grava o state.json
  recuperarAoIniciar();
  setInterval(refrescar, 1000);
  console.log(`Office ${SIMULAR ? '(SIMULAÇÃO) ' : ''}em http://localhost:${PORTA}  ·  raiz ${RAIZ}`);
  if (SIMULAR) {
    // dois contextos de demonstração para o escritório já abrir com vida
    const cfg = config();
    const criar = (repo, fluxoId, cenas) => {
      try {
        const id = E.criarContexto(loja, { repo, fluxoId, origem: 'simulacao', sessionId: crypto.randomUUID(), fluxos: fluxos(), config: cfg });
        sim.iniciar(contexto(id), fluxos()[fluxoId], cenas);
      } catch (err) { console.error('simulação:', err.message); }
    };
    if (CENARIO === 'lotado') {
      // teste de escala: 5 projetos com 10 agentes cada (a líder e mais 9), um deles pedindo aprovação
      sim.REPOS.slice(0, 5).forEach((repo, i) => setTimeout(() => {
        try {
          const id = E.criarContexto(loja, { repo, fluxoId: 'sim-modernizacao', origem: 'simulacao', sessionId: crypto.randomUUID(), fluxos: fluxos(), config: config() });
          sim.iniciarLotado(contexto(id), fluxos()['sim-modernizacao'], 9, i === 3);
        } catch (err) { console.error('simulação:', err.message); }
      }, 800 + i * 1500));
      return;
    }
    // a demonstração roda o fluxo de serviço, se existir (time/fluxos/servico.json)
    const temServico = Boolean(fluxos().servico);
    setTimeout(() => criar('pagamentos-api', temServico ? 'servico' : 'sim-modernizacao', ['guarda']), 1500);
    setTimeout(() => criar('cadastro-legado', temServico ? 'servico' : 'demo', temServico ? ['limite', 'erro'] : ['limite', 'erro', 'escolha']), 6500);
  }
}));

function encerrar() {
  // os turnos rodam soltos: reiniciar o servidor não os derruba (só guarda até onde cada um já foi lido)
  for (const t of processos.values()) { clearInterval(t.timer); try { if (t.salvar) t.salvar(true); } catch { /* ok */ } }
  for (const p of paralelos.values()) { try { encerrarProcesso(p.filho); } catch { /* ok */ } }
  for (const r of registros.values()) { try { encerrarProcesso(r.filho); } catch { /* ok */ } }
  try { servidor6.close(); } catch { /* ok */ }
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', encerrar);
// app do Windows sem WSL: o servidor roda direto no node.exe e para quando o app fecha a entrada dele
if (process.env.ORQ_PARAR_COM_STDIN) { process.stdin.on('end', encerrar); process.stdin.on('close', encerrar); process.stdin.resume(); }
process.on('SIGTERM', encerrar);
