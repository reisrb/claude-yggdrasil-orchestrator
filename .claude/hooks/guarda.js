#!/usr/bin/env node
'use strict';
/*
 * guarda.js — hook PreToolUse com guardrails reais (deny), não só texto.
 *
 * Nega (no Bash e no PowerShell, a ferramenta do Claude Code no Windows):
 *   - push, criação/merge/aprovação de MR ou PR, --no-verify
 *   - rm -rf fora de repos/ (e, no PowerShell, Remove-Item -Recurse, rd /s e afins)
 *   - edição de .claude/settings*.json
 *   - edição das skills do time (listadas em time/skills-origem.json)
 *
 * Fail-open: qualquer erro interno libera a chamada (nunca trava a sessão).
 * Kill-switch: `node .claude/office/estado.js liberar-guarda 30` libera tudo por 30 min.
 * Teste: node .claude/hooks/guarda.js --autoteste
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = process.env.CLAUDE_PROJECT_DIR ? path.resolve(process.env.CLAUDE_PROJECT_DIR) : path.resolve(__dirname, '..', '..');
const WINDOWS = process.platform === 'win32';

/**
 * Caminho absoluto de um alvo, como o comando o escreveu: `~` vira a pasta do usuário (os.homedir(), que funciona
 * também quando o HOME não existe, como no servidor aberto pelo PowerShell) e, no Windows, o `/c/...` do Git Bash
 * vira `C:/...`.
 */
function absoluto(alvo, cwd) {
  let a = String(alvo || '').replace(/^~(?=[\\/]|$)/, os.homedir());
  if (WINDOWS) a = a.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, l) => `${l.toUpperCase()}:`);
  return path.resolve(cwd || RAIZ, a);
}

const REGRAS_BASH = [
  [/\bgit\b[^;&|\n]*\bpush\b/i, 'push é manual: quem envia para o remoto é você'],
  [/\bglab\s+mr\s+(create|new|merge|approve|update)\b/i, 'MR é manual: quem abre, aprova ou faz merge é você'],
  [/\bgh\s+pr\s+(create|merge|review)\b/i, 'PR é manual: quem abre, aprova ou faz merge é você'],
  [/--no-verify\b/i, '--no-verify pula os hooks do repositório; não é permitido'],
];

function liberada() {
  try {
    const ate = fs.readFileSync(path.join(RAIZ, '.claude', 'office', '.liberar-guarda'), 'utf8').trim();
    return Date.parse(ate) > Date.now();
  } catch { return false; }
}

function skillsDoTime() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(RAIZ, 'time', 'skills-origem.json'), 'utf8'));
    return (j.skills || []).map((s) => (typeof s === 'string' ? s : s.nome)).filter(Boolean);
  } catch { return []; }
}

/** Pastas das skills do time instaladas fora de .claude/skills (plugins e QA): ninguém edita, só o APRENDIZADO.md que a própria skill escreve. */
function protegidas() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(RAIZ, 'time', 'skills-origem.json'), 'utf8'));
    const pastas = (j.protegidas || []).map((p) => absoluto(p, RAIZ));
    return { pastas, liberados: new Set(j.liberados || []) };
  } catch { return { pastas: [], liberados: new Set() }; }
}

let lerProtegidas = protegidas; // o autoteste troca por pastas fictícias

function dentro(filho, pai) {
  const rel = path.relative(pai, filho);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function tokens(seg) {
  return (seg.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^["']|["']$/g, ''));
}

function checarRm(comando, cwd) {
  const repos = path.join(RAIZ, 'repos');
  for (const seg of comando.split(/&&|\|\||;|\||\n/)) {
    let t = tokens(seg.trim());
    if (t[0] === 'sudo') t = t.slice(1);
    if (t[0] !== 'rm') continue;
    const flags = t.slice(1).filter((x) => x.startsWith('-'));
    const curtas = flags.filter((f) => !f.startsWith('--')).join('');
    const recursivo = /[rR]/.test(curtas) || flags.includes('--recursive');
    const forcado = /f/.test(curtas) || flags.includes('--force');
    if (!(recursivo && forcado)) continue;
    const alvos = t.slice(1).filter((x) => !x.startsWith('-'));
    if (!alvos.length) continue;
    for (const a of alvos) {
      const abs = absoluto(a, cwd);
      if (!dentro(abs, repos)) return `rm -rf fora de repos/ (${a}) não é permitido`;
    }
  }
  return null;
}

/** PowerShell (e cmd): Remove-Item -Recurse e aliases (rm, del, rd, rmdir, ri, erase), rd /s; só dentro de repos/. */
function checarRemocaoPowerShell(comando, cwd) {
  const repos = path.join(RAIZ, 'repos');
  for (const seg of String(comando).split(/&&|\|\||;|\||\n/)) {
    const t = tokens(seg.trim());
    if (!t.length) continue;
    const nome = t[0].toLowerCase();
    if (!['remove-item', 'rm', 'del', 'erase', 'rd', 'rmdir', 'ri'].includes(nome)) continue;
    const resto = t.slice(1);
    const recursivo = resto.some((x) => /^-r(ec(urse?)?)?$/i.test(x) || /^\/s$/i.test(x)) || /^(rd|rmdir)$/.test(nome) && resto.some((x) => /^\/s$/i.test(x));
    if (!recursivo) continue;
    const alvos = [];
    for (let i = 0; i < resto.length; i++) {
      const x = resto[i];
      if (/^-(path|literalpath)$/i.test(x)) { if (resto[i + 1]) alvos.push(resto[++i]); continue; }
      if (/^-/.test(x) || /^\/[a-z]$/i.test(x)) continue; // -Force, -Recurse, /s, /q
      alvos.push(x);
    }
    for (const a of alvos) {
      for (const um of a.split(',').map((x) => x.trim()).filter(Boolean)) {
        if (!dentro(absoluto(um.replace(/\\/g, '/'), cwd), repos)) return `remoção recursiva fora de repos/ (${um}) não é permitida`; // \ do PowerShell
      }
    }
  }
  return null;
}

/** Retorna null (permitir) ou { motivo, alvo } (negar). */
function decidir(entrada) {
  const ferramenta = entrada.tool_name || '';
  const ti = entrada.tool_input || {};
  if (ferramenta === 'Bash' || ferramenta === 'PowerShell') {
    const cmd = String(ti.command || '');
    for (const [re, motivo] of REGRAS_BASH) if (re.test(cmd)) return { motivo, alvo: cmd };
    const rm = checarRm(cmd, entrada.cwd) || (ferramenta === 'PowerShell' ? checarRemocaoPowerShell(cmd, entrada.cwd) : null);
    if (rm) return { motivo: rm, alvo: cmd };
    return null;
  }
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(ferramenta)) {
    const arq = ti.file_path || ti.notebook_path;
    if (!arq) return null;
    const abs = absoluto(arq, entrada.cwd);
    const rel = path.relative(RAIZ, abs).split(path.sep).join('/');
    if (/^\.claude\/settings(\.local)?\.json$/.test(rel)) return { motivo: 'o settings.json do orquestrador só é editado por você', alvo: rel };
    const prot = lerProtegidas();
    const pasta = prot.pastas.find((pp) => dentro(abs, pp));
    if (pasta && !prot.liberados.has(path.basename(abs))) {
      return { motivo: 'skill do time (plugin ou QA) não se edita; anote o atrito em aprendizado/skills/<skill>.md ou leve ao time pelo MR de aprendizado da própria skill', alvo: abs };
    }
    const m = rel.match(/^\.claude\/skills\/([^/]+)\//);
    if (m && skillsDoTime().includes(m[1])) {
      return { motivo: `a skill "${m[1]}" é do time e não se edita; anote o atrito em aprendizado/skills/${m[1]}.md`, alvo: rel };
    }
  }
  return null;
}

function registrarBloqueio(entrada, d) {
  try {
    const { Loja } = require(path.join(RAIZ, '.claude', 'office', 'estado.js'));
    new Loja().registrar({
      tipo: 'guarda.bloqueio', contexto: process.env.ORQ_CONTEXTO, sessao: entrada.session_id,
      alvo: d.alvo, motivo: d.motivo,
    });
  } catch { /* telemetria nunca impede a decisão */ }
}

const HOME_TESTE = os.homedir() || '/home/teste';
/** No Windows, o mesmo caminho como o Git Bash escreve (/c/Users/...). */
const gitBash = (p) => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, l) => `/${l.toLowerCase()}`);

function autoteste() {
  lerProtegidas = () => ({
    pastas: [path.join(RAIZ, 'repos', 'skills-do-time'), path.join(HOME_TESTE, '.claude', 'plugins', 'cache', 'mkt-exemplo')],
    liberados: new Set(['APRENDIZADO.md']),
  });
  const casos = [
    [{ tool_name: 'Bash', tool_input: { command: 'git push origin feature/x' } }, true],
    [{ tool_name: 'Bash', tool_input: { command: 'cd repos/app && git push -u origin HEAD' } }, true],
    [{ tool_name: 'Bash', tool_input: { command: 'glab mr create --fill' } }, true],
    [{ tool_name: 'Bash', tool_input: { command: 'gh pr merge 12' } }, true],
    [{ tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m x' } }, true],
    [{ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/qualquer' }, cwd: RAIZ }, true],
    [{ tool_name: 'Bash', tool_input: { command: 'rm -rf ../outro' }, cwd: path.join(RAIZ, 'repos') }, true],
    [{ tool_name: 'Bash', tool_input: { command: 'rm -rf repos' }, cwd: RAIZ }, true],
    [{ tool_name: 'Edit', tool_input: { file_path: path.join(RAIZ, '.claude', 'settings.json') } }, true],
    [{ tool_name: 'Bash', tool_input: { command: 'mvn -q test' } }, false],
    [{ tool_name: 'Bash', tool_input: { command: 'git status && git log --oneline -5' } }, false],
    [{ tool_name: 'Bash', tool_input: { command: 'rm -rf repos/app/target' }, cwd: RAIZ }, false],
    [{ tool_name: 'Bash', tool_input: { command: 'rm -f arquivo.tmp' }, cwd: RAIZ }, false],
    [{ tool_name: 'Edit', tool_input: { file_path: path.join(RAIZ, 'repos', 'app', 'pom.xml') } }, false],
    [{ tool_name: 'Read', tool_input: { file_path: path.join(RAIZ, '.claude', 'settings.json') } }, false],
    // skills do time fora de .claude/skills (time/skills-origem.json → protegidas; aqui, pastas fictícias)
    [{ tool_name: 'Edit', tool_input: { file_path: path.join(RAIZ, 'repos', 'skills-do-time', 'skills', 'exemplo', 'SKILL.md') } }, true],
    [{ tool_name: 'Write', tool_input: { file_path: path.join(HOME_TESTE, '.claude', 'plugins', 'cache', 'mkt-exemplo', 'plugin', '1.0.0', 'skills', 'x', 'referencia', 'a.md') } }, true],
    [{ tool_name: 'Edit', tool_input: { file_path: path.join(HOME_TESTE, '.claude', 'plugins', 'cache', 'mkt-exemplo', 'plugin', '1.0.0', 'skills', 'x', 'APRENDIZADO.md') } }, false],
    [{ tool_name: 'Edit', tool_input: { file_path: path.join(RAIZ, 'repos', 'app', 'qa', 'pendencias.md') } }, false],
    [{ tool_name: 'Edit', tool_input: { file_path: '~/.claude/plugins/cache/mkt-exemplo/plugin/1.0.0/skills/x/SKILL.md' } }, true],
    // PowerShell (Claude Code no Windows): as mesmas regras de push e MR, e a remoção recursiva só dentro de repos/
    [{ tool_name: 'PowerShell', tool_input: { command: 'git push origin feature/x' } }, true],
    [{ tool_name: 'PowerShell', tool_input: { command: 'Set-Location repos\\app; glab mr create --fill' } }, true],
    [{ tool_name: 'PowerShell', tool_input: { command: 'Remove-Item -Recurse -Force C:\\temp\\qualquer' }, cwd: RAIZ }, true],
    [{ tool_name: 'PowerShell', tool_input: { command: 'Remove-Item -Path ..\\outro -Recurse' }, cwd: path.join(RAIZ, 'repos') }, true],
    [{ tool_name: 'PowerShell', tool_input: { command: 'rd /s /q ..\\..\\fora' }, cwd: path.join(RAIZ, 'repos') }, true],
    [{ tool_name: 'PowerShell', tool_input: { command: 'rm -r -fo repos' }, cwd: RAIZ }, true],
    [{ tool_name: 'PowerShell', tool_input: { command: 'Remove-Item -Recurse -Force repos\\app\\target' }, cwd: RAIZ }, false],
    [{ tool_name: 'PowerShell', tool_input: { command: 'Get-ChildItem repos; git status' } }, false],
    [{ tool_name: 'PowerShell', tool_input: { command: 'Remove-Item arquivo.tmp' }, cwd: RAIZ }, false],
    // Windows: o /c/... do Git Bash é o mesmo caminho (antes, ficava fora de repos/ por engano)
    ...(WINDOWS ? [
      [{ tool_name: 'Bash', tool_input: { command: `rm -rf ${gitBash(path.join(RAIZ, 'repos', 'app', 'target'))}` }, cwd: RAIZ }, false],
      [{ tool_name: 'Bash', tool_input: { command: `rm -rf ${gitBash(path.join(RAIZ, '.claude'))}` }, cwd: RAIZ }, true],
    ] : []),
  ];
  const falhas = [];
  for (const [entrada, negar] of casos) {
    const d = decidir(entrada);
    if (!!d !== negar) falhas.push(`${negar ? 'deveria negar' : 'deveria liberar'}: ${JSON.stringify(entrada.tool_input)}`);
  }
  // fail-open com entrada malformada
  let travou = false;
  try { decidir({ tool_name: 'Bash', tool_input: null }); decidir({}); } catch { travou = true; }
  if (travou) falhas.push('entrada malformada não pode lançar erro');
  if (falhas.length) { console.error(`autoteste FALHOU:\n- ${falhas.join('\n- ')}`); return 1; }
  console.log(`autoteste OK: ${casos.length} casos de nega/libera + entrada malformada`);
  return 0;
}

async function main() {
  if (process.argv[2] === '--autoteste') { process.exitCode = autoteste(); return; }
  let bruto = '';
  try {
    for await (const ch of process.stdin) bruto += ch;
    const entrada = JSON.parse(bruto || '{}');
    if (liberada()) return;
    const d = decidir(entrada);
    if (!d) return;
    registrarBloqueio(entrada, d);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `[guarda] ${d.motivo}. Se for intencional, peça ao usuário para liberar com: node .claude/office/estado.js liberar-guarda 30`,
      },
    }));
  } catch { /* fail-open */ }
}

main();
