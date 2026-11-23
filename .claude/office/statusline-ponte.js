#!/usr/bin/env node
'use strict';
/*
 * statusline-ponte.js — fica na frente da sua statusline do Claude Code.
 *
 * A Claude Code entrega os limites de uso (sessão de 5 h e semana, com horário de renovação)
 * só para o comando da statusline. Esta ponte guarda esses números em ~/.claude/orq-limites.json
 * (o Office lê dali) e repassa a mesma entrada para a sua statusline de sempre, que continua
 * desenhando a linha do terminal igual.
 *
 * Em ~/.claude/settings.json:
 *   "statusLine": { "type": "command",
 *     "command": "node /caminho/do/molde/.claude/office/statusline-ponte.js -- <seu comando de statusline>" }
 * Sem "-- <comando>", só grava o arquivo e imprime um resumo curto.
 * Nunca quebra a statusline: qualquer erro da ponte é ignorado.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ARQ = path.join(os.homedir(), '.claude', 'orq-limites.json');

let entrada = '';
process.stdin.on('data', (d) => { entrada += d; });
process.stdin.on('end', () => {
  try {
    const j = JSON.parse(entrada.replace(/^﻿/, '') || '{}');
    if (j.rate_limits) {
      const tmp = `${ARQ}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ ts: new Date().toISOString(), rate_limits: j.rate_limits, custo: j.cost || null }));
      fs.renameSync(tmp, ARQ);
    }
  } catch (e) {
    // a ponte nunca derruba a statusline; o erro fica num arquivo para diagnóstico
    try { fs.writeFileSync(path.join(os.tmpdir(), 'orq-ponte-erro.txt'), `${new Date().toISOString()} HOME=${os.homedir()} ${e && e.message}\n`); } catch { /* nada */ }
  }

  const i = process.argv.indexOf('--');
  const comando = i >= 0 ? process.argv.slice(i + 1).join(' ') : '';
  if (!comando) {
    try {
      const r = (JSON.parse(entrada || '{}').rate_limits) || {};
      const p = (x) => (x && x.used_percentage != null ? `${Math.ceil(x.used_percentage)}%` : '–');
      process.stdout.write(`5h ${p(r.five_hour)} · semana ${p(r.seven_day)}`);
    } catch { /* nada */ }
    return;
  }
  const filho = spawn(comando, { shell: true, stdio: ['pipe', 'inherit', 'inherit'] });
  filho.on('error', () => process.exit(0));
  filho.stdin.on('error', () => {});
  filho.stdin.end(entrada);
  filho.on('close', (c) => process.exit(c || 0));
});
