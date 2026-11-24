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
const { spawn } = require('child_process');
const E = require('./estado.js');
const { Transcricao, detalhesFerramenta } = require('./transcritos.js');

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const SIMULAR = args.includes('--simular');
const CENARIO = (() => { const i = args.indexOf('--cenario'); return i >= 0 ? args[i + 1] : null; })(); // --cenario lotado: teste de escala
const RAIZ = E.RAIZ;
const OFFICE = E.OFFICE;
const DADOS = SIMULAR ? path.join(OFFICE, '.simulacao') : (process.env.ORQ_DADOS || OFFICE);
const TOKEN = crypto.randomBytes(18).toString('hex');
const VERSAO = (() => { try { return fs.readFileSync(path.join(RAIZ, 'NUCLEO_VERSAO'), 'utf8').trim(); } catch { return '?'; } })();

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
  let p = String(rel).replace(/^~(?=\/)/, process.env.HOME || '~');
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
  const manifesto = E.lerJson(path.join(RAIZ, '.claude', 'nucleo-manifesto.json'), { nucleo: [] });
  const doNucleo = new Set((manifesto.nucleo || []).map((x) => (x.match(/^\.claude\/skills\/([^/]+)\/$/) || [])[1]).filter(Boolean));
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
        doTime: doTime.has(id), origem: doTime.has(id) ? 'time' : doNucleo.has(nome) ? 'nucleo' : 'outra', essencial: E.SKILLS_ESSENCIAIS.has(nome),
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
      nome: s.nome, pasta: s.nome, descricao: (fm && fm.description) || '', caminho: !arq ? s.pasta : arq.startsWith(RAIZ) ? path.relative(RAIZ, arq) : arq.replace(process.env.HOME || '~', '~'),
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
const ESTATICOS = ['index.html', 'painel.js', 'chats.js', 'dialogo.js', 'fluxos.js', 'aprendizado.js', 'biblioteca.js', 'terminal.js', 'markdown.js', 'estilo.css', 'escritorio/motor.js', 'escritorio/cena.js', 'escritorio/mapa.js', 'escritorio/sprites.js'];
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
      return { ...c, atividade: { lider, workers } };
    }),
  };
}

/* -------------------------------------------------------------- turnos reais */

const processos = new Map();
const respostasPendentes = new Map();
function enfileirarMensagem(id, prompt, textoOriginal) {
  if (!respostasPendentes.has(id)) respostasPendentes.set(id, []);
  respostasPendentes.get(id).push({ prompt, texto: textoOriginal });
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

function iniciarTurno(c, texto, primeiro) {
  const flags = flagsTurno();
  const argv = [...flags.slice(0, 1), ...(primeiro ? ['--session-id', c.sessionId] : ['--resume', c.sessionId]), ...flags.slice(1)];
  const arqStream = loja.arquivoRun(c.id, 'stream.jsonl');
  fs.mkdirSync(path.dirname(arqStream), { recursive: true });
  const saida = fs.createWriteStream(arqStream, { flags: 'a' });
  const filho = spawn('claude', argv, {
    cwd: RAIZ, env: { ...process.env, ORQ_CONTEXTO: c.id, ORQ_RAIZ: RAIZ }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const turno = { filho, resultado: null, stderr: '', parado: false, inicio: Date.now() };
  processos.set(c.id, turno);
  anotarAtividade(c.id, 'lider', 'pensando', '');

  filho.on('error', (err) => {
    turno.stderr += err.code === 'ENOENT' ? 'claude não encontrado no PATH' : String(err.message);
  });
  filho.stdin.on('error', () => {});
  filho.stdin.end(texto);
  filho.stderr.on('data', (d) => { turno.stderr = (turno.stderr + d.toString()).slice(-4000); });

  readline.createInterface({ input: filho.stdout }).on('line', (linha) => {
    saida.write(linha + '\n');
    let m; try { m = JSON.parse(linha); } catch { return; }
    if (m.type === 'system' && m.subtype === 'init' && m.session_id && m.session_id !== c.sessionId) {
      loja.registrar({ tipo: 'contexto.sessao', contexto: c.id, sessionId: m.session_id });
    }
    if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
      const sub = m.parent_tool_use_id || null;
      for (const b of m.message.content) {
        if (b.type === 'tool_use') {
          anotarAtividade(c.id, sub || 'lider', TIPO_FERRAMENTA.tipoAtividade(b.name), TIPO_FERRAMENTA.alvoAtividade(b.name, b.input || {}));
        } else if (b.type === 'text' && b.text && b.text.trim() && !sub) {
          loja.registrar({ tipo: 'mensagem', contexto: c.id, texto: b.text });
          loja.anotarConversa(c.id, { quem: 'agente', texto: b.text });
          anotarAtividade(c.id, 'lider', 'pensando', '');
        }
      }
    }
    if (m.type === 'rate_limit_event') anotarLimitesDoStream(m.rate_limit_info);
    if (m.type === 'result') turno.resultado = m;
  });

  filho.on('close', (codigo) => {
    saida.end();
    processos.delete(c.id);
    anotarAtividade(c.id, 'lider', null);
    const r = turno.resultado;
    if (r) loja.registrar({ tipo: 'metricas', contexto: c.id, custoSessaoUsd: r.total_cost_usd || 0, duracaoMs: Date.now() - turno.inicio });
    if (turno.parado) return;
    const fila = respostasPendentes.get(c.id);
    if (fila && fila.length) {
      // o usuário escreveu enquanto o turno rodava/fechava: segue direto com o que ele mandou
      respostasPendentes.delete(c.id);
      const agora = contexto(c.id);
      if (agora && agora.pergunta) loja.registrar({ tipo: 'pergunta.responder', contexto: c.id, texto: fila.map((x) => x.texto).join('\n'), por: 'office' });
      iniciarTurno(c, fila.map((x) => x.prompt).join('\n\n'), false);
      return;
    }
    const atual = contexto(c.id);
    if (!atual) return;
    const textoFinal = (r && (r.result || r.subtype)) || '';
    const tudo = `${textoFinal}\n${turno.stderr}`;
    if (r && r.is_error && /usage limit|rate.?limit|hit your limit|\b429\b/i.test(tudo)) {
      loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'PAUSADO_LIMITE', motivo: 'limite de uso atingido' });
    } else if (!r || r.is_error || codigo !== 0) {
      const motivo = r && /budget/i.test(r.subtype || '') ? 'teto de US$ por turno atingido (orcamento.maxUsdPorTurno)' : E.cortar(textoFinal || turno.stderr || `claude saiu com código ${codigo}`, 300);
      loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'ERRO', motivo });
      loja.anotarConversa(c.id, { quem: 'sistema', texto: `Turno terminou com erro: ${motivo}` });
    } else if (atual.status === 'TRABALHANDO' && !atual.pergunta && ehChat(atual)) {
      // chat: a resposta já está na conversa; só sinaliza que é a vez do usuário
      const linha = String(r.result || '').split('\n').map((x) => x.trim()).find(Boolean) || 'respondeu';
      loja.registrar({ tipo: 'pergunta.abrir', contexto: c.id, tipoPergunta: 'chat', texto: E.cortar(linha, 160), opcoes: [] });
    } else if (atual.status === 'TRABALHANDO' && !atual.pergunta) {
      // terminou o turno sem registrar pergunta nem concluir: vira pergunta para o usuário
      loja.registrar({
        tipo: 'pergunta.abrir', contexto: c.id, tipoPergunta: 'duvida',
        texto: E.cortar(r.result || 'O agente encerrou o turno sem perguntar nada. Como seguimos?', 1500), opcoes: [],
      });
    }
  });
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
    if (c.origem === 'office' && c.status === 'TRABALHANDO') {
      loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'ERRO', motivo: 'o servidor reiniciou no meio do turno — clique em Retomar' });
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

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on('data', (p) => { tam += p.length; if (tam > 64 * 1024) { reject(Object.assign(new Error('corpo grande demais'), { codigo: 413 })); req.destroy(); } else partes.push(p); });
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

const acoes = {
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
    loja.anotarConversa(c.id, { quem: 'voce', texto: resposta });
    if (SIMULAR) {
      if (ehChat(c)) { loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'TRABALHANDO' }); simularChat(c, resposta); return { ok: true }; }
      if (!sim.responder(c.id, resposta)) loja.anotarConversa(c.id, { quem: 'sistema', texto: '(simulação: ninguém estava esperando essa resposta)' });
      return { ok: true };
    }
    const promptR = ehChat(c) ? promptChat(c, resposta, false) : promptResposta(c, pergunta, resposta);
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
    if (ehChat(c) && c.status === 'PARADO') {
      // chat salvo: escrever nele reabre a conversa (mesma sessão do Claude)
      checarVagaChat(c.id);
      const msgR = texto(corpo.texto, 'texto');
      loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'TRABALHANDO' });
      loja.registrar({ tipo: 'mensagem.usuario', contexto: c.id, texto: msgR });
      loja.anotarConversa(c.id, { quem: 'voce', texto: msgR });
      if (SIMULAR) simularChat(c, msgR); else iniciarTurno(c, promptChat(c, msgR, false), false);
      return { ok: true, reaberto: true };
    }
    if (E.TERMINAIS.has(c.status)) throw Object.assign(new Error('contexto encerrado: para continuar a conversa, leve a sessão ao terminal (claude --resume)'), { codigo: 409 });
    if (c.noTerminal) throw Object.assign(new Error('este contexto está no terminal; devolva ao Office antes de escrever por aqui'), { codigo: 409 });
    if (c.origem === 'terminal') throw Object.assign(new Error('esta sessão está aberta no seu terminal: escreva por lá'), { codigo: 409 });
    const msg = texto(corpo.texto, 'texto');
    loja.registrar({ tipo: 'mensagem.usuario', contexto: c.id, texto: msg });
    loja.anotarConversa(c.id, { quem: 'voce', texto: msg });
    if (SIMULAR) { sim.mensagem(c.id, msg); return { ok: true }; }
    const prompt = ehChat(c) ? promptChat(c, msg, false) : [`[orq] contexto=${c.id} — mensagem do usuário pelo Office (fora de uma pergunta):`, `<<<MENSAGEM\n${msg}\nMENSAGEM>>>`,
      `Leve em conta e continue. Se precisar decidir algo com ele, use estado.js pergunta --contexto ${c.id} e encerre o turno.`].join('\n');
    if (processos.has(c.id)) { enfileirarMensagem(c.id, prompt, msg); return { ok: true, enfileirada: true }; }
    if (['PAUSADO_LIMITE', 'ERRO'].includes(c.status)) loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'TRABALHANDO' });
    iniciarTurno(c, prompt, false);
    return { ok: true };
  },

  async retomar(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    if (!['PAUSADO_LIMITE', 'ERRO'].includes(c.status)) throw Object.assign(new Error(`só dá para retomar contexto pausado ou com erro (status ${c.status})`), { codigo: 409 });
    if (processos.has(c.id)) throw Object.assign(new Error('ainda há um turno rodando neste contexto'), { codigo: 409 });
    loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'TRABALHANDO' });
    loja.anotarConversa(c.id, { quem: 'voce', texto: '(retomar)' });
    if (SIMULAR) {
      if (!sim.retomar(c.id)) sim.iniciar(contexto(c.id), fluxos()[c.fluxoId], []);
    } else iniciarTurno(c, `[orq] contexto=${c.id} — o usuário pediu para retomar. Continue de onde parou${c.motivo ? ` (motivo da parada: ${c.motivo})` : ''}.`, false);
    return { ok: true };
  },

  async parar(corpo) {
    const c = contexto(texto(corpo.contextoId, 'contextoId', 200));
    if (!c) throw Object.assign(new Error('contexto não encontrado'), { codigo: 404 });
    if (E.TERMINAIS.has(c.status)) throw Object.assign(new Error('o contexto já terminou'), { codigo: 409 });
    const turno = processos.get(c.id);
    if (turno) { turno.parado = true; try { turno.filho.kill('SIGTERM'); } catch { /* já saiu */ } }
    if (SIMULAR) sim.parar(c.id);
    loja.registrar({ tipo: 'contexto.status', contexto: c.id, status: 'PARADO', motivo: 'parado pelo usuário' });
    loja.anotarConversa(c.id, { quem: 'sistema', texto: 'Contexto parado por você.' });
    anotarAtividade(c.id, 'lider', null);
    return { ok: true };
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
          config: { nome: cfg.nome, time: cfg.time, modo: cfg.modo, maxContextos: cfg.maxContextos, gatilho: cfg.gatilho.habilitado !== false },
          servidor: { simulado: SIMULAR, versao: VERSAO, raiz: RAIZ, turnosRodando: [...processos.keys()] },
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
      const conversa = rota.match(/^\/contextos\/([^/]+)\/conversa$/);
      if (conversa) return enviar(res, 200, { mensagens: await loja.lerConversa(decodeURIComponent(conversa[1])) });
      return servirEstatico(req, res, rota);
    }

    if (req.method === 'POST') {
      if (!autorizado(req)) return falha(res, 403, 'token ou origem inválidos');
      const nome = rota.replace(/^\//, '');
      if (!Object.prototype.hasOwnProperty.call(acoes, nome)) return falha(res, 404, 'rota desconhecida');
      const corpo = await lerCorpo(req);
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
    setTimeout(() => criar('pagamentos-api', 'sim-modernizacao', ['guarda']), 1500);
    setTimeout(() => criar('cadastro-legado', 'demo', ['limite', 'erro', 'escolha']), 6500);
  }
}));

function encerrar() {
  for (const t of processos.values()) { t.parado = true; try { t.filho.kill('SIGTERM'); } catch { /* ok */ } }
  try { servidor6.close(); } catch { /* ok */ }
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
