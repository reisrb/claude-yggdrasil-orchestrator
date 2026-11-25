#!/usr/bin/env node
'use strict';
/*
 * instanciar.js — gera um orquestrador para um time a partir do Yggdrasil.
 *
 *   node scripts/instanciar.js <destino> <respostas.json> [--semear-memoria] [--forcar]
 *
 * respostas.json:
 * {
 *   "nome": "Odin", "time": "Nome do time", "tema": "nordico|neutro", "maxContextos": 2, "porta": 4321,
 *   "modo": "aprendizado|misto|direto",   // checkpoints: todos manuais | spec e plano manuais | todos automáticos
 *   "contexto": { "projeto": "", "trabalho": "", "objetivo": "", "stacks": "", "ferramentas": "", "origemSkills": "", "aprovacoes": "", "observacoes": "" },
 *   "tarefas": { "destino": "arquivo|notion|outro", "arquivo": { "pasta": "anotacoes" }, "outro": { "instrucoes": "" }, "daily": true, "artefato": { "ativo": false } },  // skill /tarefas
 *   "registro": { "resumo": "", "onde": [""], "instrucoes": "", "permitir": [""] },   // opcional: troca o padrão do 📝 Registrar (/tarefas)
 *   "regras": ["regra do time", "..."],
 *   "memoria": ["fato para a memória inicial do Claude nesta pasta", "..."]
 * }
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MOLDE = path.resolve(__dirname, '..');
const MANIFESTO = JSON.parse(fs.readFileSync(path.join(MOLDE, '.claude', 'nucleo-manifesto.json'), 'utf8'));
const VERSAO = fs.readFileSync(path.join(MOLDE, 'NUCLEO_VERSAO'), 'utf8').trim();

function ignorado(rel) {
  return MANIFESTO.ignorar.some((p) => (p.endsWith('/') ? rel.split('/').includes(p.slice(0, -1))
    : p.startsWith('*.') ? rel.endsWith(p.slice(1)) // ex.: *.exe (o app do Windows compilado)
      : path.basename(rel) === p));
}

/** Lista os arquivos (relativos ao molde) de uma entrada do manifesto. */
function arquivosDa(entrada, base = MOLDE) {
  const abs = path.join(base, entrada);
  if (!fs.existsSync(abs)) return [];
  if (!entrada.endsWith('/')) return [entrada];
  const out = [];
  const andar = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      const rel = path.relative(base, p).split(path.sep).join('/');
      if (ignorado(rel)) continue;
      if (d.isDirectory()) andar(p); else out.push(rel);
    }
  };
  andar(abs);
  return out;
}

function arquivosDoNucleo(base = MOLDE) {
  return [...new Set(MANIFESTO.nucleo.flatMap((e) => arquivosDa(e, base)))];
}

function copiar(rel, destino) {
  const de = path.join(MOLDE, rel);
  const para = path.join(destino, rel);
  fs.mkdirSync(path.dirname(para), { recursive: true });
  fs.copyFileSync(de, para);
}

function preencher(texto, vars) {
  return texto.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

function escrever(destino, rel, conteudo) {
  const p = path.join(destino, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, conteudo);
}

/** Pasta de memória do Claude Code para um diretório de projeto. */
function pastaMemoria(destino) {
  const nome = path.resolve(destino).replace(/[^A-Za-z0-9]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', nome, 'memory');
}

function semearMemoria(destino, r) {
  const dir = pastaMemoria(destino);
  fs.mkdirSync(dir, { recursive: true });
  const hoje = new Date().toISOString().slice(0, 10);
  const arq = path.join(dir, 'contexto-inicial.md');
  if (!fs.existsSync(arq)) {
    const fatos = (r.memoria || []).map((f) => `- ${f}`).join('\n') || '- (sem fatos extras na entrevista)';
    fs.writeFileSync(arq, `---
name: contexto-inicial
description: Contexto inicial do orquestrador ${r.nome} do time ${r.time}, registrado na criação da instância em ${hoje}
metadata:
  type: project
---
Orquestrador **${r.nome}** do time **${r.time}**, gerado pelo Yggdrasil (núcleo v${VERSAO}) em ${hoje}.

${fatos}

**Why:** contexto da entrevista do /novo-orquestrador; o detalhe versionado fica em time/contexto.md e time/regras.md.
**How to apply:** use como pano de fundo ao conduzir os ciclos; o que estiver em time/ prevalece se divergir.
`);
  }
  const indice = path.join(dir, 'MEMORY.md');
  const linha = `- [Contexto inicial do ${r.nome}](contexto-inicial.md) — time ${r.time}, criado em ${hoje}`;
  const atual = fs.existsSync(indice) ? fs.readFileSync(indice, 'utf8') : '';
  if (!atual.includes('contexto-inicial.md')) fs.writeFileSync(indice, `${atual}${atual && !atual.endsWith('\n') ? '\n' : ''}${linha}\n`);
  return dir;
}

function main() {
  const args = process.argv.slice(2);
  const [destinoArg, respostasArg] = args.filter((a) => !a.startsWith('--'));
  if (!destinoArg || !respostasArg) {
    console.error('uso: node scripts/instanciar.js <destino> <respostas.json> [--semear-memoria] [--forcar]');
    process.exit(2);
  }
  const destino = path.resolve(destinoArg);
  const r = JSON.parse(fs.readFileSync(path.resolve(respostasArg), 'utf8'));
  if (!r.nome || !r.time) { console.error('respostas.json precisa de "nome" e "time"'); process.exit(2); }
  if (fs.existsSync(destino) && fs.readdirSync(destino).length && !args.includes('--forcar')) {
    console.error(`destino não está vazio: ${destino} (use --forcar para continuar mesmo assim)`);
    process.exit(3);
  }
  fs.mkdirSync(destino, { recursive: true });

  // 1) núcleo
  const arquivos = arquivosDoNucleo();
  for (const rel of arquivos) copiar(rel, destino);

  // 2) settings, CLAUDE.md, README, .gitignore
  copiar('.claude/settings.json', destino);
  const porta = r.porta || 4321;
  const vars = { NOME: r.nome, TIME: r.time, VERSAO, PORTA: porta };
  escrever(destino, '.claude/CLAUDE.md', preencher(fs.readFileSync(path.join(MOLDE, 'scripts/modelos/CLAUDE.instancia.md'), 'utf8'), vars));
  escrever(destino, 'README.md', preencher(fs.readFileSync(path.join(MOLDE, 'scripts/modelos/README.instancia.md'), 'utf8'), vars));
  escrever(destino, '.gitignore', fs.readFileSync(path.join(MOLDE, 'scripts/modelos/gitignore'), 'utf8'));

  // 3) config
  const base = JSON.parse(fs.readFileSync(path.join(MOLDE, 'orquestrador.json'), 'utf8'));
  // modo de trabalho: aprendizado (pergunta em cada etapa), misto (só spec e plano) ou direto (roda o fluxo inteiro)
  const MODOS = {
    aprendizado: { modo: 'aprendizado', checkpoints: { spec: 'manual', plano: 'manual', passo: 'manual' } },
    misto: { modo: 'autonomo', checkpoints: { spec: 'manual', plano: 'manual', passo: 'auto' } },
    direto: { modo: 'autonomo', checkpoints: { spec: 'auto', plano: 'auto', passo: 'auto' } },
  };
  const m = MODOS[r.modo] || MODOS.aprendizado;
  const cfg = { ...base, nome: r.nome, time: r.time, modo: m.modo, maxContextos: r.maxContextos || base.maxContextos || 2, porta, checkpoints: m.checkpoints };
  // skill /tarefas: onde a pessoa anota (o 📝 Registrar grava lá por padrão)
  const tarefas = { destino: 'arquivo', arquivo: { pasta: 'anotacoes' }, notion: { pagina: '', tarefas: '', dailys: '' }, outro: { instrucoes: '' }, daily: true, ...(r.tarefas || {}) };
  // página opcional no claude.ai: com a resposta da entrevista, já vem como perguntada
  const art = (r.tarefas && r.tarefas.artefato) || {};
  tarefas.artefato = { ativo: !!art.ativo, perguntado: art.ativo !== undefined, url: '' };
  if (!['arquivo', 'notion', 'outro'].includes(tarefas.destino)) tarefas.destino = 'arquivo';
  const pasta = String((tarefas.arquivo && tarefas.arquivo.pasta) || 'anotacoes').replace(/^\/+|\/+$/g, '') || 'anotacoes';
  tarefas.arquivo = { pasta };
  if (cfg.registro && tarefas.destino === 'arquivo') {
    cfg.registro = { ...cfg.registro, permitir: ['Skill(tarefas)', `Edit(${pasta}/*)`, `Write(${pasta}/*)`] };
    cfg.registro.onde = [...cfg.registro.onde.slice(0, 2), `Arquivos markdown em ${pasta}/ (destino em time/tarefas.json)`];
  } else if (cfg.registro && tarefas.destino !== 'arquivo') {
    // Notion ou outro: o /tarefas configurar acrescenta ao permitir o que a gravação precisa (ex.: o conector)
    cfg.registro = { ...cfg.registro, onde: [...cfg.registro.onde.slice(0, 2), tarefas.destino === 'notion' ? 'No Notion (rode /tarefas configurar para criar os bancos)' : `Onde time/tarefas.json descreve: ${tarefas.outro.instrucoes || '(a descrever)'}`], permitir: ['Skill(tarefas)'] };
  }
  if (r.registro && (r.registro.resumo || r.registro.instrucoes)) cfg.registro = r.registro; // destino próprio, no lugar do /tarefas
  // onde o Office roda: o app da bandeja sobe o servidor pelo wsl.exe ou direto no node.exe do Windows (sem WSL)
  cfg.app = { ...(base.app || {}), executar: (r.app && r.app.executar) || (process.platform === 'win32' ? 'windows' : 'wsl') };
  escrever(destino, 'orquestrador.json', JSON.stringify(cfg, null, 2) + '\n');

  // 4) camada do time
  const c = r.contexto || {};
  escrever(destino, 'time/contexto.md', `# Contexto do time ${r.time}

- **Time:** ${r.time}
- **Projeto:** ${c.projeto || '_(a preencher)_'}
- **O que tem para fazer:** ${c.trabalho || '_(a preencher)_'}
- **Objetivo:** ${c.objetivo || '_(a preencher)_'}
- **Stacks e plataformas:** ${c.stacks || '_(a preencher)_'}
- **Ferramentas:** ${c.ferramentas || '_(a preencher)_'}
- **De onde vêm as skills do time:** ${c.origemSkills || '_(a preencher)_'}
- **Quem aprova o quê:** ${c.aprovacoes || '_(a preencher)_'}
${c.observacoes ? `\n## Observações\n${c.observacoes}\n` : ''}`);
  const regras = (r.regras || []).map((x) => `- ${x}`).join('\n') || '_(nenhuma ainda)_';
  escrever(destino, 'time/regras.md', `# Regras do time ${r.time}\n\n> Só **acrescentam** restrições ao \`nucleo.md\`, nunca afrouxam.\n\n${regras}\n`);
  escrever(destino, 'time/tarefas.json', JSON.stringify(tarefas, null, 2) + '\n');
  escrever(destino, 'time/tema.json', JSON.stringify({ base: r.tema || 'neutro', herois: {} }, null, 2) + '\n');
  escrever(destino, 'time/skills-origem.json', JSON.stringify({ _comentario: 'Skills do time. Cópia em .claude/skills/ (liste o nome) ou instalada fora: plugin do Claude Code ou workspace repos/ (informe nome, pasta, invocar e origem; <versão> e ~ são resolvidos). O guarda.js barra edição nas listadas e nas pastas em protegidas, menos os arquivos em liberados.', protegidas: [], liberados: ['APRENDIZADO.md'], skills: [] }, null, 2) + '\n');
  fs.mkdirSync(path.join(destino, 'time', 'fluxos'), { recursive: true });
  fs.copyFileSync(path.join(MOLDE, 'time', 'fluxos', 'demo.json'), path.join(destino, 'time', 'fluxos', 'demo.json'));
  for (const d of ['repos', 'aprendizado/repos', 'aprendizado/skills', 'specs']) {
    fs.mkdirSync(path.join(destino, d), { recursive: true });
    if (d !== 'specs') fs.writeFileSync(path.join(destino, d, '.gitkeep'), '');
  }

  // 5) scripts de manutenção (só o atualizador; o instanciador fica no molde)
  escrever(destino, 'scripts/atualizar-nucleo.md', `# Atualizar o núcleo\n\nNo Yggdrasil (${MOLDE}):\n\n    node scripts/atualizar-nucleo.js "${destino}" --dry-run\n    node scripts/atualizar-nucleo.js "${destino}"\n`);

  // 6) git
  try { execFileSync('git', ['init', '-q'], { cwd: destino }); } catch { console.warn('aviso: git init falhou (git instalado?)'); }

  // 7) memória
  let mem = null;
  if (args.includes('--semear-memoria')) mem = semearMemoria(destino, r);

  console.log(`Orquestrador ${r.nome} criado em ${destino}`);
  console.log(`  núcleo v${VERSAO}: ${arquivos.length} arquivos · tema ${r.tema || 'neutro'} · porta ${porta} · maxContextos ${cfg.maxContextos} · modo ${r.modo && MODOS[r.modo] ? r.modo : 'aprendizado'} · /tarefas em ${tarefas.destino === 'arquivo' ? `${pasta}/` : tarefas.destino}${r.registro ? ' · registro próprio' : ''}`);
  if (mem) console.log(`  memória inicial em ${mem}`);
  console.log('Próximos passos: traga as skills do time (cópia em .claude/skills/, plugin do Claude Code ou workspace repos/) e registre em time/skills-origem.json; crie os fluxos em time/fluxos/; abra o Claude Code na pasta e rode /office.');
}

module.exports = { arquivosDoNucleo, pastaMemoria, MANIFESTO, MOLDE, VERSAO };
if (require.main === module) main();
