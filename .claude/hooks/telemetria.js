#!/usr/bin/env node
'use strict';
/*
 * telemetria.js — camada determinística da telemetria (hooks do Claude Code).
 *
 * Transforma eventos da sessão em eventos do orquestrador (eventos.jsonl):
 *   PreToolUse  Agent|Task  → worker.inicio   (workerId = tool_use_id)
 *   SubagentStart           → worker.agente   (liga agent_id ao worker)
 *   SubagentStop            → worker.fim DONE (resumo = última mensagem do subagente)
 *   PostToolUse Agent|Task  → worker.fim só se o subagente rodou síncrono (o assíncrono termina no SubagentStop)
 *   PostToolUseFailure      → worker.fim ERROR
 *   Stop / Notification     → sessao.ociosa   (terminal esperando você)
 *   UserPromptSubmit        → sessao.ativa
 *
 * O contexto vem de ORQ_CONTEXTO (turnos disparados pelo Office) ou do cabeçalho
 * que o orquestrador põe no prompt do worker:  [orq] contexto=<id> passo=<p> skill=<s> papel=<papel>
 * Nunca bloqueia nada e sempre sai com 0.
 */
const path = require('path');

const RAIZ = process.env.CLAUDE_PROJECT_DIR ? path.resolve(process.env.CLAUDE_PROJECT_DIR) : path.resolve(__dirname, '..', '..');

function cabecalho(prompt) {
  const m = String(prompt || '').match(/\[orq\]([^\n]*)/);
  if (!m) return {};
  const out = {};
  for (const par of m[1].matchAll(/(\w+)=("[^"]*"|\S+)/g)) out[par[1]] = par[2].replace(/^"|"$/g, '');
  return out;
}

function textoDe(resp) {
  if (resp == null) return '';
  if (typeof resp === 'string') return resp;
  if (Array.isArray(resp)) return resp.map(textoDe).join(' ');
  if (typeof resp === 'object') {
    if (typeof resp.text === 'string') return resp.text;
    if (resp.content) return textoDe(resp.content);
    if (resp.result) return textoDe(resp.result);
  }
  return '';
}

function resumir(t, n = 280) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/* ---- atividade por ferramenta (efêmera: não vira evento, só anima o escritório) ---- */

const TIPO_POR_FERRAMENTA = {
  Read: 'lendo', NotebookRead: 'lendo', WebFetch: 'lendo', LS: 'lendo',
  Grep: 'buscando', Glob: 'buscando', WebSearch: 'buscando', ToolSearch: 'buscando',
  Edit: 'digitando', Write: 'digitando', MultiEdit: 'digitando', NotebookEdit: 'digitando',
  Bash: 'rodando', Agent: 'delegando', Task: 'delegando',
  AskUserQuestion: 'perguntando', TodoWrite: 'pensando',
};

function tipoAtividade(nome) {
  if (TIPO_POR_FERRAMENTA[nome]) return TIPO_POR_FERRAMENTA[nome];
  return String(nome || '').startsWith('mcp__') ? 'rodando' : 'pensando';
}

function alvoAtividade(nome, ti = {}) {
  const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop();
  if (ti.file_path || ti.notebook_path) return base(ti.file_path || ti.notebook_path);
  if (ti.pattern) return resumir(ti.pattern, 40);
  if (ti.command) return resumir(ti.command, 48);
  if (ti.description) return resumir(ti.description, 48);
  if (ti.url) { try { return new URL(ti.url).host; } catch { return resumir(ti.url, 40); } }
  if (ti.query) return resumir(ti.query, 40);
  return nome || '';
}

function anotarAtividade(e, tipoForcado) {
  const fs = require('fs');
  const { gravarAtomico, slug } = require(path.join(RAIZ, '.claude', 'office', 'estado.js'));
  const dir = path.join(process.env.ORQ_DADOS || path.join(RAIZ, '.claude', 'office'), 'atividade');
  const arq = path.join(dir, `${slug(e.session_id || 'sem-sessao')}.json`);
  let atual = {};
  try { atual = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { /* primeiro registro */ }
  const ts = new Date().toISOString();
  const item = { tipo: tipoForcado || tipoAtividade(e.tool_name), ferramenta: e.tool_name || null, alvo: tipoForcado ? '' : alvoAtividade(e.tool_name, e.tool_input || {}), ts };
  const novo = { sessao: e.session_id, contexto: process.env.ORQ_CONTEXTO || atual.contexto || null, ts, lider: atual.lider || null, sub: atual.sub || {} };
  if (e.agent_id) novo.sub[e.agent_id] = { ...item, agentType: e.agent_type || null, primeiroVisto: (atual.sub && atual.sub[e.agent_id] && atual.sub[e.agent_id].primeiroVisto) || ts };
  else novo.lider = item;
  gravarAtomico(arq, JSON.stringify(novo));
}

function traduzir(e) {
  const evento = e.hook_event_name;
  const sessao = e.session_id;
  const envCtx = process.env.ORQ_CONTEXTO || undefined;
  const ehWorker = ['Agent', 'Task'].includes(e.tool_name);
  const saida = [];

  if (evento === 'PreToolUse' && ehWorker) {
    const ti = e.tool_input || {};
    const h = cabecalho(ti.prompt);
    const contexto = h.contexto || envCtx;
    if (h.contexto && sessao) saida.push({ tipo: 'sessao.vincular', sessao, contexto: h.contexto });
    saida.push({
      tipo: 'worker.inicio', contexto, sessao, workerId: e.tool_use_id,
      papel: h.papel || ti.subagent_type || 'worker', skill: h.skill || ti.subagent_type || 'worker',
      passo: h.passo, alvo: h.alvo, subagentType: ti.subagent_type, descricao: resumir(ti.description || '', 200),
      paiAgentId: e.agent_id || undefined, // lançado por outro subagente → fica no grupo dele
    });
  } else if (evento === 'PostToolUse' && ehWorker) {
    const texto = textoDe(e.tool_response);
    const assincrono = /async agent launched|launched successfully|running in the background|will be notified/i.test(texto)
      || (e.tool_response && typeof e.tool_response === 'object' && /async|background/i.test(String(e.tool_response.status || '')));
    if (!assincrono) saida.push({ tipo: 'worker.fim', contexto: envCtx, sessao, workerId: e.tool_use_id, status: 'DONE', resumo: resumir(texto) });
  } else if (evento === 'SubagentStart') {
    saida.push({ tipo: 'worker.agente', contexto: envCtx, sessao, agentId: e.agent_id, agentType: e.agent_type });
  } else if (evento === 'SubagentStop') {
    saida.push({ tipo: 'worker.fim', contexto: envCtx, sessao, agentId: e.agent_id, agentType: e.agent_type, status: 'DONE', resumo: resumir(e.last_assistant_message || '') });
  } else if (evento === 'PostToolUseFailure' && ehWorker) {
    saida.push({ tipo: 'worker.fim', contexto: envCtx, sessao, workerId: e.tool_use_id, status: 'ERROR', resumo: resumir(e.error || textoDe(e.tool_response) || 'falhou') });
  } else if (evento === 'Stop' || evento === 'Notification') {
    saida.push({ tipo: 'sessao.ociosa', contexto: envCtx, sessao });
  } else if (evento === 'UserPromptSubmit') {
    saida.push({ tipo: 'sessao.ativa', contexto: envCtx, sessao });
  }
  return saida;
}

async function main() {
  try {
    let bruto = '';
    for await (const ch of process.stdin) bruto += ch;
    if (process.env.ORQ_PARALELO) return; // conversa paralela (cópia da líder): não é trabalho do contexto
    const entrada = JSON.parse(bruto || '{}');
    if (process.env.ORQ_DEBUG_HOOKS === '1') {
      require('fs').appendFileSync(path.join(RAIZ, '.claude', 'office', 'hooks-debug.jsonl'), JSON.stringify(entrada).slice(0, 4000) + '\n');
    }
    try {
      if (entrada.hook_event_name === 'PreToolUse') anotarAtividade(entrada);
      else if (entrada.hook_event_name === 'Stop') anotarAtividade(entrada, 'ocioso');
    } catch { /* atividade é cosmética */ }
    const eventos = traduzir(entrada);
    if (!eventos.length) return;
    const { Loja } = require(path.join(RAIZ, '.claude', 'office', 'estado.js'));
    const loja = new Loja();
    for (const ev of eventos) loja.registrar(ev);
  } catch { /* telemetria nunca atrapalha a sessão */ }
}

if (require.main === module) main();
module.exports = { traduzir, cabecalho, tipoAtividade, alvoAtividade };
