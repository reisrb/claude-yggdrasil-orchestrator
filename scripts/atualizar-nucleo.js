#!/usr/bin/env node
'use strict';
/*
 * atualizar-nucleo.js — leva o núcleo do Yggdrasil para uma instância existente.
 *
 *   node scripts/atualizar-nucleo.js <instancia> --dry-run   # só mostra o que mudaria
 *   node scripts/atualizar-nucleo.js <instancia>             # aplica (com tag git de rollback)
 *
 * Substitui por inteiro os arquivos listados em .claude/nucleo-manifesto.json.
 * Mescla .claude/settings.json (união de hooks e permissões, mantendo o defaultMode da instância).
 * Nunca toca em time/, specs/<repo>/, aprendizado/, repos/ nem nas skills do time.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { arquivosDoNucleo, MOLDE, VERSAO } = require('./instanciar.js');

function ler(p) { try { return fs.readFileSync(p); } catch { return null; } }

function mesclarSettings(molde, inst) {
  const out = JSON.parse(JSON.stringify(inst || {}));
  out.permissions = out.permissions || {};
  const pm = molde.permissions || {};
  for (const k of ['allow', 'deny', 'ask']) {
    if (!pm[k]) continue;
    out.permissions[k] = [...new Set([...(out.permissions[k] || []), ...pm[k]])];
  }
  if (!out.permissions.defaultMode && pm.defaultMode) out.permissions.defaultMode = pm.defaultMode;
  out.hooks = out.hooks || {};
  for (const [evento, grupos] of Object.entries(molde.hooks || {})) {
    const atuais = out.hooks[evento] || (out.hooks[evento] = []);
    for (const g of grupos) {
      const cmds = (g.hooks || []).map((h) => h.command);
      const existe = atuais.some((a) => (a.matcher || '') === (g.matcher || '') && cmds.every((c) => (a.hooks || []).some((h) => h.command === c)));
      if (!existe) atuais.push(g);
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const alvo = args.find((a) => !a.startsWith('--'));
  const seco = args.includes('--dry-run');
  if (!alvo) { console.error('uso: node scripts/atualizar-nucleo.js <instancia> [--dry-run]'); process.exit(2); }
  const inst = path.resolve(alvo);
  if (!fs.existsSync(path.join(inst, 'NUCLEO_VERSAO')) || !fs.existsSync(path.join(inst, '.claude', 'nucleo.md'))) {
    console.error(`${inst} não parece uma instância do Yggdrasil (falta NUCLEO_VERSAO ou .claude/nucleo.md)`);
    process.exit(3);
  }
  const versaoInst = fs.readFileSync(path.join(inst, 'NUCLEO_VERSAO'), 'utf8').trim();
  // skill do núcleo desligada na instância (.claude/skills-desativadas/<nome>): atualiza lá, sem religar
  const destino = (rel) => {
    const m = rel.match(/^\.claude\/skills\/([^/]+)\/(.*)$/);
    if (m && fs.existsSync(path.join(inst, '.claude', 'skills-desativadas', m[1]))) return `.claude/skills-desativadas/${m[1]}/${m[2]}`;
    return rel;
  };
  const novos = [], alterados = [];
  for (const rel0 of arquivosDoNucleo()) {
    const rel = destino(rel0);
    const a = ler(path.join(MOLDE, rel0));
    const b = ler(path.join(inst, rel));
    if (!b) novos.push([rel0, rel]); else if (!a.equals(b)) alterados.push([rel0, rel]);
  }
  const orfaos = arquivosDoNucleo(inst).filter((rel) => !fs.existsSync(path.join(MOLDE, rel)));
  const sMolde = JSON.parse(fs.readFileSync(path.join(MOLDE, '.claude', 'settings.json'), 'utf8'));
  const caminhoSettings = path.join(inst, '.claude', 'settings.json');
  const sInst = JSON.parse(ler(caminhoSettings) || '{}');
  const sNovo = mesclarSettings(sMolde, sInst);
  const settingsMuda = JSON.stringify(sNovo) !== JSON.stringify(sInst);

  console.log(`Núcleo: instância v${versaoInst} → molde v${VERSAO}`);
  const lista = (l) => l.map(([, d]) => d);
  console.log(`  novos: ${novos.length}${novos.length ? `\n    + ${lista(novos).join('\n    + ')}` : ''}`);
  console.log(`  alterados: ${alterados.length}${alterados.length ? `\n    ~ ${lista(alterados).join('\n    ~ ')}` : ''}`);
  if (orfaos.length) console.log(`  só na instância (não removidos): ${orfaos.length}\n    ? ${orfaos.join('\n    ? ')}`);
  console.log(`  settings.json: ${settingsMuda ? 'será mesclado' : 'sem mudança'}`);
  if (seco) { console.log('(dry-run: nada foi gravado)'); return; }
  if (!novos.length && !alterados.length && !settingsMuda && versaoInst === VERSAO) { console.log('Nada a fazer.'); return; }

  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: inst, stdio: 'ignore' });
    const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
    const tag = `pre-nucleo-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    execFileSync('git', ['tag', tag], { cwd: inst, stdio: 'ignore' });
    console.log(`  rollback: git tag ${tag}`);
  } catch { console.warn('  aviso: sem commit na instância, então sem tag de rollback (faça um commit antes, se quiser)'); }

  for (const [rel0, rel] of [...novos, ...alterados]) {
    const para = path.join(inst, rel);
    fs.mkdirSync(path.dirname(para), { recursive: true });
    fs.copyFileSync(path.join(MOLDE, rel0), para);
  }
  if (settingsMuda) fs.writeFileSync(caminhoSettings, JSON.stringify(sNovo, null, 2) + '\n');
  fs.writeFileSync(path.join(inst, 'NUCLEO_VERSAO'), VERSAO + '\n');
  console.log(`Núcleo atualizado para v${VERSAO}.`);
}

main();
