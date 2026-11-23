// fluxos.js — Organizador de fluxos: uma faixa por projeto (contexto), da esquerda para a direita.
// Mostra em que etapa cada agente está, o que já passou, o que vem a seguir e os ramos paralelos.
import { quadro } from './escritorio/sprites.js';
import { specPorEstilo, nomeDoWorker, nomeDaLider, animPorAtividade, servicoDe, rotuloContexto } from './escritorio/cena.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COR = { PENDING: '#3a4057', ACTIVE: '#4bb7e5', DONE: '#2ecc71', BLOCKED: '#8b93a7', WAITING_APPROVAL: '#ffd34d', ERROR: '#ff6b6b' };
const ICONE = { PENDING: '○', ACTIVE: '◉', DONE: '✓', BLOCKED: '⏸', WAITING_APPROVAL: '!', ERROR: '✗' };
const ROT_CTX = { TRABALHANDO: 'trabalhando', PRECISA_DE_VOCE: 'precisa de você', PAUSADO_LIMITE: 'pausado (limite)', ERRO: 'erro', CONCLUIDO: 'concluído', PARADO: 'parado' };
const ROT_ST = { PENDING: 'pendente', ACTIVE: 'em andamento', DONE: 'concluída', BLOCKED: 'parada ou outro ramo', WAITING_APPROVAL: 'esperando você', ERROR: 'erro' };
const ROT_EX = { skill: '🤖 skill', eng: '👤 você', automatico: '⚙ automático' }; // eng = etapa feita pela pessoa
const COL = 220, LIN = 96, NW = 184, NH = 74, MX = 18, MY = 26;

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

/** Próximas etapas: sucessores diretos do que está em andamento/esperando; sem nada ativo, as raízes pendentes. */
function aSeguir(nodes, edges) {
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
      <div><h2 class="fx-titulo">Organizador de fluxos</h2><small class="fx-sub">em que etapa cada agente está e o que vem a seguir · clique numa etapa para ver o detalhe</small></div>
      <div class="fx-filtros"></div>
    </div>
    <div class="fx-faixas"></div>
    <div class="fx-dt-fundo" hidden></div>
    <aside class="fx-detalhe" hidden role="dialog" aria-label="Detalhe da etapa"></aside>`;
  const filtros = raiz.querySelector('.fx-filtros');
  const faixas = raiz.querySelector('.fx-faixas');
  const gaveta = raiz.querySelector('.fx-detalhe');
  const fundo = raiz.querySelector('.fx-dt-fundo');
  let dados = null, filtro = 'todos', assinatura = '';
  let sel = null, htmlDt = ''; // etapa aberta no painel de detalhe: { fluxoId, passoId, ctxId }

  const lista = (titulo, itens, cls = '') => (itens && itens.length
    ? `<section class="fx-dt-sec ${cls}"><h4>${titulo}</h4>${cls === 'num' ? '<ol>' : '<ul>'}${itens.map((i) => `<li>${esc(i)}</li>`).join('')}${cls === 'num' ? '</ol>' : '</ul>'}</section>` : '');

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
    const estado = no ? `<div class="fx-dt-estado" style="--c:${COR[no.status]}"><b>${ICONE[no.status]} ${esc(ROT_ST[no.status] || no.status)}</b> em ${esc(rotuloContexto(ctx))}${no.resumo ? ` · ${esc(no.resumo)}` : ''}${quemAqui.length ? `<br><small>agora: ${quemAqui.map((a) => esc(a.skill || a.role)).join(', ')}</small>` : ''}</div>` : '';
    return `
      <header class="fx-dt-topo">
        <div><small>${esc(fl.nome)}${passo.quando ? ` · ramo ${esc(passo.quando)}` : ''}</small><h3>${esc(passo.nome || passo.id)}</h3></div>
        <button type="button" class="btn mini" data-fechar-dt aria-label="Fechar">✕</button>
      </header>
      <div class="fx-dt-corpo">
        <div class="fx-dt-meta"><span class="fx-dt-ex ex-${ex}">${ROT_EX[ex] || ex}</span><code>${esc(passo.skill || 'sem skill')}</code></div>
        ${estado}
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
    const nodes = c.atlas.nodes.length ? c.atlas.nodes : [];
    const { pos, largura, altura } = layout(nodes, c.atlas.edges);
    const prox = aSeguir(nodes, c.atlas.edges);
    // "agora": a etapa em andamento ou esperando você; sem nenhuma, a última que o agente tocou
    const agoraId = (nodes.find((n) => ['WAITING_APPROVAL', 'ACTIVE', 'ERROR', 'BLOCKED'].includes(n.status)) || {}).id || c.passoAtual;
    const ativosPorPasso = new Map();
    for (const a of c.agents) if (a.status === 'WORKING' || a.status === 'WAITING_APPROVAL') {
      const p = a.passo || c.passoAtual; if (!p) continue;
      if (!ativosPorPasso.has(p)) ativosPorPasso.set(p, []);
      ativosPorPasso.get(p).push(a);
    }
    const arestas = c.atlas.edges.map((e) => {
      const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) return '';
      const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x - 8, y2 = b.y + NH / 2, mx = (x1 + x2) / 2;
      const de = nodes.find((n) => n.id === e.from), para = nodes.find((n) => n.id === e.to);
      const feito = de && de.status === 'DONE' && para && para.status !== 'PENDING';
      const vivo = de && ['ACTIVE', 'WAITING_APPROVAL'].includes(de.status) && prox.has(e.to);
      const ramo = para && para.quando ? `<text x="${x1 + 10}" y="${y2 - 8}" class="fx-ramo">${esc(para.quando)}</text>` : '';
      return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" class="fx-aresta${feito ? ' feita' : ''}${vivo ? ' viva' : ''}${para && para.quando ? ' condicional' : ''}" marker-end="url(#fx-seta-${feito ? 'ok' : 'n'})"/>${ramo}`;
    }).join('');
    const nos = nodes.map((n) => {
      const p = pos.get(n.id); if (!p) return '';
      const st = n.status;
      const quem = ativosPorPasso.get(n.id) || [];
      const liderAqui = agoraId === n.id && !['CONCLUIDO', 'PARADO'].includes(c.status);
      const avs = [
        ...(liderAqui ? [`<img src="${avatar(specPorEstilo(estiloL, c.repo))}" title="${esc(nomeDaLider(tema, c.repo))} (líder)" class="fx-av lider">`] : []),
        ...quem.slice(0, 4).map((a) => `<img src="${avatar(specPorEstilo(estiloW, a.skill, ((tema.herois || {})[a.skill] || {}).cores || {}))}" title="${esc(nomeDoWorker(tema, a.skill))} · ${esc(a.role)}" class="fx-av">`),
      ].join('');
      const at = quem.length && c.atividade && c.atividade.workers && c.atividade.workers[quem[0].id];
      const anim = at ? animPorAtividade(at.tipo) : null;
      const linhaAt = anim ? `${anim.icone} ${esc(at.tipo)}${at.alvo ? ` · ${esc(at.alvo)}` : ''}` : esc(n.resumo || n.papel || '');
      const ex = n.executor || 'skill';
      const vezSua = ex === 'eng' && ['ACTIVE', 'WAITING_APPROVAL'].includes(st);
      const marca = vezSua ? '<span class="fx-tag sua">sua vez</span>' : prox.has(n.id) ? '<span class="fx-tag">a seguir</span>' : '';
      return `<div class="fx-no st-${st} ex-${ex}${prox.has(n.id) ? ' prox' : ''}" style="left:${p.x}px;top:${p.y}px;--c:${COR[st]}" data-ctx="${esc(c.id)}" data-fluxo="${esc(c.fluxoId)}" data-passo="${esc(n.id)}" title="${esc([n.papel, n.resumo, 'clique para ver o detalhe'].filter(Boolean).join(' · '))}">
        <div class="fx-no-topo"><span class="fx-ico">${ICONE[st]}</span><b>${esc(n.label || n.id)}</b>${marca}</div>
        <code>${ex === 'automatico' ? '⚙ automático' : ex === 'eng' ? `👤 você${n.skill ? ` · ${esc(n.skill)}` : ''}` : esc(n.skill || 'skill a confirmar')}</code>
        <div class="fx-linha">${avs}<span>${linhaAt}</span></div>
      </div>`;
    }).join('');
    const atual = nodes.find((n) => n.id === agoraId);
    const proxNomes = [...prox].map((id) => (nodes.find((n) => n.id === id) || {}).label || id);
    const pergunta = c.pergunta ? `<div class="fx-pergunta">❓ ${esc(c.pergunta.texto)} <button class="btn primario mini" data-abrir="${esc(c.id)}" type="button">Responder</button></div>` : '';
    return `<section class="fx-faixa st-ctx-${c.status}">
      <header class="fx-cab">
        <img src="${avatar(specPorEstilo(estiloL, c.repo))}" class="fx-av grande" alt="">
        <div class="fx-cab-txt"><div><b>${esc(c.repo)}</b>${servicoDe(c) ? ` <span class="ctx-servico">${esc(servicoDe(c))}</span>` : ''} <span class="chip st-${c.status}">${ROT_CTX[c.status] || c.status}</span></div>
          <small>${esc(nomeDaLider(tema, c.repo))} · ${esc(c.fluxoNome)}${atual ? ` · agora: <b>${esc(atual.label)}</b>${atual.status === 'WAITING_APPROVAL' ? ' (esperando você)' : ''}` : ''}${proxNomes.length ? ` · a seguir: ${esc(proxNomes.join(', '))}` : ''}</small></div>
        <button class="btn mini" data-abrir="${esc(c.id)}" type="button">abrir conversa</button>
      </header>
      ${pergunta}
      <div class="fx-grafo-rolagem"><div class="fx-grafo" style="width:${largura}px;height:${altura}px">
        <svg width="${largura}" height="${altura}"><defs>
          <marker id="fx-seta-ok" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#2ecc71"/></marker>
          <marker id="fx-seta-n" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#4a5172"/></marker>
        </defs>${arestas}</svg>${nos || '<p class="fx-vazio">sem etapas registradas ainda</p>'}
      </div></div>
    </section>`;
  }

  function faixaCatalogo(f) {
    const nodes = f.passos.map((p) => ({ id: p.id, label: p.nome || p.id, skill: p.skill, status: 'PENDING', executor: p.executor || 'skill', quando: p.quando || null, papel: p.papel || null }));
    const edges = f.passos.flatMap((p) => (p.depende || []).map((d) => ({ from: d, to: p.id })));
    const falso = { id: `fluxo:${f.id}`, fluxoId: f.id, repo: f.missao || f.nome, fluxoNome: f.descricao || '', status: 'PARADO', atlas: { nodes, edges }, agents: [], passoAtual: null };
    return faixaContexto(falso)
      .replace(/<span class="chip st-PARADO">parado<\/span>/, `<span class="chip">${f.passos.length} etapa(s)</span>`)
      .replace(/<button class="btn mini" data-abrir="[^"]*" type="button">abrir conversa<\/button>/, `<button class="btn primario mini" data-convocar="${esc(f.id)}" type="button">Convocar missão</button>`)
      .replace(/<img src="[^"]*" class="fx-av grande" alt="">/, '<span class="fx-av-fluxo">⑂</span>');
  }

  function desenhar() {
    const st = dados.state;
    const visiveis = st.contextos.filter((c) => c.fluxoId !== 'chat' && (c.status !== 'PARADO' || c.baia != null));
    const ordem = { PRECISA_DE_VOCE: 0, ERRO: 1, TRABALHANDO: 2, PAUSADO_LIMITE: 3, CONCLUIDO: 4, PARADO: 5 };
    visiveis.sort((a, b) => (ordem[a.status] - ordem[b.status]) || b.atualizadoEm.localeCompare(a.atualizadoEm));
    filtros.innerHTML = [
      `<button type="button" class="chip-ramo${filtro === 'todos' ? ' sel' : ''}" data-f="todos" style="--c:#82aaff">Todos os projetos (${visiveis.length})</button>`,
      ...visiveis.map((c) => `<button type="button" class="chip-ramo${filtro === c.id ? ' sel' : ''}" data-f="${esc(c.id)}" style="--c:${COR[{ TRABALHANDO: 'ACTIVE', PRECISA_DE_VOCE: 'WAITING_APPROVAL', ERRO: 'ERROR', CONCLUIDO: 'DONE' }[c.status] || 'BLOCKED']}" title="${esc(rotuloContexto(c))}">${esc(rotuloContexto(c).length > 48 ? rotuloContexto(c).slice(0, 47) + '…' : rotuloContexto(c))}</button>`),
      `<button type="button" class="chip-ramo${filtro === 'catalogo' ? ' sel' : ''}" data-f="catalogo" style="--c:#8b93a7">Fluxos disponíveis (${dados.catalogo.fluxos.length})</button>`,
    ].join('');
    let html;
    if (filtro === 'catalogo') html = dados.catalogo.fluxos.map(faixaCatalogo).join('') || '<p class="fx-vazio">Nenhum fluxo em time/fluxos/.</p>';
    else {
      const lista = filtro === 'todos' ? visiveis : visiveis.filter((c) => c.id === filtro);
      html = lista.map(faixaContexto).join('') || '<p class="fx-vazio">Nenhum projeto rodando. Veja os <a href="#" data-f="catalogo">fluxos disponíveis</a> ou convoque uma missão.</p>';
    }
    const rolagem = faixas.scrollTop;
    faixas.innerHTML = html;
    faixas.scrollTop = rolagem;
  }

  raiz.addEventListener('click', (e) => {
    if (e.target === fundo || e.target.closest('[data-fechar-dt]')) { fecharDetalhe(); return; }
    const ir = e.target.closest('[data-ir]');
    if (ir && sel) { sel = { ...sel, passoId: ir.dataset.ir }; htmlDt = ''; desenharDetalhe(); return; }
    const f = e.target.closest('[data-f]');
    if (f) { e.preventDefault(); filtro = f.dataset.f; assinatura = ''; desenhar(); return; }
    const a = e.target.closest('[data-abrir]'); if (a) return onAbrirContexto && onAbrirContexto(a.dataset.abrir);
    const v = e.target.closest('[data-convocar]'); if (v) return onConvocar && onConvocar(v.dataset.convocar);
    const no = e.target.closest('.fx-no[data-passo]');
    if (no) { sel = { fluxoId: no.dataset.fluxo, passoId: no.dataset.passo, ctxId: no.dataset.ctx.startsWith('fluxo:') ? null : no.dataset.ctx }; htmlDt = ''; desenharDetalhe(); }
  });

  return {
    atualizar(d) {
      dados = d;
      if (filtro !== 'todos' && filtro !== 'catalogo' && !d.state.contextos.some((c) => c.id === filtro)) filtro = 'todos';
      const assin = JSON.stringify([filtro, d.catalogo.fluxos.map((f) => f.id), d.state.contextos.map((c) => [c.id, c.status, c.passoAtual, c.pergunta && c.pergunta.id, c.atlas, c.agents.map((a) => [a.id, a.status]), c.atividade])]);
      if (sel) desenharDetalhe();
      if (assin === assinatura) return;
      assinatura = assin;
      desenhar();
    },
    focar(ctxId) { filtro = ctxId || 'todos'; assinatura = ''; if (dados) desenhar(); },
    abrirPasso(ref, ctxId) {
      const [fluxoId, passoId] = String(ref).split(':');
      sel = { fluxoId, passoId, ctxId: ctxId && ctxId !== 'catalogo' && ctxId !== 'todos' ? ctxId : null }; htmlDt = '';
      desenharDetalhe();
    },
  };
}
