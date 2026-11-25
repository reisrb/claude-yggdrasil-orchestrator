#!/usr/bin/env node
'use strict';
/*
 * recado.js — hook PostToolUse: entrega à líder, SEM cortar o turno, o que o usuário mandou pelo Office
 * enquanto ela trabalhava (Enviar com o turno rodando, ou decisão encaminhada pela conversa paralela).
 *
 * O Office espelha a fila do turno no arquivo de ORQ_FILA (runs/<ctx>/fila.json). O settings.json só chama
 * este gancho quando esse arquivo existe e não está vazio, então ele custa nada quando não há recado.
 * Entrega só à líder (chamada de subagente traz agent_id) e anota os ids em fila.entregues; o Office tira da
 * fila e põe na conversa. O que não for entregue até o fim do turno segue como antes, no turno seguinte.
 * Nunca bloqueia: qualquer erro sai com 0 e o recado continua na fila.
 */
const fs = require('fs');

function itensPendentes(arq, base) {
  let itens = [];
  try { itens = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return []; }
  let ja = new Set();
  try { ja = new Set(fs.readFileSync(`${base}.entregues`, 'utf8').split('\n').filter(Boolean)); } catch { /* nada entregue ainda */ }
  return (Array.isArray(itens) ? itens : []).filter((x) => x && x.id && x.texto && !ja.has(x.id));
}

function textoParaLider(ctx, novos) {
  return [
    `[Office] Mensagem do ENG enviada enquanto você trabalhava (contexto ${ctx}). Chegou sem interromper o turno:`,
    ...novos.map((x) => `- ${x.deParalelo ? '(decisão que ele deu na conversa paralela, com uma cópia sua) ' : ''}${x.texto}`),
    'Leve em conta a partir de agora e siga o trabalho. Se ela muda o que um agente que está rodando faz, decida se espera ele terminar e ajusta depois, ou se relança só ele (nunca em dobro).',
    `Se ela pede resposta, responda em uma ou duas linhas no texto (aparece na conversa) e continue. Se precisar de uma decisão dele, use estado.js pergunta --contexto ${ctx} e encerre o turno.`,
  ].join('\n');
}

async function main() {
  let bruto = '';
  for await (const ch of process.stdin) bruto += ch;
  const e = JSON.parse(bruto || '{}');
  const arq = process.env.ORQ_FILA;
  const ctx = process.env.ORQ_CONTEXTO;
  if (!arq || !ctx || e.agent_id || process.env.ORQ_PARALELO) return;
  const base = arq.replace(/\.json$/, '');
  const trava = `${base}.trava`;
  let fd;
  try { fd = fs.openSync(trava, 'wx'); } catch {
    // ferramentas em paralelo: outro gancho já está entregando. Trava velha (gancho que morreu) sai depois de 30 s.
    try { if (Date.now() - fs.statSync(trava).mtimeMs > 30000) fs.rmSync(trava, { force: true }); } catch { /* sumiu */ }
    return;
  }
  try {
    const novos = itensPendentes(arq, base);
    if (!novos.length) return;
    fs.appendFileSync(`${base}.entregues`, novos.map((x) => x.id).join('\n') + '\n');
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: textoParaLider(ctx, novos) } }));
  } finally {
    try { fs.closeSync(fd); fs.rmSync(trava, { force: true }); } catch { /* ok */ }
  }
}

if (require.main === module) main().catch(() => {});
module.exports = { itensPendentes, textoParaLider };
