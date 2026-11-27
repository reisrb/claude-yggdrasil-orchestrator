// fluxos.js — Organizador de fluxos: uma faixa por projeto (contexto), da esquerda para a direita.
// Mostra em que etapa cada agente está, o que já passou, o que vem a seguir e os ramos paralelos.
import { quadro } from './escritorio/sprites.js';
import { specPorEstilo, nomeDoWorker, nomeDaLider, animPorAtividade, servicoDe, rotuloContexto } from './escritorio/cena.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COR = { PENDING: '#3a4057', ACTIVE: '#4bb7e5', DONE: '#2ecc71', BLOCKED: '#8b93a7', WAITING_APPROVAL: '#ffd34d', ERROR: '#ff6b6b' };
const ICONE = { PENDING: '○', ACTIVE: '◉', DONE: '✓', BLOCKED: '⏸', WAITING_APPROVAL: '!', ERROR: '✗' };
const ROT_CTX = { TRABALHANDO: 'trabalhando', PRECISA_DE_VOCE: 'precisa de você', BLOQUEADO: '⛔ bloqueado', PAUSADO: 'pausado', PAUSADO_LIMITE: 'pausado (limite)', ERRO: 'erro', CONCLUIDO: 'concluído', PARADO: 'parado', EM_ESPERA: 'em espera' };
const ROT_ST = { PENDING: 'pendente', ACTIVE: 'em andamento', DONE: 'concluída', BLOCKED: 'parada ou outro ramo', WAITING_APPROVAL: 'esperando você', ERROR: 'erro' };
const ROT_EX = { skill: '🤖 skill', eng: '👤 você', automatico: '⚙ automático' }; // eng = etapa feita pela pessoa
const COL = 250, LIN = 96, NW = 184, NH = 74, MX = 18, MY = 26;

function layout(nodes, edges) {
  const prof = new Map(nodes.map((n) => [n.id, 0]));
  for (let k = 0; k < nodes.length; k++) for (const e of edges) if (prof.has(e.to) && prof.has(e.from)) prof.set(e.to, Math.max(prof.get(e.to), prof.get(e.from) + 1));
  const colunas = new Map();
  for (const n of nodes) { const d = prof.get(n.id); if (!colunas.has(d)) colunas.set(d, []); colunas.get(d).push(n); }
  const maxLin = Math.max(1, ...[...colunas.values()].map((l) => l.length));
  const pos = new Map();
  for (const [d, lista] of colunas) {
    const off = ((maxLin - lista.length) * LIN) / 2;
    lista.forEach((n, i) => pos.set(n.id, { x: MX + d * COL, y: MY + off + i * LIN }));
  }
  const ncol = Math.max(1, ...[...colunas.keys()].map((d) => d + 1));
  return { pos, largura: MX * 2 + (ncol - 1) * COL + NW, altura: MY * 2 + (maxLin - 1) * LIN + NH + 26 };
}

/** Passo desativado no fluxo (decisão do usuário): igual ao estado.js → desativadoDo. */
function desativadoDo(p) {
  const d = p && p.desativado;
  if (!d) return null;
  return typeof d === 'string' ? { motivo: d, desde: null } : { motivo: (typeof d === 'object' && d.motivo) || null, desde: (typeof d === 'object' && d.desde) || null };
}
/** Arestas do fluxo com atalho por cima do passo desativado (igual ao estado.js → arestasDoFluxo). */
function arestasDoFluxo(passos) {
  const edges = passos.flatMap((p) => (p.depende || []).map((d) => ({ from: d, to: p.id })));
  const off = new Map(passos.filter((p) => desativadoDo(p)).map((p) => [p.id, p]));
  const antes = (id, visto) => { if (visto.has(id)) return []; visto.add(id); return off.has(id) ? (off.get(id).depende || []).flatMap((d) => antes(d, visto)) : [id]; };
  for (const p of passos) {
    if (off.has(p.id)) continue;
    for (const d of p.depende || []) if (off.has(d)) for (const a of antes(d, new Set())) edges.push({ from: a, to: p.id, atalho: true });
  }
  return edges;
}

/* ------------------------------------------------------------------ previsão */
/** Campo `previsao` do passo no fluxo: número (minutos) ou texto como "2h", "30 min", "1,5 h", "3 dias", "2 sem". */
function previsaoDoFluxo(p) {
  const v = p && p.previsao;
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 0 ? v * 60000 : null;
  const m = String(v).trim().toLowerCase().match(/^([\d.,]+)\s*(min|m|h|hs|hora|horas|d|dia|dias|sem|semana|semanas)?$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  const u = m[2] || 'h';
  const fator = u.startsWith('m') ? 60e3 : u.startsWith('h') ? 3600e3 : u.startsWith('d') ? 86400e3 : 7 * 86400e3;
  return n > 0 ? n * fator : null;
}
/** 40 min · 2,5 h · 3 dias · 2 sem (tempo de relógio). */
function duracao(ms) {
  const min = Math.max(0, ms) / 60000;
  if (min < 59.5) return `${Math.max(1, Math.round(min))} min`;
  const h = min / 60;
  if (h < 23.95) return `${h.toLocaleString('pt-BR', { minimumFractionDigits: h < 10 ? 1 : 0, maximumFractionDigits: h < 10 ? 1 : 0 })} h`;
  const d = Math.round((h / 24) * 2) / 2;
  if (d < 14) return `${d.toLocaleString('pt-BR')} dia${d > 1 ? 's' : ''}`;
  return `${Math.round(d / 7)} sem`;
}
/** Tempo curto para a marca ⏱ de execução da etapa: 35 min · 2h05 · 1d 3h. */
function curto(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return `${h}h${String(m).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
/** Ramo (`quando`) de cada etapa, herdado de quem vem antes: as etapas depois de "Migrar" são do ramo Migrar. */
function ramosDoFluxo(nodes, edges) {
  const memo = new Map();
  const ramo = (n, visto = new Set()) => {
    if (memo.has(n.id)) return memo.get(n.id);
    if (n.quando) { memo.set(n.id, n.quando); return n.quando; }
    if (visto.has(n.id)) return null;
    visto.add(n.id);
    const pais = edges.filter((e) => e.to === n.id).map((e) => nodes.find((x) => x.id === e.from)).filter(Boolean).map((p) => ramo(p, visto));
    const r = pais.length && pais.every((x) => x && x === pais[0]) ? pais[0] : null;
    memo.set(n.id, r);
    return r;
  };
  for (const n of nodes) ramo(n);
  return memo;
}
/**
 * Previsão do fluxo: total e o que falta, somando as etapas que ainda vão rodar (feitas entram com o tempo real).
 * Ramo ainda não escolhido: um cenário por ramo. Etapa desativada, pausada ou do outro ramo fica fora.
 */
function previsaoDoTodo(nodes, edges, prevDe, decorrido) {
  const ramo = ramosDoFluxo(nodes, edges);
  const ramos = [...new Set([...ramo.values()].filter(Boolean))];
  const escolhidos = ramos.filter((b) => nodes.some((n) => ramo.get(n.id) === b && ['ACTIVE', 'DONE', 'WAITING_APPROVAL', 'ERROR'].includes(n.status)));
  const cenarios = escolhidos.length ? [escolhidos] : ramos.length ? ramos.map((b) => [b]) : [[]];
  return cenarios.map((bs) => {
    let total = 0, falta = 0, sem = 0, conta = 0;
    for (const n of nodes) {
      const b = ramo.get(n.id);
      if ((b && !bs.includes(b)) || n.desativado || n.status === 'BLOCKED') continue;
      const p = prevDe(n);
      if (n.status === 'DONE') { if (n.duracaoMs != null) { total += n.duracaoMs; conta++; } else if (p) { total += p.ms; conta++; } continue; }
      if (!p) { sem++; continue; }
      conta++;
      total += p.ms;
      falta += ['ACTIVE', 'WAITING_APPROVAL', 'ERROR'].includes(n.status) ? Math.max(p.ms - decorrido(n), 0) : p.ms;
    }
    return { ramo: bs.join(' / '), total, falta, sem, conta };
  });
}

/** Próximas etapas: sucessores diretos do que está em andamento/esperando; sem nada ativo, as raízes pendentes. */
function aSeguir(nodes, edges) {
  const off = new Set(nodes.filter((n) => n.desativado).map((n) => n.id)); // passo desativado nunca é "a seguir"
  edges = edges.filter((e) => !off.has(e.from) && !off.has(e.to));
  nodes = nodes.filter((n) => !off.has(n.id));
  const st = new Map(nodes.map((n) => [n.id, n.status]));
  const ativos = nodes.filter((n) => ['ACTIVE', 'WAITING_APPROVAL', 'ERROR', 'BLOCKED'].includes(n.status)).map((n) => n.id);
  const prox = new Set();
  if (ativos.length) { for (const e of edges) if (ativos.includes(e.from) && st.get(e.to) === 'PENDING') prox.add(e.to); }
  else {
    for (const n of nodes) {
      if (n.status !== 'PENDING') continue;
      const pais = edges.filter((e) => e.to === n.id).map((e) => st.get(e.from));
      if (pais.every((s) => s === 'DONE')) prox.add(n.id);
    }
  }
  return prox;
}

export function criarFluxos(raiz, { onAbrirContexto, onConvocar } = {}) {
  raiz.innerHTML = `
    <div class="fx-barra">
      <div class="fx-topo">
        <div><h2 class="fx-titulo">Organizador de fluxos</h2><small class="fx-sub">em que etapa cada agente está e o que vem a seguir · clique numa etapa para ver o detalhe</small></div>
        <input class="fx-busca" type="search" placeholder="Buscar por nome ou card (ex.: MOPR-2387)" aria-label="Buscar projeto ou fluxo por nome ou card do Jira" autocomplete="off" spellcheck="false">
      </div>
      <div class="fx-filtros"></div>
    </div>
    <div class="fx-faixas"></div>
    <div class="fx-dt-fundo" hidden></div>
    <aside class="fx-detalhe" hidden role="dialog" aria-label="Detalhe da etapa"></aside>`;
  const filtros = raiz.querySelector('.fx-filtros');
  const caixaBusca = raiz.querySelector('.fx-busca');
  const faixas = raiz.querySelector('.fx-faixas');
  const gaveta = raiz.querySelector('.fx-detalhe');
  const fundo = raiz.querySelector('.fx-dt-fundo');
  let dados = null, filtro = 'todos', assinatura = '';
  // filtros fixos + busca por nome ou card; nada de um botão por projeto. 'todos' = em andamento (sem os bloqueados)
  const FIXOS = ['todos', 'voce', 'bloqueados', 'concluidos', 'catalogo'];
  let busca = '', focoPendente = null;
  // contexto com a conversa aberta na lateral: a faixa dele ganha a borda azul de foco
  let conversaAberta = null;
  const marcarConversa = () => {
    for (const f of faixas.querySelectorAll('[data-faixa]')) f.classList.toggle('conversa-aberta', f.dataset.faixa === conversaAberta);
  };
  const norm = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const casa = (...campos) => !busca.trim() || campos.some((x) => norm(x).includes(norm(busca.trim())));
  const casaCtx = (c) => casa(c.repo, c.titulo, servicoDe(c), rotuloContexto(c), c.fluxoNome, c.id);
  const casaFluxo = (f) => casa(f.nome, f.id, f.missao, f.descricao);
  /**
   * Previsão de uma etapa, em tempo de trabalho: média das últimas execuções (histórico do Office) ou o campo
   * `previsao` do passo. Etapa feita por você ou por uma automação de fora (executor eng/automatico): o Office não
   * mede esse trabalho, então a `previsao` do fluxo, se houver, vale mais que o histórico.
   */
  function prevDoPasso(fluxoId, passoId) {
    const fl = dados.catalogo.fluxos.find((f) => f.id === fluxoId);
    const passo = fl && fl.passos.find((p) => p.id === passoId);
    const cfg = previsaoDoFluxo(passo);
    const h = dados.state.previsoes && dados.state.previsoes[fluxoId] && dados.state.previsoes[fluxoId][passoId];
    const deFora = passo && ['eng', 'automatico'].includes(passo.executor);
    if (cfg && (deFora || !(h && h.mediaMs > 0))) return { ms: cfg, fonte: 'fluxo' };
    if (h && h.mediaMs > 0) return { ms: h.mediaMs, fonte: 'historico', n: h.n, amostras: h.amostras || [] };
    return null;
  }
  /** Tempo de trabalho da etapa em andamento: o já fechado mais o trecho que está correndo agora. */
  function decorrido(c, n) {
    if (!n || !n.inicio || n.fim) return 0;
    const correndo = c.trabalhandoDesde ? Math.max(0, Date.now() - Math.max(Date.parse(c.trabalhandoDesde), Date.parse(n.inicio))) : 0;
    return (n.trabalhoMs || 0) + correndo;
  }
  /** Tempo de execução da etapa em andamento: só pensando ou executando (esperar a sua resposta, pausa, parada, erro e bloqueio não contam). */
  function rodando(c, n) {
    if (!n || !n.inicio || n.fim || n.trabalhoMs == null) return null;
    return { ms: decorrido(c, n), correndo: !!c.trabalhandoDesde };
  }
  const fontePrev = (p) => (p.fonte !== 'historico' ? 'estimativa do fluxo' : p.n > 1 ? `média das últimas ${p.n} execuções` : 'tempo da única execução até agora');

  /** Abre um projeto (link #/fluxos?ctx=, botão Fluxo da conversa): o grupo dele com a busca já preenchida. */
  function aplicarFoco(ctxId) {
    const c = dados && dados.state.contextos.find((x) => x.id === ctxId);
    if (!c) { focoPendente = dados ? null : ctxId; return; }
    focoPendente = null;
    filtro = c.status === 'CONCLUIDO' ? 'concluidos' : c.status === 'BLOQUEADO' ? 'bloqueados' : 'todos';
    busca = c.repo;
    caixaBusca.value = busca;
  }
  let sel = null, htmlDt = ''; // etapa aberta no painel de detalhe: { fluxoId, passoId, ctxId }

  const lista = (titulo, itens, cls = '') => (itens && itens.length
    ? `<section class="fx-dt-sec ${cls}"><h4>${titulo}</h4>${cls === 'num' ? '<ol>' : '<ul>'}${itens.map((i) => `<li>${esc(i)}</li>`).join('')}${cls === 'num' ? '</ol>' : '</ul>'}</section>` : '');

  function htmlPrevisao(fluxoId, passoId, ctx, no) {
    const pv = prevDoPasso(fluxoId, passoId);
    const aqui = no && no.inicio ? (no.fim ? `Neste projeto: levou ${duracao(no.duracaoMs || 0)} de trabalho${no.relogioMs ? ` (${duracao(no.relogioMs)} no relógio, contando a espera)` : ''}.`
      : `Neste projeto: ${duracao(decorrido(ctx, no))} de trabalho até agora${pv ? ` · ${decorrido(ctx, no) > pv.ms ? 'passou da previsão' : `faltam ~${duracao(pv.ms - decorrido(ctx, no))}`}` : ''}.`) : '';
    return `<section class="fx-dt-sec fx-dt-prev"><h4>Previsão</h4><p>${pv
      ? `<b>~${duracao(pv.ms)}</b> de trabalho · ${fontePrev(pv)}${pv.fonte === 'historico' ? (pv.n > 1 ? ` (${pv.amostras.map(duracao).join(', ')})` : '') : ' (campo <code>previsao</code> do passo)'}`
      : 'Sem previsão ainda: nenhuma execução desta etapa terminou. Dá para pôr uma estimativa no campo <code>previsao</code> do passo em time/fluxos/ (ex.: <code>"2h"</code>, <code>"3 dias"</code>).'}
      ${aqui ? `<br><small>${esc(aqui)}</small>` : ''}<br><small>Tempo de trabalho: só o tempo com a líder (ou a sua sessão) trabalhando. A espera por você, pausa, erro e bloqueio não contam.${['eng', 'automatico'].includes((dados.catalogo.fluxos.find((f) => f.id === fluxoId)?.passos.find((p) => p.id === passoId) || {}).executor) ? ' Nesta etapa quem faz é você (ou uma automação de fora): o Office não mede esse tempo, então uma estimativa no campo previsao do passo vale mais que o histórico.' : ''}</small></p></section>`;
  }

  /** Detalhe de uma etapa: o que a skill faz (campo `detalhe` do passo em time/fluxos) e, num projeto, o estado dela. */
  function htmlDetalhe(s) {
    const fl = dados.catalogo.fluxos.find((f) => f.id === s.fluxoId);
    const passo = fl && fl.passos.find((p) => p.id === s.passoId);
    if (!passo) return '';
    const ctx = s.ctxId && dados.state.contextos.find((c) => c.id === s.ctxId);
    const no = ctx && ctx.atlas.nodes.find((n) => n.id === passo.id);
    const d = passo.detalhe || {};
    const ex = passo.executor || 'skill';
    const chip = (p) => `<button type="button" class="fx-dt-chip" data-ir="${esc(p.id)}">${esc(p.nome || p.id)}${p.quando ? ` <small>(${esc(p.quando)})</small>` : ''}</button>`;
    const vemDe = (passo.depende || []).map((id) => fl.passos.find((p) => p.id === id) || { id });
    const levaA = fl.passos.filter((p) => (p.depende || []).includes(passo.id));
    const quemAqui = ctx ? ctx.agents.filter((a) => a.passo === passo.id && ['WORKING', 'WAITING_APPROVAL'].includes(a.status)) : [];
    const off = desativadoDo(passo);
    const aviso = off ? `<div class="fx-dt-desligado"><b>⊘ Desativado${off.desde ? ` desde ${esc(off.desde)}` : ''}</b>: fica fora do fluxo e não executa em nenhuma missão até você decidir voltar (tire o <code>desativado</code> do passo em time/fluxos/).${off.motivo ? `<br><small>${esc(off.motivo)}</small>` : ''}</div>` : '';
    const estado = no ? `<div class="fx-dt-estado" style="--c:${COR[no.status]}"><b>${ICONE[no.status]} ${esc(ROT_ST[no.status] || no.status)}</b> em ${esc(rotuloContexto(ctx))}${no.resumo ? ` · ${esc(no.resumo)}` : ''}${quemAqui.length ? `<br><small>agora: ${quemAqui.map((a) => esc(a.skill || a.role)).join(', ')}</small>` : ''}</div>` : '';
    return `
      <header class="fx-dt-topo">
        <div><small>${esc(fl.nome)}${passo.quando ? ` · ramo ${esc(passo.quando)}` : ''}</small><h3>${esc(passo.nome || passo.id)}</h3></div>
        <button type="button" class="btn mini" data-fechar-dt aria-label="Fechar">✕</button>
      </header>
      <div class="fx-dt-corpo">
        <div class="fx-dt-meta"><span class="fx-dt-ex ex-${ex}">${ROT_EX[ex] || ex}</span><code>${esc(passo.skill || 'sem skill')}</code></div>
        ${aviso}${estado}${off ? '' : htmlPrevisao(fl.id, passo.id, ctx, no)}
        ${d.oQue ? `<p class="fx-dt-oque">${esc(d.oQue)}</p>` : '<p class="fx-dt-vazio">Sem detalhe escrito para esta etapa (campo <code>detalhe</code> do passo em time/fluxos/).</p>'}
        ${d.quem ? `<p class="fx-dt-quem"><b>Quem faz:</b> ${esc(d.quem)}</p>` : passo.papel ? `<p class="fx-dt-quem"><b>Papel:</b> ${esc(passo.papel)}</p>` : ''}
        ${lista('Precisa antes', d.entrada)}
        ${lista('O que acontece', d.passos, 'num')}
        ${lista('O que sai', d.entrega)}
        ${lista('Quando para e pergunta', d.paradas)}
        ${lista('Nunca faz', d.nunca, 'nunca')}
        ${lista('Atenção', d.atencao, 'atencao')}
        ${d.comando ? `<section class="fx-dt-sec"><h4>Como chamar</h4><code class="fx-dt-cmd">${esc(d.comando)}</code></section>` : ''}
        ${vemDe.length || levaA.length ? `<section class="fx-dt-sec fx-dt-nav">${vemDe.length ? `<div><h4>Vem de</h4>${vemDe.map(chip).join('')}</div>` : ''}${levaA.length ? `<div><h4>Leva a</h4>${levaA.map(chip).join('')}</div>` : ''}</section>` : ''}
        ${d.fonte ? `<p class="fx-dt-fonte">Fonte: ${esc(d.fonte)}</p>` : ''}
      </div>
      ${ctx ? `<footer class="fx-dt-rodape"><button type="button" class="btn primario mini" data-abrir="${esc(ctx.id)}">abrir conversa de ${esc(rotuloContexto(ctx))}</button></footer>` : ''}`;
  }

  function desenharDetalhe() {
    if (!sel || !dados) return;
    const h = htmlDetalhe(sel);
    if (!h) { fecharDetalhe(); return; }
    if (h !== htmlDt || gaveta.hidden) {
      const corpo = gaveta.querySelector('.fx-dt-corpo');
      const rol = htmlDt && corpo ? corpo.scrollTop : 0; // mesma etapa: mantém a rolagem
      gaveta.innerHTML = h; htmlDt = h;
      const novo = gaveta.querySelector('.fx-dt-corpo'); if (novo) novo.scrollTop = rol;
    }
    gaveta.hidden = false; fundo.hidden = false;
  }
  function fecharDetalhe() { sel = null; htmlDt = ''; gaveta.hidden = true; fundo.hidden = true; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel) fecharDetalhe(); });

  function avatar(spec) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 24;
    c.getContext('2d').drawImage(quadro(spec, 'pe', 'baixo', 0), 0, 0);
    return c.toDataURL();
  }

  function faixaContexto(c) {
    const tema = dados.tema;
    const estiloL = (tema.lideres && tema.lideres.estilo) || 'pessoa';
    const estiloW = (tema.trabalhadores && tema.trabalhadores.estilo) || 'pessoa';
    // passo desativado vem do fluxo em time/fluxos (também com um servidor que ainda não reiniciou)
    const passosFl = ((dados.catalogo.fluxos.find((f) => f.id === c.fluxoId) || {}).passos) || [];
    const nodes = (c.atlas.nodes.length ? c.atlas.nodes : []).map((n) => {
      const p = passosFl.find((x) => x.id === n.id);
      return p && p.desativado && !n.desativado ? { ...n, desativado: desativadoDo(p) } : n;
    });
    const edges = c.atlas.edges.some((e) => e.atalho) || !passosFl.some((p) => p.desativado) ? c.atlas.edges
      : [...c.atlas.edges, ...arestasDoFluxo(passosFl).filter((e) => e.atalho && nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to))];
    const { pos, largura, altura } = layout(nodes, edges);
    const prox = aSeguir(nodes, edges);
    // "agora": a etapa em andamento, esperando você ou com erro; sem nenhuma, a última que o agente tocou e, por fim,
    // uma pausada (⏸). Etapa pulada ou desativada não é "agora" (antes, a pausada que vinha primeiro roubava o lugar)
    const vivos = nodes.filter((n) => !n.desativado);
    const agoraId = (vivos.find((n) => ['WAITING_APPROVAL', 'ACTIVE', 'ERROR'].includes(n.status)) || {}).id
      || (vivos.some((n) => n.id === c.passoAtual) ? c.passoAtual : null)
      || (vivos.find((n) => n.status === 'BLOCKED') || {}).id || c.passoAtual;
    // ⛔ bloqueado: a etapa onde parou fica vermelha (não o azul de "em andamento") e nada aparece andando
    const bloq = c.status === 'BLOQUEADO';
    const b = c.bloqueio || {};
    const ativosPorPasso = new Map();
    for (const a of c.agents) if (a.status === 'WORKING' || a.status === 'WAITING_APPROVAL') {
      const p = a.passo || c.passoAtual; if (!p) continue;
      if (!ativosPorPasso.has(p)) ativosPorPasso.set(p, []);
      ativosPorPasso.get(p).push(a);
    }
    const ramos = []; // rótulo do ramo condicional: selo no meio da curva, por cima da linha
    const arestas = [...edges].sort((a, b) => (a.atalho ? 1 : 0) - (b.atalho ? 1 : 0)).map((e) => {
      const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) return '';
      const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x - 3, y2 = b.y + NH / 2, mx = (x1 + x2) / 2;
      const de = nodes.find((n) => n.id === e.from), para = nodes.find((n) => n.id === e.to);
      if ((de && de.desativado) || (para && para.desativado)) return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" class="fx-aresta desligada"/>`;
      const feito = de && de.status === 'DONE' && para && para.status !== 'PENDING';
      const vivo = !bloq && de && ['ACTIVE', 'WAITING_APPROVAL'].includes(de.status) && prox.has(e.to);
      const cond = !!(para && para.quando) && !e.atalho;
      if (cond) ramos.push(`<span class="fx-ramo${feito ? ' feito' : ''}" style="left:${Math.round(mx)}px;top:${Math.round((y1 + y2) / 2)}px" title="ramo: ${esc(para.quando)}">${esc(para.quando)}</span>`);
      const seta = feito ? 'ok' : vivo ? 'v' : cond ? 'c' : 'n';
      return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" class="fx-aresta${feito ? ' feita' : ''}${vivo ? ' viva' : ''}${cond ? ' condicional' : ''}" marker-end="url(#fx-seta-${seta})"/>`;
    }).join('');
    const nos = nodes.map((n) => {
      const p = pos.get(n.id); if (!p) return '';
      const st = n.status;
      const quem = ativosPorPasso.get(n.id) || [];
      const liderAqui = agoraId === n.id && !n.desativado && !['CONCLUIDO', 'PARADO'].includes(c.status);
      const avs = [
        ...(liderAqui ? [`<img src="${avatar(specPorEstilo(estiloL, c.repo))}" title="${esc(nomeDaLider(tema, c.repo))} (líder)" class="fx-av lider">`] : []),
        ...quem.slice(0, 4).map((a) => `<img src="${avatar(specPorEstilo(estiloW, a.skill, ((tema.herois || {})[a.skill] || {}).cores || {}))}" title="${esc(nomeDoWorker(tema, a.skill))} · ${esc(a.role)}" class="fx-av">`),
      ].join('');
      const at = quem.length && c.atividade && c.atividade.workers && c.atividade.workers[quem[0].id];
      const anim = at ? animPorAtividade(at.tipo) : null;
      const linhaAt = anim ? `${anim.icone} ${esc(at.tipo)}${at.alvo ? ` · ${esc(at.alvo)}` : ''}` : esc(n.resumo || n.papel || '');
      const ex = n.executor || 'skill';
      const off = n.desativado;
      const parado = !off && bloq && (n.id === agoraId || ['ACTIVE', 'WAITING_APPROVAL'].includes(st));
      const vezSua = !bloq && ex === 'eng' && ['ACTIVE', 'WAITING_APPROVAL'].includes(st);
      const marca = off ? '<span class="fx-tag desligado">desativado</span>' : parado ? '<span class="fx-tag bloq">bloqueado</span>' : vezSua ? '<span class="fx-tag sua">sua vez</span>' : !bloq && prox.has(n.id) ? '<span class="fx-tag">a seguir</span>' : '';
      const pv = off ? null : prevDoPasso(c.fluxoId, n.id);
      const emCurso = ['ACTIVE', 'WAITING_APPROVAL', 'ERROR'].includes(st) && n.inicio && !n.fim;
      const dec = emCurso ? decorrido(c, n) : 0;
      let tempo = '', barra = '';
      if (!off && st === 'DONE' && n.duracaoMs != null) tempo = `<span class="fx-prev feito" title="levou ${duracao(n.duracaoMs)} de trabalho${n.relogioMs ? ` (${duracao(n.relogioMs)} no relógio, contando a espera)` : ''}">${duracao(n.duracaoMs)}</span>`;
      else if (pv) {
        tempo = `<span class="fx-prev" title="${esc(`previsão ~${duracao(pv.ms)} de trabalho (${fontePrev(pv)})${emCurso ? ` · ${duracao(dec)} de trabalho até agora · ${dec > pv.ms ? 'passou da previsão' : `faltam ~${duracao(pv.ms - dec)}`}` : ''}`)}">~${duracao(pv.ms)}</span>`;
        if (emCurso) barra = `<i class="fx-barra-prev${dec > pv.ms ? ' passou' : ''}" style="--p:${Math.min(100, Math.round((dec / pv.ms) * 100))}%"></i>`;
      }
      const rod = emCurso && !off ? rodando(c, n) : null;
      const marcaRod = rod ? `<span class="fx-rodando${rod.correndo ? '' : ' parado'}" title="${esc(`${curto(rod.ms)} de execução: só o tempo pensando ou executando. Esperar a sua resposta, pausa, parada, erro e bloqueio não contam${rod.correndo ? '' : ' (o relógio está parado agora)'}. No relógio: ${duracao(Date.now() - Date.parse(n.inicio))} desde que a etapa começou.`)}">⏱ ${curto(rod.ms)}</span>` : '';
      const linha = off ? '⊘ fora do fluxo até você decidir' : parado ? `⛔ ${esc(b.quem ? `depende de ${b.quem}` : 'esperando algo de fora')}` : linhaAt;
      return `<div class="fx-no st-${st} ex-${ex}${prox.has(n.id) && !bloq ? ' prox' : ''}${parado ? ' parado-bloq' : ''}${off ? ' desativado' : ''}" style="left:${p.x}px;top:${p.y}px;--c:${parado ? COR.ERROR : off ? COR.PENDING : COR[st]}" data-ctx="${esc(c.id)}" data-fluxo="${esc(c.fluxoId)}" data-passo="${esc(n.id)}" title="${esc([off ? `desativado${off.desde ? ` desde ${off.desde}` : ''}${off.motivo ? `: ${off.motivo}` : ''}` : '', parado ? `bloqueado: ${b.texto || ''}` : '', n.papel, n.resumo, 'clique para ver o detalhe'].filter(Boolean).join(' · '))}">
        <div class="fx-no-topo"><span class="fx-ico">${off ? '⊘' : parado ? '⛔' : ICONE[st]}</span><b>${esc(n.label || n.id)}</b>${marca}${marcaRod}</div>
        <div class="fx-cod"><code>${ex === 'automatico' ? '⚙ automático' : ex === 'eng' ? `👤 você${n.skill ? ` · ${esc(n.skill)}` : ''}` : esc(n.skill || 'skill a confirmar')}</code>${tempo}</div>
        <div class="fx-linha">${avs}<span>${linha}</span></div>${barra}
      </div>`;
    }).join('');
    const atual = nodes.find((n) => n.id === agoraId);
    const prevTodo = previsaoDoTodo(nodes, edges, (n) => prevDoPasso(c.fluxoId, n.id), (n) => decorrido(c, n));
    const catalogo = String(c.id).startsWith('fluxo:');
    let prevTxt = '';
    const real = nodes.reduce((t, n) => t + (n.duracaoMs || 0), 0);
    if (c.status === 'CONCLUIDO') prevTxt = real ? ` · <span class="fx-prev-total" title="Soma do tempo de trabalho de cada etapa (sem a espera por você, pausa, erro e bloqueio)">⏱ levou ${duracao(real)} de trabalho</span>` : '';
    else if (prevTodo.some((x) => x.conta)) {
      const sem = Math.max(...prevTodo.map((x) => x.sem));
      const rot = (x) => (prevTodo.length > 1 ? ` (${esc(x.ramo)})` : '');
      const partes = catalogo ? prevTodo.map((x) => `~${duracao(x.total)}${rot(x)}`)
          : prevTodo.map((x) => `faltam ~${duracao(x.falta)} de ~${duracao(x.total)}${rot(x)}`);
      prevTxt = ` · <span class="fx-prev-total" title="Previsão em tempo de trabalho: só o tempo com a líder (ou a sua sessão) trabalhando; a espera por você, pausa, erro e bloqueio não contam. Vem da média das últimas execuções de cada etapa ou do campo previsao do passo.">⏱ trabalho: ${partes.join(' ou ')}${sem ? ` · ${sem} etapa${sem > 1 ? 's' : ''} sem previsão` : ''}</span>`;
    }
    const proxNomes = [...prox].map((id) => (nodes.find((n) => n.id === id) || {}).label || id);
    const pergunta = c.pergunta ? `<div class="fx-pergunta">❓ ${esc(c.pergunta.texto)} <button class="btn primario mini" data-abrir="${esc(c.id)}" type="button">Responder</button></div>`
      : bloq ? `<div class="fx-bloqueio">⛔ <b>Bloqueado</b>${b.quem ? ` · depende de <b>${esc(b.quem)}</b>` : ''}${b.texto ? `: ${esc(b.texto)}` : ''}${b.desde ? ` <small>desde ${esc(new Date(b.desde).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</small>` : ''}</div>` : '';
    return `<section class="fx-faixa st-ctx-${c.status}" data-faixa="${esc(c.id)}">
      <header class="fx-cab">
        <img src="${avatar(specPorEstilo(estiloL, c.repo))}" class="fx-av grande" alt="">
        <div class="fx-cab-txt"><div><b>${esc(c.repo)}</b>${servicoDe(c) ? ` <span class="ctx-servico">${esc(servicoDe(c))}</span>` : ''} <span class="chip st-${c.status}">${ROT_CTX[c.status] || c.status}</span></div>
          <small>${esc(nomeDaLider(tema, c.repo))} · ${esc(c.fluxoNome)}${atual ? ` · ${bloq ? 'parado em' : 'agora'}: <b>${esc(atual.label)}</b>${!bloq && atual.status === 'WAITING_APPROVAL' ? ' (esperando você)' : ''}` : ''}${proxNomes.length ? ` · ${bloq ? 'depois' : 'a seguir'}: ${esc(proxNomes.join(', '))}` : ''}${prevTxt}</small></div>
        <button class="btn mini" data-abrir="${esc(c.id)}" type="button">abrir conversa</button>
      </header>
      ${pergunta}
      <div class="fx-grafo-rolagem"><div class="fx-grafo" style="width:${largura}px;height:${altura}px">
        <svg width="${largura}" height="${altura}"><defs>
          ${[['ok', '#2ecc71'], ['n', '#4a5172'], ['c', '#b58d16'], ['v', '#4bb7e5']].map(([k, cor]) => `<marker id="fx-seta-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto"><path d="M0,1 L10,5 L0,9 z" fill="${cor}"/></marker>`).join('')}
        </defs>${arestas}</svg>${ramos.join('')}${nos || '<p class="fx-vazio">sem etapas registradas ainda</p>'}
      </div></div>
    </section>`;
  }

  function faixaCatalogo(f) {
    const nodes = f.passos.map((p) => ({ id: p.id, label: p.nome || p.id, skill: p.skill, status: 'PENDING', executor: p.executor || 'skill', quando: p.quando || null, papel: p.papel || null, desativado: desativadoDo(p) }));
    const edges = arestasDoFluxo(f.passos);
    const falso = { id: `fluxo:${f.id}`, fluxoId: f.id, repo: f.missao || f.nome, fluxoNome: f.descricao || '', status: 'PARADO', atlas: { nodes, edges }, agents: [], passoAtual: null };
    return faixaContexto(falso)
      .replace(/<span class="chip st-PARADO">parado<\/span>/, `<span class="chip">${f.passos.length} etapa(s)</span>`)
      .replace(/<button class="btn mini" data-abrir="[^"]*" type="button">abrir conversa<\/button>/, `<button class="btn primario mini" data-convocar="${esc(f.id)}" type="button">Convocar missão</button>`)
      .replace(/<img src="[^"]*" class="fx-av grande" alt="">/, '<span class="fx-av-fluxo">⑂</span>');
  }

  function desenhar() {
    const st = dados.state;
    const visiveis = st.contextos.filter((c) => c.fluxoId !== 'chat' && (c.status !== 'PARADO' || c.baia != null));
    const ordem = { PRECISA_DE_VOCE: 0, ERRO: 1, TRABALHANDO: 2, EM_ESPERA: 2.5, PAUSADO: 3, PAUSADO_LIMITE: 3, BLOQUEADO: 4, CONCLUIDO: 5, PARADO: 6 };
    visiveis.sort((a, b) => (ordem[a.status] - ordem[b.status]) || b.atualizadoEm.localeCompare(a.atualizadoEm));
    // concluídos saem da lista de projetos e ficam num filtro só deles (o mais recente primeiro)
    const concluidos = visiveis.filter((c) => c.status === 'CONCLUIDO');
    // em andamento: o que segue (rodando, esperando você, pausado, com erro), sem os bloqueados, que esperam algo de fora
    const andamento = visiveis.filter((c) => !['CONCLUIDO', 'BLOQUEADO'].includes(c.status));
    const esperandoVoce = andamento.filter((c) => c.status === 'PRECISA_DE_VOCE');
    const bloqueados = visiveis.filter((c) => c.status === 'BLOQUEADO');
    const nAnd = andamento.filter(casaCtx).length, nVoce = esperandoVoce.filter(casaCtx).length;
    const nBloq = bloqueados.filter(casaCtx).length, nConc = concluidos.filter(casaCtx).length;
    const nFluxos = dados.catalogo.fluxos.filter(casaFluxo).length;
    filtros.innerHTML = [
      `<button type="button" class="chip-ramo${filtro === 'todos' ? ' sel' : ''}" data-f="todos" style="--c:${COR.ACTIVE}" title="O que está seguindo: rodando, esperando você, pausado ou com erro (sem os bloqueados)">Em andamento (${nAnd})</button>`,
      `<button type="button" class="chip-ramo${filtro === 'voce' ? ' sel' : ''}" data-f="voce" style="--c:${COR.WAITING_APPROVAL}" title="Só os que estão esperando a sua resposta">Precisa de você (${nVoce})</button>`,
      `<button type="button" class="chip-ramo${filtro === 'bloqueados' ? ' sel' : ''}" data-f="bloqueados" style="--c:${COR.ERROR}" title="Só os fluxos parados por algo de fora (decisão, acesso, credencial, outra área)">⛔ Bloqueados (${nBloq})</button>`,
      `<button type="button" class="chip-ramo${filtro === 'concluidos' ? ' sel' : ''}" data-f="concluidos" style="--c:${COR.DONE}" title="Só os fluxos que já terminaram, do mais recente para o mais antigo">Concluídos (${nConc})</button>`,
      `<button type="button" class="chip-ramo${filtro === 'catalogo' ? ' sel' : ''}" data-f="catalogo" style="--c:#8b93a7" title="Os fluxos de time/fluxos/, com o botão para convocar">Fluxos disponíveis (${nFluxos})</button>`,
    ].join('');
    let html;
    const semNada = (onde) => `<p class="fx-vazio">Nada encontrado para "<b>${esc(busca.trim())}</b>" em ${onde}. <a href="#" data-limpar>Limpar a busca</a></p>`;
    if (filtro === 'catalogo') html = dados.catalogo.fluxos.filter(casaFluxo).map(faixaCatalogo).join('') || (busca.trim() ? semNada('fluxos disponíveis') : '<p class="fx-vazio">Nenhum fluxo em time/fluxos/.</p>');
    else {
      const lista = (filtro === 'bloqueados' ? bloqueados
        : filtro === 'voce' ? esperandoVoce
          : filtro === 'concluidos' ? [...concluidos].sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm))
            : andamento).filter(casaCtx);
      const outros = [bloqueados.length ? `${bloqueados.length} em <a href="#" data-f="bloqueados">bloqueados</a>` : '', concluidos.length ? `${concluidos.length} em <a href="#" data-f="concluidos">concluídos</a>` : ''].filter(Boolean).join(', ');
      html = lista.map(faixaContexto).join('') || (busca.trim() ? semNada({ todos: 'em andamento', voce: 'precisa de você', bloqueados: 'bloqueados', concluidos: 'concluídos' }[filtro] || 'projetos')
        : filtro === 'concluidos'
        ? '<p class="fx-vazio">Nenhum fluxo concluído ainda.</p>'
        : filtro === 'bloqueados' ? '<p class="fx-vazio">Nenhum fluxo bloqueado agora.</p>'
        : filtro === 'voce' ? '<p class="fx-vazio">Nenhum fluxo esperando você agora.</p>'
        : `<p class="fx-vazio">Nenhum projeto em andamento${outros ? ` (${outros})` : ''}. Veja os <a href="#" data-f="catalogo">fluxos disponíveis</a> ou convoque uma missão.</p>`);
    }
    // redesenhar não pode mexer na rolagem: a vertical da lista e a lateral de cada faixa voltam para onde estavam
    const rolagem = faixas.scrollTop;
    const lateral = new Map([...faixas.querySelectorAll('[data-faixa]')].map((f) => [f.dataset.faixa, f.querySelector('.fx-grafo-rolagem')?.scrollLeft || 0]));
    faixas.innerHTML = html;
    for (const f of faixas.querySelectorAll('[data-faixa]')) {
      const x = lateral.get(f.dataset.faixa);
      const r = x && f.querySelector('.fx-grafo-rolagem');
      if (r) r.scrollLeft = x;
    }
    faixas.scrollTop = rolagem;
    marcarConversa();
  }

  raiz.addEventListener('click', (e) => {
    if (e.target === fundo || e.target.closest('[data-fechar-dt]')) { fecharDetalhe(); return; }
    const ir = e.target.closest('[data-ir]');
    if (ir && sel) { sel = { ...sel, passoId: ir.dataset.ir }; htmlDt = ''; desenharDetalhe(); return; }
    if (e.target.closest('[data-limpar]')) { e.preventDefault(); busca = ''; caixaBusca.value = ''; assinatura = ''; desenhar(); caixaBusca.focus(); return; }
    const f = e.target.closest('[data-f]');
    if (f) { e.preventDefault(); filtro = f.dataset.f; assinatura = ''; desenhar(); return; }
    // abrir a conversa ou convocar fecha a gaveta da etapa: senão ela fica por cima do que acabou de abrir
    const a = e.target.closest('[data-abrir]'); if (a) { fecharDetalhe(); return onAbrirContexto && onAbrirContexto(a.dataset.abrir); }
    const v = e.target.closest('[data-convocar]'); if (v) { fecharDetalhe(); return onConvocar && onConvocar(v.dataset.convocar); }
    const no = e.target.closest('.fx-no[data-passo]');
    if (no) { sel = { fluxoId: no.dataset.fluxo, passoId: no.dataset.passo, ctxId: no.dataset.ctx.startsWith('fluxo:') ? null : no.dataset.ctx }; htmlDt = ''; desenharDetalhe(); }
  });

  caixaBusca.addEventListener('input', () => { busca = caixaBusca.value; assinatura = ''; if (dados) desenhar(); });
  caixaBusca.addEventListener('keydown', (e) => { if (e.key === 'Escape' && caixaBusca.value) { e.stopPropagation(); caixaBusca.value = ''; busca = ''; assinatura = ''; if (dados) desenhar(); } });

  return {
    atualizar(d) {
      dados = d;
      if (focoPendente) aplicarFoco(focoPendente);
      if (!FIXOS.includes(filtro)) filtro = 'todos';
      const assin = JSON.stringify([filtro, busca, Math.floor(Date.now() / 60000), d.state.previsoes, d.catalogo.fluxos.map((f) => [f.id, f.passos.map((p) => p.previsao)]), d.state.contextos.map((c) => [c.id, c.status, c.passoAtual, c.pergunta && c.pergunta.id, c.bloqueio, c.atlas, c.agents.map((a) => [a.id, a.status]), c.atividade])]);
      if (sel) desenharDetalhe();
      if (assin === assinatura) return;
      assinatura = assin;
      desenhar();
    },
    focar(ctxId) {
      if (!ctxId || FIXOS.includes(ctxId)) { filtro = ctxId || 'todos'; busca = ''; caixaBusca.value = ''; } else { focoPendente = ctxId; if (dados) aplicarFoco(ctxId); }
      assinatura = ''; if (dados) desenhar();
    },
    // painel avisa qual conversa está aberta na lateral (null = nenhuma); só troca a classe, sem redesenhar
    conversa(ctxId) {
      conversaAberta = ctxId || null;
      marcarConversa();
    },
    abrirPasso(ref, ctxId) {
      const [fluxoId, passoId] = String(ref).split(':');
      sel = { fluxoId, passoId, ctxId: ctxId && !FIXOS.includes(ctxId) ? ctxId : null }; htmlDt = '';
      desenharDetalhe();
    },
  };
}
