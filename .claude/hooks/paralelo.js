#!/usr/bin/env node
'use strict';
/*
 * paralelo.js — hook PreToolUse da conversa paralela (ORQ_PARALELO=<contexto>).
 *
 * A conversa paralela é uma cópia da líder (fork da sessão) que conversa com o usuário enquanto a líder
 * original trabalha. A cópia só lê e consulta: o settings.json chama este gancho só quando ORQ_PARALELO
 * existe, então a líder e os agentes nunca passam por aqui.
 *
 * Libera: leitura (Read, Grep, Glob, LS, busca na web), MCP de consulta (get/search/list/fetch/...),
 * Bash de leitura (cat, grep, git log/diff/status, glab mr view, docker ps...) e `estado.js recado|status|placar`.
 * Nega todo o resto (edição, agentes, skills, Bash que escreve, MCP que grava).
 * Teste: node .claude/hooks/paralelo.js --autoteste
 */

const LEITURA = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch', 'TodoWrite', 'WebSearch', 'WebFetch', 'BashOutput']);
const MCP_CONSULTA = /^(get|search|list|fetch|lookup|query|read|notion-(fetch|search|get|list|query))/i;
const BASH_LEITURA = new Set(['cat', 'head', 'tail', 'less', 'ls', 'grep', 'rg', 'egrep', 'fgrep', 'find', 'wc', 'sort', 'uniq', 'cut', 'tr', 'jq', 'echo', 'printf', 'pwd', 'date',
  'tree', 'stat', 'file', 'diff', 'du', 'df', 'which', 'basename', 'dirname', 'realpath', 'readlink', 'sed', 'awk', 'cd', 'true', 'column', 'nl', 'xxd', 'md5sum', 'sha256sum']);
const GIT_LEITURA = new Set(['log', 'status', 'diff', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'blame', 'shortlog', 'describe', 'grep', 'remote', 'branch', 'tag', 'reflog', 'cat-file', 'merge-base', 'rev-list']);
const DOCKER_LEITURA = new Set(['ps', 'logs', 'images', 'inspect', 'stats', 'top', 'port', 'version', 'info']);

function tokens(seg) {
  return (seg.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^["']|["']$/g, ''));
}

/** Motivo para negar um segmento de Bash, ou null se é leitura. */
function segmentoNegado(seg) {
  let t = tokens(seg.trim());
  if (!t.length) return null;
  if (t[0] === 'rtk') t = t.slice(t[1] === 'bypass' ? 2 : 1); // RTK só condensa a saída
  const [cmd, sub] = t;
  const resto = t.slice(1);
  if (BASH_LEITURA.has(cmd)) {
    if (cmd === 'sed' && resto.some((x) => /^-[^-]*i|^--in-place/.test(x))) return 'sed -i edita arquivo';
    if (cmd === 'find' && resto.some((x) => /^-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls)$/.test(x))) return 'find com -delete/-exec';
    return null;
  }
  if (cmd === 'git') {
    if (!GIT_LEITURA.has(sub)) return `git ${sub || ''} muda o repositório`;
    if (['branch', 'tag', 'remote'].includes(sub) && resto.slice(1).some((x) => /^-(d|D|m|M|c|C|f)$|^--(delete|move|copy|force|set-upstream|unset-upstream|edit-description)/.test(x) || /^(add|remove|rm|rename|set-url|prune)$/.test(x))) return `git ${sub} com alteração`;
    if (sub === 'tag' && resto.length > 1 && !resto.slice(1).every((x) => /^-(l|n\d*)$|^--(list|contains|sort)/.test(x) || x.includes('*'))) return 'git tag cria tag';
    return null;
  }
  if (cmd === 'glab') {
    if (sub === 'api') return resto.some((x) => /^-(f|F)$|^--(field|raw-field|input)/.test(x)) || /(-X|--method)[\s=]*(POST|PUT|PATCH|DELETE)/i.test(seg) ? 'glab api que grava' : null;
    if (['mr', 'ci', 'issue', 'repo', 'pipeline'].includes(sub) && ['view', 'list', 'diff', 'status', 'get', 'trace'].includes(t[2])) return null;
    return `glab ${sub || ''} ${t[2] || ''} grava ou dispara algo`;
  }
  if (cmd === 'docker') return DOCKER_LEITURA.has(sub) || (sub === 'system' && t[2] === 'df') ? null : `docker ${sub || ''} muda o ambiente`;
  if (cmd === 'node' && /(^|\/)\.claude\/office\/estado\.js$/.test(sub || '')) {
    return ['recado', 'status', 'placar'].includes(t[2]) ? null : `estado.js ${t[2] || ''} muda o estado do contexto (só a líder faz)`;
  }
  return `${cmd} não é comando de leitura`;
}

function bashNegado(comando) {
  const c = String(comando || '');
  if (/\$\(|`|<\(|>\(/.test(c)) return 'substituição de comando';
  const semRedir = c.replace(/\d?>&\d/g, '').replace(/&?\d?>>?\s*\/dev\/null/g, '');
  if (/>/.test(semRedir.replace(/"[^"]*"|'[^']*'/g, ''))) return 'redirecionamento para arquivo';
  for (const seg of semRedir.split(/&&|\|\||;|\||\n|&/)) {
    const m = segmentoNegado(seg);
    if (m) return m;
  }
  return null;
}

/** Motivo para negar a chamada, ou null se a cópia pode fazer. */
function decidir(e) {
  const nome = String(e.tool_name || '');
  if (LEITURA.has(nome)) return null;
  if (nome.startsWith('mcp__')) return MCP_CONSULTA.test(nome.split('__').pop()) ? null : `${nome.split('__').pop()} grava fora daqui`;
  if (nome === 'Bash') return bashNegado((e.tool_input || {}).command);
  return `${nome} não é leitura`;
}

async function main() {
  try {
    let bruto = '';
    for await (const ch of process.stdin) bruto += ch;
    const e = JSON.parse(bruto || '{}');
    if (!process.env.ORQ_PARALELO) return;
    const motivo = decidir(e);
    if (!motivo) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `[conversa paralela] só leitura: ${motivo}. Você é a cópia que conversa com o ENG; a líder é quem faz. Para mudar algo, encaminhe a decisão com: node .claude/office/estado.js recado --contexto ${process.env.ORQ_PARALELO} --texto "..."`,
      },
    }));
  } catch { /* fail-open: a cópia segue */ }
}

function autoteste() {
  const casos = [
    [{ tool_name: 'Read' }, true], [{ tool_name: 'Edit' }, false], [{ tool_name: 'Write' }, false], [{ tool_name: 'Agent' }, false], [{ tool_name: 'Skill' }, false],
    [{ tool_name: 'mcp__claude_ai_Atlassian__getJiraIssue' }, true], [{ tool_name: 'mcp__claude_ai_Atlassian__transitionJiraIssue' }, false],
    [{ tool_name: 'mcp__claude_ai_Notion__notion-fetch' }, true], [{ tool_name: 'mcp__claude_ai_Notion__notion-update-page' }, false],
    ['cat specs/x/spec.md | head -40', true], ['rtk grep -n foo src', true], ['git log --oneline -5 && git status', true], ['git diff HEAD~1 2>/dev/null', true],
    ['git commit -m x', false], ['git push', false], ['git branch -D feat/x', false], ['git checkout main', false],
    ['node .claude/office/estado.js recado --contexto c1 --texto "use o banco X"', true], ['node .claude/office/estado.js status', true],
    ['node .claude/office/estado.js pergunta --contexto c1 --texto x', false], ['node .claude/office/estado.js passo --contexto c1 --passo p --status DONE', false],
    ['echo x > arquivo.txt', false], ['cat $(rm -rf /)', false], ['sed -i s/a/b/ f', false], ['find . -name x -delete', false],
    ['mvn test', false], ['rm -rf repos/x', false], ['glab mr view 21', true], ['glab mr merge 21', false], ['glab api projects/1/merge_requests', true],
    ['glab api -X POST projects/1/notes', false], ['glab api --method=PUT projects/1', false], ['glab api projects/1/notes -f body=x', false], ['docker ps', true], ['docker rm x', false], ['cd repos/x && git log -3', true],
  ];
  let falhas = 0;
  for (const [entrada, ok] of casos) {
    const e = typeof entrada === 'string' ? { tool_name: 'Bash', tool_input: { command: entrada } } : entrada;
    const m = decidir(e);
    if (!m !== ok) { falhas++; console.log(`FALHA ${JSON.stringify(entrada)} → ${m || 'liberado'}`); }
  }
  console.log(falhas ? `${falhas} FALHA(S)` : `paralelo.js: ${casos.length} casos ok`);
  process.exit(falhas ? 1 : 0);
}

if (require.main === module) { if (process.argv.includes('--autoteste')) autoteste(); else main(); }
module.exports = { decidir, bashNegado };
