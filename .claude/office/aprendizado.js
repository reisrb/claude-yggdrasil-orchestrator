// aprendizado.js — Mapa de aprendizado (abre pelo poço de Mimir): mindmap radial.
// Centro = o time; ramos = skills (cor = maturidade); folhas = lições (faça / evite / lacuna).
// Ramo extra: o diário de cada repositório. Dados em GET /aprendizado.
import { rostoMimir } from './escritorio/sprites.js';

const NS = 'http://www.w3.org/2000/svg';
const COR_MAT = { inexplorada: '#5b6178', aprendendo: '#4bb7e5', madura: '#2ecc71' };
const COR_LICAO = { faca: '#2ecc71', evite: '#ff9f5a', lacuna: '#ffd34d' };
const ROT_LICAO = { faca: 'faça', evite: 'evite', lacuna: 'lacuna da skill' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (tag, attrs = {}, pai) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (pai) pai.appendChild(e);
  return e;
};
const curto = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function criarAprendizado(raiz) {
  raiz.innerHTML = `
    <div class="atlas-barra">
      <div><h2 class="atlas-titulo">Mapa de aprendizado</h2><small class="atlas-sub">o que o orquestrador já aprendeu com cada skill e cada repositório</small></div>
      <div class="atlas-filtros ap-resumo"></div>
      <div class="atlas-acoes"><button class="btn" data-a="lacunas" type="button">Copiar lacunas</button> <button class="btn" data-a="centralizar" type="button">Centralizar</button></div>
    </div>
    <div class="atlas-area"><svg class="atlas-svg" aria-label="Mapa de aprendizado"></svg>
      <aside class="atlas-detalhe" hidden></aside>
      <div class="atlas-legenda">
        <span style="--c:${COR_MAT.inexplorada}">skill inexplorada</span><span style="--c:${COR_MAT.aprendendo}">aprendendo</span><span style="--c:${COR_MAT.madura}">madura</span>
        <span style="--c:${COR_LICAO.faca}">faça</span><span style="--c:${COR_LICAO.evite}">evite</span><span style="--c:${COR_LICAO.lacuna}">lacuna (levar ao time)</span>
      </div>
    </div>`;
  const svg = raiz.querySelector('.atlas-svg');
  const detalhe = raiz.querySelector('.atlas-detalhe');
  let dados = null, modelo = null, escolhido = null, cam = { x: 0, y: 0, s: 1 }, ajustado = false, assin = '', timer = null;

  function montar(d) {
    const nos = [{ id: 'raiz', tipo: 'raiz', x: 0, y: 0 }], arestas = [];
    const ramos = [...d.skills.map((s) => ({ tipo: 'skill', s })), ...d.repos.map((r) => ({ tipo: 'repo', r }))];
    const n = Math.max(ramos.length, 1);
    const R = Math.max(240, n * 34);
    ramos.forEach((ramo, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const hub = { id: ramo.tipo === 'skill' ? `s:${ramo.s.nome}` : `r:${ramo.r.repo}`, tipo: ramo.tipo, x: Math.cos(a) * R, y: Math.sin(a) * R, ang: a, dado: ramo.tipo === 'skill' ? ramo.s : ramo.r };
      hub.cor = ramo.tipo === 'skill' ? COR_MAT[ramo.s.maturidade] : '#c792ea';
      nos.push(hub);
      arestas.push({ de: nos[0], para: hub, cor: hub.cor, larg: ramo.tipo === 'skill' ? 7 : 5 });
      const folhas = ramo.tipo === 'skill' ? ramo.s.licoes.map((l) => ({ ...l })) : ramo.r.entradas.slice(-5).map((e) => ({ tipo: 'diario', texto: e.titulo, corpo: e.texto }));
      const m = folhas.length;
      const abertura = Math.min((2 * Math.PI) / n * 0.8, 0.22 * m);
      folhas.forEach((f, j) => {
        const aa = a + (m > 1 ? -abertura / 2 + (abertura * j) / (m - 1) : 0);
        const rr = R + 120 + (j % 2) * 40;
        const folha = { id: `${hub.id}:${j}`, tipo: 'folha', x: Math.cos(aa) * rr, y: Math.sin(aa) * rr, ang: aa, dado: f, pai: hub, cor: f.tipo === 'diario' ? '#c792ea' : COR_LICAO[f.tipo] };
        nos.push(folha);
        arestas.push({ de: hub, para: folha, cor: folha.cor, larg: 2 });
      });
    });
    return { nos, arestas };
  }

  function curva(a, b) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
    return `M${a.x},${a.y} Q${mx - dy * 0.15},${my + dx * 0.15} ${b.x},${b.y}`;
  }

  function desenhar() {
    svg.innerHTML = '';
    const defs = el('defs', {}, svg);
    const g = el('radialGradient', { id: 'ap-fundo', cx: '50%', cy: '50%', r: '65%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#10233a' }, g); el('stop', { offset: '100%', 'stop-color': '#080a12' }, g);
    const f = el('filter', { id: 'ap-brilho', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs); el('feGaussianBlur', { stdDeviation: '6' }, f);
    el('rect', { x: -6000, y: -6000, width: 12000, height: 12000, fill: 'url(#ap-fundo)' }, svg);
    const mundo = el('g', { class: 'atlas-mundo' }, svg);
    for (const r of [120, 240, 360, 480, 600]) el('circle', { cx: 0, cy: 0, r, fill: 'none', stroke: '#1d3550', 'stroke-dasharray': '2 8' }, mundo);
    for (const a of modelo.arestas) {
      const d = curva(a.de, a.para);
      el('path', { d, stroke: a.cor, 'stroke-width': a.larg * 2.2, fill: 'none', opacity: 0.15, filter: 'url(#ap-brilho)' }, mundo);
      el('path', { d, stroke: a.cor, 'stroke-width': a.larg, fill: 'none', opacity: 0.8, 'stroke-linecap': 'round' }, mundo);
    }
    for (const no of modelo.nos) {
      const gg = el('g', { class: `atlas-no${escolhido === no.id ? ' escolhido' : ''}`, transform: `translate(${no.x},${no.y})`, 'data-id': no.id }, mundo);
      if (no.tipo === 'raiz') {
        el('circle', { r: 62, fill: '#0c1a2c', stroke: '#6fb7ff', 'stroke-width': 3 }, gg);
        const c = rostoMimir(Date.now() / 600);
        el('image', { href: c.toDataURL(), x: -35, y: -30, width: 70, height: 50, class: 'pixel' }, gg);
        const t = el('text', { y: 92, 'text-anchor': 'middle', class: 'atlas-t1' }, gg); t.textContent = dados.nome || 'Aprendizado';
        const t2 = el('text', { y: 110, 'text-anchor': 'middle', class: 'atlas-t3' }, gg); t2.textContent = `${dados.skills.length} skill(s) · ${dados.totalLicoes} lição(ões) · ${dados.totalLacunas} lacuna(s)`;
        continue;
      }
      const fora = Math.cos(no.ang) >= 0;
      if (no.tipo === 'skill' || no.tipo === 'repo') {
        const nome = no.tipo === 'skill' ? no.dado.nome : `📓 ${no.dado.repo}`;
        const w = Math.max(110, nome.length * 7.6 + 26);
        el('rect', { x: -w / 2, y: -16, width: w, height: 32, rx: 16, fill: '#101a2a', stroke: no.cor, 'stroke-width': 2.5, 'stroke-dasharray': no.tipo === 'skill' && no.dado.maturidade === 'inexplorada' ? '5 4' : null }, gg);
        const t = el('text', { y: 5, 'text-anchor': 'middle', class: 'atlas-t2' }, gg); t.textContent = nome;
        if (no.tipo === 'skill') {
          const s = no.dado;
          const sub = el('text', { y: 32, 'text-anchor': 'middle', class: 'atlas-t3' }, gg);
          sub.textContent = `${s.execucoes} execução(ões) · ${s.sequencia} aprovação(ões) seguidas`;
        }
        continue;
      }
      const l = no.dado;
      const r = l.tipo === 'diario' ? 6 : 5 + Math.min(l.vezes || 1, 5);
      if (l.tipo === 'lacuna') el('path', { d: `M0,${-r - 2} L${r + 2},0 L0,${r + 2} L${-r - 2},0 Z`, fill: no.cor }, gg);
      else el('circle', { r, fill: no.cor, opacity: 0.9 }, gg);
      const t = el('text', { x: fora ? r + 8 : -r - 8, y: 4, 'text-anchor': fora ? 'start' : 'end', class: 'atlas-t3' }, gg);
      t.textContent = curto(l.texto, 34) + (l.vezes > 1 ? `  ×${l.vezes}` : '');
    }
    aplicarCamera();
  }

  function aplicarCamera() {
    const m = svg.querySelector('.atlas-mundo'); const r = svg.getBoundingClientRect();
    if (m) m.setAttribute('transform', `translate(${r.width / 2 + cam.x},${r.height / 2 + cam.y}) scale(${cam.s})`);
  }
  function enquadrar() {
    if (!modelo) return;
    const r = svg.getBoundingClientRect();
    const xs = modelo.nos.map((n) => n.x), ys = modelo.nos.map((n) => n.y);
    const w = Math.max(...xs) - Math.min(...xs) + 520, h = Math.max(...ys) - Math.min(...ys) + 260;
    cam.s = Math.max(0.4, Math.min(1.3, Math.min(r.width / w, r.height / h)));
    cam.x = -((Math.max(...xs) + Math.min(...xs)) / 2) * cam.s; cam.y = -((Math.max(...ys) + Math.min(...ys)) / 2) * cam.s;
    aplicarCamera();
  }
  let arrasto = null;
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const px = e.clientX - r.left - r.width / 2 - cam.x, py = e.clientY - r.top - r.height / 2 - cam.y;
    const s = Math.max(0.25, Math.min(3, cam.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    cam.x -= px * (s / cam.s - 1); cam.y -= py * (s / cam.s - 1); cam.s = s; aplicarCamera();
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

  svg.addEventListener('click', (e) => {
    if (arrasto && arrasto.moveu) return;
    const g = e.target.closest('[data-id]');
    escolhido = g ? g.getAttribute('data-id') : null;
    mostrar(); desenhar();
  });

  function listaLicoes(s, tipo) {
    const l = s.licoes.filter((x) => x.tipo === tipo);
    return l.length ? `<h4>${ROT_LICAO[tipo]}</h4><ul>${l.map((x) => `<li>${esc(x.texto)}${x.vezes > 1 ? ` <small>(×${x.vezes})</small>` : ''}</li>`).join('')}</ul>` : '';
  }
  function mostrar() {
    const no = modelo && modelo.nos.find((n) => n.id === escolhido);
    if (!no || no.tipo === 'raiz') { detalhe.hidden = true; return; }
    let h = '';
    if (no.tipo === 'skill') {
      const s = no.dado;
      h = `<h3><code>${esc(s.nome)}</code></h3><p><span class="chip" style="color:${COR_MAT[s.maturidade]}">${s.maturidade}</span>${s.doTime ? ' <span class="chip">skill do time</span>' : ''}</p>
        <p>${esc(s.descricao || '')}</p>
        <p class="suave">${s.execucoes} execução(ões) · ${s.respostas} checkpoint(s) respondido(s) · ${s.sequencia} aprovação(ões) seguidas sem ajuste${s.atualizado ? ` · lições de ${esc(s.atualizado)}` : ''}</p>
        ${s.licoes.length ? listaLicoes(s, 'faca') + listaLicoes(s, 'evite') + listaLicoes(s, 'lacuna') : '<p class="suave">Sem lições ainda. Elas aparecem depois que a skill roda e o /retro consolida.</p>'}`;
    } else if (no.tipo === 'repo') {
      h = `<h3>📓 ${esc(no.dado.repo)}</h3>${no.dado.entradas.slice().reverse().map((e) => `<h4>${esc(e.titulo)}</h4><p>${esc(e.texto)}</p>`).join('')}`;
    } else {
      const l = no.dado;
      h = `<h3>${l.tipo === 'diario' ? esc(l.texto) : esc(ROT_LICAO[l.tipo])}</h3><p>${l.tipo === 'diario' ? esc(l.corpo || '') : esc(l.texto)}</p>${l.vezes > 1 ? `<p class="suave">vista ${l.vezes} vezes</p>` : ''}<p class="suave">de <code>${esc(no.pai.tipo === 'skill' ? no.pai.dado.nome : no.pai.dado.repo)}</code></p>`;
    }
    detalhe.innerHTML = `<button class="btn icone fechar" type="button" data-fechar>✕</button>${h}`;
    detalhe.hidden = false;
  }
  detalhe.addEventListener('click', (e) => { if (e.target.closest('[data-fechar]')) { escolhido = null; detalhe.hidden = true; desenhar(); } });

  raiz.querySelector('[data-a="centralizar"]').addEventListener('click', enquadrar);
  raiz.querySelector('[data-a="lacunas"]').addEventListener('click', async (e) => {
    if (!dados) return;
    const md = dados.skills.filter((s) => s.licoes.some((l) => l.tipo === 'lacuna'))
      .map((s) => `## ${s.nome}\n${s.licoes.filter((l) => l.tipo === 'lacuna').map((l) => `- ${l.texto}`).join('\n')}`).join('\n\n');
    try { await navigator.clipboard.writeText(md || 'Nenhuma lacuna registrada.'); e.target.textContent = 'Copiado ✓'; } catch { e.target.textContent = 'Não consegui copiar'; }
    setTimeout(() => { e.target.textContent = 'Copiar lacunas'; }, 2000);
  });

  async function carregar() {
    try {
      const d = await (await fetch('/aprendizado', { cache: 'no-store' })).json();
      const a = JSON.stringify(d);
      if (a === assin) return;
      assin = a; dados = d; modelo = montar(d);
      raiz.querySelector('.ap-resumo').innerHTML = ['inexplorada', 'aprendendo', 'madura'].map((m) => `<span class="chip-ramo" style="--c:${COR_MAT[m]}">${d.skills.filter((s) => s.maturidade === m).length} ${m}${m === 'madura' ? 's' : m === 'inexplorada' ? 's' : ''}</span>`).join('');
      desenhar(); if (escolhido) mostrar();
      if (!ajustado) { ajustado = true; requestAnimationFrame(enquadrar); }
    } catch { /* tenta de novo no próximo ciclo */ }
  }

  return {
    mostrar() { carregar(); clearInterval(timer); timer = setInterval(carregar, 5000); requestAnimationFrame(enquadrar); },
    esconder() { clearInterval(timer); timer = null; },
    definirTitulo(t) { raiz.querySelector('.atlas-titulo').textContent = t; },
  };
}
