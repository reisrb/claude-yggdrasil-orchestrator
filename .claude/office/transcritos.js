'use strict';
/*
 * transcritos.js — lê os transcripts do Claude Code e normaliza em "entradas" de console.
 *
 * Fonte única para qualquer sessão (disparada pelo Office, aberta no terminal, ou levada de um
 * para o outro com --resume), porque todas gravam em:
 *   ~/.claude/projects/<raiz sanitizada>/<sessionId>.jsonl
 *   ~/.claude/projects/<raiz sanitizada>/<sessionId>/subagents/agent-<id>.jsonl (+ .meta.json com toolUseId)
 * A leitura é incremental (só os bytes novos de cada arquivo).
 */
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const LIM = { resultado: 12000, edicao: 5000, escrita: 4000, fala: 8000 };

function pastaProjeto(raiz) {
  return path.join(os.homedir(), '.claude', 'projects', path.resolve(raiz).replace(/[^A-Za-z0-9]/g, '-'));
}

function corta(s, n) {
  const t = String(s == null ? '' : s);
  return t.length > n ? `${t.slice(0, n)}\n… (+${t.length - n} caracteres)` : t;
}

function textoDe(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (x && x.type === 'text' ? x.text : x && x.type === 'image' ? '[imagem]' : '')).join('\n');
  return '';
}

function detalhesFerramenta(nome, e) {
  switch (nome) {
    case 'Bash': return { titulo: e.command, descricao: e.description || null };
    case 'Read': return { titulo: `${e.file_path || ''}${e.offset ? `:${e.offset}` : ''}` };
    case 'Edit': return { titulo: e.file_path, diff: [{ antes: corta(e.old_string, LIM.edicao), depois: corta(e.new_string, LIM.edicao) }] };
    case 'MultiEdit': return { titulo: e.file_path, diff: (e.edits || []).slice(0, 12).map((x) => ({ antes: corta(x.old_string, 1500), depois: corta(x.new_string, 1500) })) };
    case 'Write': return { titulo: e.file_path, conteudo: corta(e.content, LIM.escrita) };
    case 'Grep': return { titulo: `${e.pattern}${e.path ? `  em ${e.path}` : ''}${e.glob ? `  (${e.glob})` : ''}` };
    case 'Glob': return { titulo: `${e.pattern}${e.path ? `  em ${e.path}` : ''}` };
    case 'Agent': case 'Task': return { titulo: `${e.subagent_type || 'agente'} · ${e.description || ''}`, prompt: corta(e.prompt, 3000) };
    case 'Skill': return { titulo: `${e.skill || ''}${e.args ? ` ${e.args}` : ''}` };
    case 'WebFetch': return { titulo: e.url };
    case 'WebSearch': return { titulo: e.query };
    case 'TodoWrite': return { titulo: `${(e.todos || []).length} tarefa(s)`, conteudo: (e.todos || []).map((t) => `${t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'} ${t.content}`).join('\n') };
    default: return { titulo: corta(JSON.stringify(e), 240) };
  }
}

/** Texto que o usuário (ou o Office em nome dele) mandou para a sessão. */
function falaDoUsuario(txt) {
  const r = txt.match(/<<<(RESPOSTA|NOTA|MENSAGEM)\n([\s\S]*?)\n\1>>>/);
  if (r) return r[2];
  if (/^\[orq\][^\n]*origem=office/.test(txt)) return '▶ início do ciclo pelo Office';
  if (/o usuário pediu para retomar/.test(txt)) return '↻ retomar';
  return txt;
}

function normalizarLinha(m, dentro) {
  const out = [];
  if (!m || m.isMeta) return out;
  const ts = m.timestamp || null;
  if (m.type === 'user' && m.message) {
    const c = m.message.content;
    if (typeof c === 'string') {
      if (c.startsWith('Another Claude session sent a message')) out.push({ t: 'sistema', texto: '↩ um subagente devolveu o resultado', ts, dentro });
      else if (dentro) out.push({ t: 'tarefa', texto: corta(c, 3000), ts, dentro });
      else out.push({ t: 'voce', texto: corta(falaDoUsuario(c), 4000), ts });
      return out;
    }
    for (const b of c || []) {
      if (b.type === 'tool_result') {
        out.push({ t: 'resultado', id: b.tool_use_id, texto: corta(textoDe(b.content), LIM.resultado), erro: !!b.is_error, ts, dentro });
      } else if (b.type === 'text' && !dentro && b.text && !/^(Base directory for this skill|<system-reminder>|Caveat:|<command-)/.test(b.text)) {
        out.push({ t: 'voce', texto: corta(falaDoUsuario(b.text), 4000), ts });
      }
    }
    return out;
  }
  if (m.type === 'assistant' && m.message) {
    for (const b of m.message.content || []) {
      if (b.type === 'text' && b.text && b.text.trim()) out.push({ t: 'texto', texto: corta(b.text, LIM.fala), ts, dentro });
      else if (b.type === 'tool_use') out.push({ t: 'ferramenta', id: b.id, nome: b.name, ...detalhesFerramenta(b.name, b.input || {}), ts, dentro });
    }
  }
  return out;
}

/** Leitor incremental de uma sessão (principal + subagentes). */
class Transcricao {
  constructor(raiz, sessionId) {
    this.dir = pastaProjeto(raiz);
    this.sessionId = sessionId;
    this.arquivos = new Map();
    this.metas = new Map();
    this.entradas = [];
    this.custo = null;
    this.existe = false;
  }

  async lerNovos(arq, dentro) {
    let st;
    try { st = await fsp.stat(arq); } catch { return []; }
    let a = this.arquivos.get(arq);
    if (!a) { a = { pos: 0, resto: Buffer.alloc(0) }; this.arquivos.set(arq, a); }
    if (st.size < a.pos) { a.pos = 0; a.resto = Buffer.alloc(0); }
    if (st.size === a.pos) return [];
    const fh = await fsp.open(arq, 'r');
    const buf = Buffer.alloc(st.size - a.pos);
    try { await fh.read(buf, 0, buf.length, a.pos); } finally { await fh.close(); }
    a.pos = st.size;
    const tudo = Buffer.concat([a.resto, buf]);
    const fim = tudo.lastIndexOf(10); // \n
    if (fim < 0) { a.resto = tudo; return []; }
    a.resto = tudo.subarray(fim + 1);
    const out = [];
    for (const linha of tudo.subarray(0, fim).toString('utf8').split('\n')) {
      if (!linha.trim()) continue;
      let m; try { m = JSON.parse(linha); } catch { continue; }
      if (m.type === 'cost-state' && !dentro) { this.custo = m.totalCostUSD; continue; }
      out.push(...normalizarLinha(m, dentro));
    }
    return out;
  }

  async atualizar() {
    if (!this.sessionId) return [];
    const principal = path.join(this.dir, `${this.sessionId}.jsonl`);
    const novas = await this.lerNovos(principal, null);
    this.existe = !!(this.arquivos.get(principal) && this.arquivos.get(principal).pos > 0);
    const pasta = path.join(this.dir, this.sessionId, 'subagents');
    let nomes = [];
    try { nomes = (await fsp.readdir(pasta)).filter((n) => n.endsWith('.jsonl')).sort(); } catch { /* sem subagentes */ }
    for (const n of nomes) {
      const id = n.slice(0, -'.jsonl'.length);
      if (!this.metas.has(id)) {
        try { this.metas.set(id, JSON.parse(await fsp.readFile(path.join(pasta, `${id}.meta.json`), 'utf8'))); } catch { continue; }
      }
      const meta = this.metas.get(id);
      novas.push(...await this.lerNovos(path.join(pasta, n), meta.toolUseId || id));
    }
    this.entradas.push(...novas);
    return novas;
  }
}

module.exports = { Transcricao, normalizarLinha, pastaProjeto, detalhesFerramenta, corta };
