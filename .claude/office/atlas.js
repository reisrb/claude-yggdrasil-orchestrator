// atlas.js — Mapa Atlas: mindmap visto de cima. Centro = orquestrador; ramos = fluxos;
// ao longo de cada ramo, os passos (skills) com o status agregado dos contextos;
// valquírias penduradas no passo em que cada contexto está.
import { quadro, NPC, specValquiria, specPessoa, specHeroi } from './escritorio/sprites.js';

const NS = 'http://www.w3.org/2000/svg';
const CORES_RAMO = ['#4bb7e5', '#c792ea', '#2ecc71', '#f78c6c', '#ffcb6b', '#82aaff', '#ff6b9a', '#7fdbca'];
const COR_STATUS = { PENDING: '#4a5172', ACTIVE: '#4bb7e5', DONE: '#2ecc71', BLOCKED: '#8b93a7', WAITING_APPROVAL: '#ffd34d', ERROR: '#ff6b6b' };
const PESO = { WAITING_APPROVAL: 5, ERROR: 4, ACTIVE: 3, DONE: 2, BLOCKED: 1, PENDING: 0 };
const ROTULO = { PENDING: 'pendente', ACTIVE: 'em andamento', DONE: 'concluído', BLOCKED: 'bloqueado', WAITING_APPROVAL: 'esperando você', ERROR: 'erro' };

const el = (tag, attrs = {}, pai) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (pai) pai.appendChild(e);
  return e;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const urlSprite = new Map();
function dataUrl(spec, chave) {
  if (urlSprite.has(chave)) return urlSprite.get(chave);
  const c = document.createElement('canvas'); c.width = 16; c.height = 24;
  c.getContext('2d').drawImage(quadro(spec, 'pe', 'baixo', 0), 0, 0);
  const u = c.toDataURL();
  urlSprite.set(chave, u);
  return u;
}

export function criarAtlas(raiz, { onAbrirContexto, onConvocar } = {}) {
  raiz.innerHTML = `
    <div class="atlas-barra">
      <div><h2 class="atlas-titulo">Mapa Atlas</h2><small class="atlas-sub">fluxos, passos e onde cada contexto está agora</small></div>
      <div class="atlas-filtros"></div>
      <div class="atlas-acoes"><button class="btn" data-a="centralizar" type="button">Centralizar</button></div>
    </div>
    <div class="atlas-area"><svg class="atlas-svg" aria-label="Mapa Atlas"></svg>
      <aside class="atlas-detalhe" hidden></aside>
      <div class="atlas-legenda">${Object.entries(ROTULO).map(([k, v]) => `<span style="--c:${COR_STATUS[k]}">${v}</span>`).join('')}</div>
    </div>`;
  const svg = raiz.querySelector('.atlas-svg');
  const detalhe = raiz.querySelector('.atlas-detalhe');
  let dados = null, modelo = null, assinatura = '', foco = null, escolhido = null;
  let cam = { x: 0, y: 0, s: 1 }, ajustado = false;

  /* ------------------------------------------------------------ modelo */

  function montarModelo(d) {
    const { catalogo, state, tema, config } = d;
    const pers = tema.personagens || {};
    const fluxos = catalogo.fluxos;
    const emFluxo = new Set(fluxos.flatMap((f) => f.passos.map((p) => p.skill)));
    const ramos = fluxos.map((f, i) => ({ tipo: 'fluxo', id: `fluxo:${f.id}`, fluxo: f, nome: f.nome, cor: CORES_RAMO[i % CORES_RAMO.length] }));
    const doTimeFora = catalogo.skills.filter((s) => s.doTime && !emFluxo.has(s.nome));
    const ferramentas = catalogo.skills.filter((s) => !s.doTime && !emFluxo.has(s.nome));
    if (doTimeFora.length) ramos.push({ tipo: 'folhas', id: 'aux:time', nome: 'Skills do time fora de fluxo', skills: doTimeFora, cor: '#ffcb6b' });
    if (ferramentas.length) ramos.push({ tipo: 'folhas', id: 'aux:nucleo', nome: 'Ferramentas do orquestrador', skills: ferramentas, cor: '#8b93a7' });

    const nos = [], arestas = [], chips = [];
    const raizNo = { id: 'raiz', tipo: 'raiz', x: 0, y: 0, nome: (pers.orquestrador && pers.orquestrador.nome) || config.nome, sub: config.time || config.nome };
    nos.push(raizNo);
    const n = ramos.length;
    ramos.forEach((r, i) => {
      const th = n === 1 ? 0 : n === 2 ? (i ? Math.PI : 0) : -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const curva = (i % 2 ? -1 : 1) * 0.14;
      const R0 = 240;
      const hub = { id: r.id, tipo: r.tipo === 'fluxo' ? 'fluxo' : 'aux', x: Math.cos(th) * R0, y: Math.sin(th) * R0, nome: r.nome, cor: r.cor, ramo: r, angulo: th };
      nos.push(hub);
      arestas.push({ de: raizNo, para: hub, cor: r.cor, larg: 13 });
      if (r.tipo === 'fluxo') {
        const f = r.fluxo;
        const prof = new Map(f.passos.map((p) => [p.id, 0]));
        for (let k = 0; k < f.passos.length; k++) for (const p of f.passos) for (const dpd of p.depende || []) prof.set(p.id, Math.max(prof.get(p.id), (prof.get(dpd) || 0) + 1));
        const camadas = new Map();
        for (const p of f.passos) { const dd = prof.get(p.id); if (!camadas.has(dd)) camadas.set(dd, []); camadas.get(dd).push(p); }
        const porId = new Map();
        for (const [dd, lista] of camadas) {
          lista.forEach((p, j) => {
            const a = th + curva * (dd + 1);
            const rr = R0 + 175 * (dd + 1);
            const desl = (j - (lista.length - 1) / 2) * 78;
            const x = Math.cos(a) * rr - Math.sin(a) * desl;
            const y = Math.sin(a) * rr + Math.cos(a) * desl;
            const no = { id: `passo:${f.id}:${p.id}`, tipo: 'passo', x, y, passo: p, fluxo: f, cor: r.cor, angulo: a, ordem: f.passos.indexOf(p) + 1 };
            porId.set(p.id, no);
            nos.push(no);
          });
        }
        for (const p of f.passos) {
          const alvo = porId.get(p.id);
          const pais = (p.depende || []).map((x) => porId.get(x)).filter(Boolean);
          if (!pais.length) arestas.push({ de: hub, para: alvo, cor: r.cor, larg: 8 });
          for (const pai of pais) arestas.push({ de: pai, para: alvo, cor: r.cor, larg: Math.max(3, 7 - (prof.get(p.id) || 0)) });
        }
        // status agregado e contextos pendurados
        const ctxs = state.contextos.filter((c) => c.fluxoId === f.id && c.status !== 'PARADO');
        for (const no of nos.filter((x) => x.fluxo === f && x.tipo === 'passo')) {
          let st = 'PENDING';
          for (const c of ctxs) {
            const nn = c.atlas.nodes.find((x) => x.id === no.passo.id);
            const s = nn ? nn.status : 'PENDING';
            if (PESO[s] > PESO[st]) st = s;
          }
          no.status = st;
          no.contextos = ctxs.filter((c) => c.passoAtual === no.passo.id && c.status !== 'CONCLUIDO');
        }
        ctxs.filter((c) => c.status !== 'CONCLUIDO').forEach((c) => {
          const no = (c.passoAtual && porId.get(c.passoAtual)) || hub;
          const k = (no.chipsN = (no.chipsN || 0) + 1) - 1;
          chips.push({ ctx: c, no, k, cor: r.cor });
        });
        hub.contagem = ctxs.filter((c) => c.status !== 'CONCLUIDO').length;
      } else {
        const m = r.skills.length;
        r.skills.forEach((s, j) => {
          const a = th + (j - (m - 1) / 2) * Math.min(0.32, 1.6 / Math.max(m, 1));
          const rr = R0 + 140 + (j % 2) * 46;
          const no = { id: `skill:${s.nome}`, tipo: 'folha', x: Math.cos(a) * rr, y: Math.sin(a) * rr, skill: s, cor: r.cor, angulo: a };
          nos.push(no);
          arestas.push({ de: hub, para: no, cor: r.cor, larg: 3 });
        });
      }
    });
    return { nos, arestas, chips, ramos, tema, pers };
  }

  /* ----------------------------------------------------------- desenho */

  function curva(a, b) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const k = 0.18;
    return `M${a.x},${a.y} Q${mx - dy * k},${my + dx * k} ${b.x},${b.y}`;
  }

  function desenhar() {
    svg.innerHTML = '';
    const defs = el('defs', {}, svg);
    const grad = el('radialGradient', { id: 'atlas-fundo', cx: '50%', cy: '50%', r: '65%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#172036' }, grad);
    el('stop', { offset: '100%', 'stop-color': '#090b12' }, grad);
    const brilho = el('filter', { id: 'atlas-brilho', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
    el('feGaussianBlur', { stdDeviation: '6' }, brilho);
    el('rect', { x: '-5000', y: '-5000', width: '10000', height: '10000', fill: 'url(#atlas-fundo)' }, svg);
    const mundo = el('g', { class: 'atlas-mundo' }, svg);
    // anéis e raios: a "visão de cima"
    const chao = el('g', { class: 'atlas-chao' }, mundo);
    for (const r of [240, 415, 590, 765, 940]) el('circle', { cx: 0, cy: 0, r, fill: 'none', stroke: '#26304a', 'stroke-dasharray': '2 9', 'stroke-width': 1.2 }, chao);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      el('line', { x1: Math.cos(a) * 80, y1: Math.sin(a) * 80, x2: Math.cos(a) * 860, y2: Math.sin(a) * 860, stroke: '#1b2234', 'stroke-width': k % 6 ? 0.6 : 1.4 }, chao);
    }
    // ramos (brilho embaixo, traço por cima)
    const ramos = el('g', {}, mundo);
    for (const a of modelo.arestas) {
      const d = curva(a.de, a.para);
      el('path', { d, stroke: a.cor, 'stroke-width': a.larg * 2.2, fill: 'none', opacity: 0.16, filter: 'url(#atlas-brilho)', 'stroke-linecap': 'round' }, ramos);
      el('path', { d, stroke: a.cor, 'stroke-width': a.larg, fill: 'none', opacity: 0.85, 'stroke-linecap': 'round', class: 'atlas-ramo' }, ramos);
    }
    const gNos = el('g', {}, mundo);
    for (const no of modelo.nos) desenharNo(gNos, no);
    const gChips = el('g', {}, mundo);
    for (const ch of modelo.chips) desenharChip(gChips, ch);
    aplicarCamera();
  }

  function rotulo(g, x, y, linhas, ancora = 'middle') {
    linhas.forEach(([texto, classe], i) => {
      const t = el('text', { x, y: y + i * 15, 'text-anchor': ancora, class: classe }, g);
      t.textContent = texto;
    });
  }

  function desenharNo(pai, no) {
    const g = el('g', { class: `atlas-no tipo-${no.tipo}${escolhido === no.id ? ' escolhido' : ''}`, transform: `translate(${no.x},${no.y})`, 'data-id': no.id }, pai);
    if (no.tipo === 'raiz') {
      el('circle', { r: 64, fill: '#0f1424', stroke: '#d4a63c', 'stroke-width': 3 }, g);
      el('circle', { r: 56, fill: 'none', stroke: '#d4a63c', 'stroke-width': 1, 'stroke-dasharray': '3 4', opacity: 0.6 }, g);
      const spec = NPC[(modelo.pers.orquestrador && modelo.pers.orquestrador.sprite) || 'orquestradorNeutro'] || NPC.orquestradorNeutro;
      el('image', { href: dataUrl(spec, 'raiz'), x: -24, y: -44, width: 48, height: 72, class: 'pixel' }, g);
      rotulo(g, 0, 88, [[no.nome, 'atlas-t1'], [no.sub, 'atlas-t3']]);
      return;
    }
    if (no.tipo === 'fluxo' || no.tipo === 'aux') {
      const w = Math.max(120, no.nome.length * 7.4 + 34);
      el('rect', { x: -w / 2, y: -17, width: w, height: 34, rx: 17, fill: '#121827', stroke: no.cor, 'stroke-width': 2.5 }, g);
      const t = el('text', { x: 0, y: 5, 'text-anchor': 'middle', class: 'atlas-t1' }, g);
      t.textContent = no.nome;
      if (no.contagem) {
        el('circle', { cx: w / 2 - 2, cy: -15, r: 10, fill: no.cor }, g);
        const c = el('text', { x: w / 2 - 2, y: -11, 'text-anchor': 'middle', class: 'atlas-cont' }, g); c.textContent = no.contagem;
      }
      return;
    }
    if (no.tipo === 'passo') {
      const cor = COR_STATUS[no.status] || COR_STATUS.PENDING;
      if (no.status === 'ACTIVE' || no.status === 'WAITING_APPROVAL') el('circle', { r: 22, fill: 'none', stroke: cor, class: 'atlas-pulso' }, g);
      el('circle', { r: 21, fill: '#10162a', stroke: cor, 'stroke-width': 3.5 }, g);
      el('circle', { r: 15, fill: no.cor, opacity: 0.18 }, g);
      const n = el('text', { x: 0, y: 5, 'text-anchor': 'middle', class: 'atlas-num' }, g); n.textContent = no.status === 'WAITING_APPROVAL' ? '!' : no.ordem;
      const fora = Math.cos(no.angulo) >= 0;
      const lx = fora ? 30 : -30;
      rotulo(g, lx, -4, [[no.passo.nome || no.passo.id, 'atlas-t2'], [no.passo.skill || '', 'atlas-t3 mono'], [no.passo.papel || '', 'atlas-t3']], fora ? 'start' : 'end');
      return;
    }
    // folha (skill avulsa)
    el('circle', { r: 8, fill: '#10162a', stroke: no.cor, 'stroke-width': 2 }, g);
    const fora = Math.cos(no.angulo) >= 0;
    rotulo(g, fora ? 14 : -14, 4, [[no.skill.nome, 'atlas-t3 mono']], fora ? 'start' : 'end');
  }

  function desenharChip(pai, ch) {
    const c = ch.ctx;
    const estilo = (modelo.tema.lideres && modelo.tema.lideres.estilo) || 'pessoa';
    const spec = estilo === 'valquiria' ? specValquiria(c.repo) : estilo === 'heroi' ? specHeroi(c.repo) : specPessoa(c.repo);
    const ox = ch.no.tipo === 'passo' ? 0 : 0;
    const y0 = ch.no.tipo === 'passo' ? 30 + ch.k * 34 : 24 + ch.k * 34;
    const w = Math.max(120, c.repo.length * 7 + 46);
    const g = el('g', { class: `atlas-chip st-${c.status}`, transform: `translate(${ch.no.x + ox - w / 2},${ch.no.y + y0})`, 'data-ctx': c.id }, pai);
    el('line', { x1: w / 2, y1: -8, x2: w / 2, y2: 0, stroke: '#3a4166', 'stroke-width': 1.5 }, g);
    el('rect', { width: w, height: 28, rx: 8, fill: '#151a2b', stroke: COR_STATUS[{ TRABALHANDO: 'ACTIVE', PRECISA_DE_VOCE: 'WAITING_APPROVAL', ERRO: 'ERROR', PAUSADO_LIMITE: 'BLOCKED' }[c.status] || 'PENDING'], 'stroke-width': 1.5 }, g);
    el('image', { href: dataUrl(spec, `lider:${c.repo}`), x: 4, y: 1, width: 17, height: 26, class: 'pixel' }, g);
    const t = el('text', { x: 26, y: 18, class: 'atlas-chip-t' }, g); t.textContent = c.repo;
    if (c.status === 'PRECISA_DE_VOCE') {
      el('circle', { cx: w - 2, cy: 2, r: 8, fill: '#ffd34d' }, g);
      const e = el('text', { x: w - 2, y: 6, 'text-anchor': 'middle', class: 'atlas-excl' }, g); e.textContent = '!';
    }
  }

  /* ------------------------------------------------------------ câmera */

  function aplicarCamera() {
    const m = svg.querySelector('.atlas-mundo');
    const r = svg.getBoundingClientRect();
    if (m) m.setAttribute('transform', `translate(${r.width / 2 + cam.x},${r.height / 2 + cam.y}) scale(${cam.s})`);
  }
  function enquadrar() {
    if (!modelo) return;
    const r = svg.getBoundingClientRect();
    const xs = modelo.nos.map((n) => n.x), ys = modelo.nos.map((n) => n.y);
    const w = Math.max(...xs) - Math.min(...xs) + 380, h = Math.max(...ys) - Math.min(...ys) + 300;
    cam.s = Math.max(0.55, Math.min(1.4, Math.min(r.width / w, r.height / h)));
    cam.x = -((Math.max(...xs) + Math.min(...xs)) / 2) * cam.s;
    cam.y = -((Math.max(...ys) + Math.min(...ys)) / 2) * cam.s;
    aplicarCamera();
  }
  let arrasto = null;
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const px = e.clientX - r.left - r.width / 2 - cam.x, py = e.clientY - r.top - r.height / 2 - cam.y;
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const s = Math.max(0.25, Math.min(3, cam.s * f));
    cam.x -= px * (s / cam.s - 1); cam.y -= py * (s / cam.s - 1); cam.s = s;
    aplicarCamera();
  }, { passive: false });
  svg.addEventListener('mousedown', (e) => { arrasto = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moveu: false }; });
  window.addEventListener('mousemove', (e) => {
    if (!arrasto) return;
    const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) arrasto.moveu = true;
    cam.x = arrasto.cx + dx; cam.y = arrasto.cy + dy; aplicarCamera();
  });
  window.addEventListener('mouseup', () => { setTimeout(() => { arrasto = null; }, 0); });
  new ResizeObserver(() => aplicarCamera()).observe(svg);

  /* ----------------------------------------------------------- detalhe */

  svg.addEventListener('click', (e) => {
    if (arrasto && arrasto.moveu) return;
    const chip = e.target.closest('[data-ctx]');
    if (chip) return onAbrirContexto && onAbrirContexto(chip.getAttribute('data-ctx'));
    const g = e.target.closest('[data-id]');
    escolhido = g ? g.getAttribute('data-id') : null;
    mostrarDetalhe();
    desenhar();
  });

  function mostrarDetalhe() {
    const no = modelo && modelo.nos.find((n) => n.id === escolhido);
    if (!no) { detalhe.hidden = true; return; }
    const skills = dados.catalogo.skills;
    const descr = (nome) => (skills.find((s) => s.nome === nome) || {}).descricao || 'sem descrição';
    const caminho = (nome) => (skills.find((s) => s.nome === nome) || {}).caminho || '';
    let html = '';
    if (no.tipo === 'raiz') {
      const st = dados.state;
      html = `<h3>${esc(no.nome)}</h3><p>${esc(no.sub)}</p><p>${st.contextos.filter((c) => c.baia != null).length} contexto(s) ativo(s) · ${st.pendencias} esperando você · ${dados.catalogo.fluxos.length} fluxo(s) · ${skills.length} skill(s)</p>`;
    } else if (no.tipo === 'fluxo') {
      const f = no.ramo.fluxo;
      html = `<h3>${esc(f.nome)}</h3><p>${esc(f.descricao || '')}</p><ol>${f.passos.map((p) => `<li><b>${esc(p.nome || p.id)}</b> · <code>${esc(p.skill)}</code>${p.papel ? ` · ${esc(p.papel)}` : ''}</li>`).join('')}</ol>
        <button class="btn primario" type="button" data-convocar="${esc(f.id)}">Convocar missão neste fluxo</button>`;
    } else if (no.tipo === 'aux') {
      html = `<h3>${esc(no.nome)}</h3><ul>${no.ramo.skills.map((s) => `<li><code>${esc(s.nome)}</code> — ${esc(s.descricao.slice(0, 140))}</li>`).join('')}</ul>`;
    } else if (no.tipo === 'passo') {
      const p = no.passo;
      html = `<h3>${no.ordem}. ${esc(p.nome || p.id)}</h3><p><span class="chip" style="color:${COR_STATUS[no.status]}">${ROTULO[no.status]}</span></p>
        <p><code>${esc(p.skill)}</code>${p.papel ? ` · papel: ${esc(p.papel)}` : ''}</p><p>${esc(descr(p.skill))}</p><p class="mono suave">${esc(caminho(p.skill))}</p>
        ${no.contextos && no.contextos.length ? `<h4>Neste passo agora</h4>${no.contextos.map((c) => `<button class="btn" type="button" data-abrir="${esc(c.id)}">${esc(c.repo)} · ${esc(c.status)}</button>`).join(' ')}` : ''}`;
    } else {
      html = `<h3><code>${esc(no.skill.nome)}</code></h3><p>${esc(no.skill.descricao)}</p><p class="mono suave">${esc(no.skill.caminho)}</p>`;
    }
    detalhe.innerHTML = `<button class="btn icone fechar" type="button" data-fechar>✕</button>${html}`;
    detalhe.hidden = false;
  }
  detalhe.addEventListener('click', (e) => {
    if (e.target.closest('[data-fechar]')) { escolhido = null; detalhe.hidden = true; desenhar(); return; }
    const a = e.target.closest('[data-abrir]'); if (a) return onAbrirContexto && onAbrirContexto(a.dataset.abrir);
    const c = e.target.closest('[data-convocar]'); if (c) return onConvocar && onConvocar(c.dataset.convocar);
  });

  raiz.querySelector('[data-a="centralizar"]').addEventListener('click', enquadrar);
  raiz.querySelector('.atlas-filtros').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ramo]'); if (!b) return;
    const no = modelo.nos.find((n) => n.id === b.dataset.ramo); if (!no) return;
    escolhido = no.id; cam.s = 1; cam.x = -no.x; cam.y = -no.y;
    mostrarDetalhe(); desenhar();
  });

  return {
    atualizar(d) {
      dados = d;
      const lug = (d.tema.lugares && d.tema.lugares.atlas) || 'Mapa Atlas';
      raiz.querySelector('.atlas-titulo').textContent = lug;
      const assin = JSON.stringify([d.catalogo.fluxos, d.catalogo.skills.map((s) => s.nome), d.state.contextos.map((c) => [c.id, c.status, c.passoAtual, c.atlas.nodes.map((n) => n.status)]), d.tema.id]);
      if (assin === assinatura) return;
      assinatura = assin;
      modelo = montarModelo(d);
      raiz.querySelector('.atlas-filtros').innerHTML = modelo.ramos.map((r) => `<button class="chip-ramo" type="button" data-ramo="${esc(r.id)}" style="--c:${r.cor}">${esc(r.nome)}</button>`).join('');
      desenhar();
      if (escolhido) mostrarDetalhe();
      if (!ajustado) { ajustado = true; requestAnimationFrame(enquadrar); }
    },
    focar({ ctx } = {}) {
      if (!modelo || !ctx) return;
      const ch = modelo.chips.find((x) => x.ctx.id === ctx);
      if (!ch) return;
      escolhido = ch.no.id; cam.s = 1.2; cam.x = -ch.no.x * 1.2; cam.y = -ch.no.y * 1.2;
      mostrarDetalhe(); desenhar();
    },
    reenquadrar() { requestAnimationFrame(enquadrar); },
  };
}
