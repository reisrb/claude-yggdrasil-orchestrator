#!/usr/bin/env node
'use strict';
/*
 * prontidao.js — readiness do ciclo SDD, por script (zero token).
 *
 *   node .claude/office/prontidao.js specs/<repo>/<ciclo>
 *
 * Lê spec.md, plano.md e tarefas.md e imprime, na última linha, exatamente:
 *   **Veredito:** READY    ou    **Veredito:** BLOCKED
 * Sai com 0 (READY) ou 1 (BLOCKED). Com --autoteste, roda os casos de testes/prontidao.
 */
const fs = require('fs');
const path = require('path');
const { carregarFluxos, RAIZ } = require('./estado.js');

const ACAO_EXTERNA = [
  [/\bgit\s+push\b/i, 'git push'],
  [/\bglab\s+mr\s+(create|merge|approve|update)\b/i, 'glab mr'],
  [/\bgh\s+pr\s+(create|merge|review)\b/i, 'gh pr'],
  [/\b(abrir|criar)\s+(o\s+|um\s+)?(MR|PR|merge request|pull request)\b/i, 'abrir MR/PR'],
  [/\b(fazer|executar|realizar)\s+(o\s+)?(merge|deploy)\b/i, 'merge/deploy'],
  [/\bmergear\b/i, 'merge'],
];

function ler(arq) { try { return fs.readFileSync(arq, 'utf8'); } catch { return null; } }

function avaliar(pasta, { fluxos = carregarFluxos() } = {}) {
  const motivos = [];
  const spec = ler(path.join(pasta, 'spec.md'));
  const plano = ler(path.join(pasta, 'plano.md'));
  const tarefas = ler(path.join(pasta, 'tarefas.md'));
  if (spec == null) motivos.push('falta spec.md');
  if (plano == null) motivos.push('falta plano.md');
  if (tarefas == null) motivos.push('falta tarefas.md');
  if (motivos.length) return { pronto: false, motivos, avisos: [] };

  const avisos = [];
  // fluxo: frontmatter da spec (fluxo:) ou linha "Fluxo:" do plano
  const fluxoId = ((spec.match(/^fluxo:\s*([\w.-]+)/m) || plano.match(/^Fluxo:\s*`?([\w.-]+)`?/m) || [])[1] || '').trim();
  const fluxo = fluxos[fluxoId];
  if (!fluxoId) motivos.push('spec/plano não dizem qual é o fluxo (fluxo: na spec ou Fluxo: no plano)');
  else if (!fluxo) motivos.push(`fluxo "${fluxoId}" não existe em time/fluxos/`);

  // critérios de aceite definidos na spec
  const secaoCA = spec.split(/^##\s+Crit[ée]rios de aceite\s*$/im)[1] || '';
  const cas = [...new Set([...secaoCA.matchAll(/^\s*[-*]?\s*\**\s*(CA\d+)\b/gm)].map((m) => m[1]))];
  if (!cas.length) motivos.push('a spec não tem critérios de aceite (## Critérios de aceite com - **CA1** …)');

  // tarefas
  const blocos = tarefas.split(/^##\s+(?=T\d+\b)/m).slice(1);
  if (!blocos.length) motivos.push('tarefas.md não tem tarefas (## T1 — …)');
  const atendidos = new Set();
  for (const bloco of blocos) {
    const nome = (bloco.match(/^(T\d+)/) || [])[1] || '?';
    const passo = ((bloco.match(/^Passo:\s*`?([\w.-]+)`?/m) || [])[1] || '').trim();
    const atende = ((bloco.match(/^Atende:\s*(.+)$/m) || [])[1] || '');
    const refs = [...atende.matchAll(/CA\d+/g)].map((m) => m[0]);
    if (!passo) motivos.push(`${nome}: falta "Passo:"`);
    else if (fluxo && !fluxo.passos.some((p) => p.id === passo)) motivos.push(`${nome}: passo "${passo}" não existe no fluxo ${fluxoId}`);
    if (!refs.length && !/meta/i.test(atende)) motivos.push(`${nome}: falta "Atende:" com algum CA (ou "meta")`);
    for (const r of refs) {
      if (cas.length && !cas.includes(r)) motivos.push(`${nome}: cita ${r}, que não existe na spec`);
      atendidos.add(r);
    }
    const verificar = (bloco.split(/^###\s+Como verificar\s*$/im)[1] || '').split(/^###\s/m)[0];
    if (!verificar.split('\n').some((l) => /\S/.test(l.replace(/^[-*\s]+$/, '')))) motivos.push(`${nome}: falta "### Como verificar" com conteúdo`);
    for (const linha of bloco.split('\n')) {
      if (/\[manual\]/i.test(linha)) continue;
      for (const [re, rotulo] of ACAO_EXTERNA) if (re.test(linha)) motivos.push(`${nome}: ação externa (${rotulo}) — isso é manual; marque [manual] se só estiver citando`);
    }
  }
  for (const ca of cas) if (!atendidos.has(ca)) motivos.push(`${ca} não é atendido por nenhuma tarefa`);
  if (fluxo) for (const p of fluxo.passos) if (!blocos.some((b) => new RegExp(`^Passo:\\s*\`?${p.id}\`?\\s*$`, 'm').test(b))) avisos.push(`passo "${p.id}" do fluxo não tem tarefa (ok se for intencional)`);

  return { pronto: motivos.length === 0, motivos: [...new Set(motivos)], avisos };
}

function imprimir(r) {
  for (const m of r.motivos) console.log(`- ✗ ${m}`);
  for (const a of r.avisos) console.log(`- ! ${a}`);
  console.log(`**Veredito:** ${r.pronto ? 'READY' : 'BLOCKED'}`);
}

function autoteste() {
  const base = path.join(__dirname, 'testes', 'prontidao');
  const fluxos = { demo: { id: 'demo', passos: [{ id: 'inventario' }, { id: 'relatorio' }] } };
  const ok = avaliar(path.join(base, 'ok'), { fluxos });
  const bloq = avaliar(path.join(base, 'bloqueado'), { fluxos });
  const falhas = [];
  if (!ok.pronto) falhas.push(`caso ok deveria ser READY: ${ok.motivos.join('; ')}`);
  if (bloq.pronto) falhas.push('caso bloqueado deveria ser BLOCKED');
  const esperado = ['CA2 não é atendido', 'CA9', 'passo "publicar"', 'git push', 'Como verificar'];
  for (const e of esperado) if (!bloq.motivos.some((m) => m.includes(e))) falhas.push(`caso bloqueado deveria acusar: ${e}`);
  if (falhas.length) { console.error(`autoteste FALHOU:\n- ${falhas.join('\n- ')}`); return 1; }
  console.log('autoteste OK: READY no caso bom; BLOCKED com CA sem tarefa, CA inexistente, passo fora do fluxo, push e verificação vazia');
  return 0;
}

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--autoteste') process.exitCode = autoteste();
  else if (!arg) { console.error('uso: node .claude/office/prontidao.js specs/<repo>/<ciclo>'); process.exitCode = 2; }
  else {
    const r = avaliar(path.resolve(RAIZ, arg));
    imprimir(r);
    process.exitCode = r.pronto ? 0 : 1;
  }
}

module.exports = { avaliar };
