// motor.js — Canvas 2D: escala, laço de animação, desenho e clique.
import { criarMapa, T, MAX_ASSENTOS, ANDAR_H, andarDoTile, nomeDoAndar, definirNomesAndar } from './mapa.js';
import { pintarFundo, pintarFundoAndar, pintarBaia, telaDaMesa, pintarMesaTrono, pintarBalcao, quadro, corvo, drone, aviaoPapel, rostoMimir, PW, PH } from './sprites.js';
import { Cena, gruposDoContexto, servicoDe, rotuloContexto } from './cena.js';

const COR_STATUS = {
  TRABALHANDO: '#4bb7e5', PRECISA_DE_VOCE: '#ffd34d', PAUSADO: '#a78bfa', PAUSADO_LIMITE: '#a78bfa', ERRO: '#ff6b6b', CONCLUIDO: '#2ecc71', PARADO: '#8b93a7',
};

export function criarEscritorio(canvas, { onSelecionar, onHotspot, onDica, zoomInicial = 1 } = {}) {
  const g = canvas.getContext('2d');
  let mapa = null, tema = null, cena = null, fundo = null, mesaTrono = null, balcao = null;
  let assinatura = '';
  let escala = 2, offX = 0, offY = 0, dpr = 1, largura = 0, altura = 0;
  let escalaBase = 2, zoom = Math.max(1, Math.min(4, Number(zoomInicial) || 1)), panX = 0, panY = 0, arrasto = null, arrastou = false;
  let selecionado = null;
  let agenteSel = null; // ator clicado (destaque próprio, além da baia)
  let hover = null;
  let vista = { tipo: 'andar', k: 0 }; // um andar por vez, ou a visão geral (todos os andares em grade)
  let ultimoAndar = 0;
  let celulas = [];                    // visão geral: onde cada andar é desenhado na tela
  let hoverAndar = null;
  let assinaturaBarra = '';
  const barra = document.createElement('div');
  barra.className = 'andares-barra';
  canvas.parentElement.appendChild(barra);
  // painel de atenção: quem precisa de você, em que andar (some quando está tudo tranquilo)
  const painelAt = document.createElement('div');
  painelAt.className = 'andares-atencao';
  painelAt.hidden = true;
  canvas.parentElement.appendChild(painelAt);
  let assinaturaAtencao = '';
  const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROT_AT = { PRECISA_DE_VOCE: 'precisa de você', ERRO: 'erro', PAUSADO: 'pausado', PAUSADO_LIMITE: 'pausado (limite)' };
  let ultimo = performance.now();

  let assinaturaLayout = '';
  const capacidade = new Map(); // baia só cresce enquanto o contexto existir

  function pedidosDeBaias(state) {
    const ativos = state.contextos.filter((c) => c.baia != null).sort((a, b) => a.baia - b.baia);
    for (const id of [...capacidade.keys()]) if (!ativos.some((c) => c.id === id)) capacidade.delete(id);
    return ativos.map((c) => {
      const grupos = gruposDoContexto(c);
      const precisa = grupos.reduce((s, g) => s + g.length, 0);
      const cap = Math.min(MAX_ASSENTOS, Math.max(capacidade.get(c.id) || 3, precisa));
      capacidade.set(c.id, cap);
      return { chave: c.id, assentos: cap, grupos: grupos.map((g) => g.length) };
    });
  }

  function pintarCenario() {
    // térreo (o escritório de sempre) + andares de cima empilhados no mesmo canvas
    const terreo = pintarFundo({ ...mapa, H: mapa.HT }, tema);
    fundo = document.createElement('canvas');
    fundo.width = mapa.W * T; fundo.height = mapa.H * T;
    const fg = fundo.getContext('2d');
    fg.imageSmoothingEnabled = false;
    fg.drawImage(terreo, 0, 0);
    for (let k = 1; k < mapa.andares; k++) pintarFundoAndar(fg, mapa, k, tema, nomeDoAndar(k));
    for (const b of mapa.baias) pintarBaia(fg, mapa, b, tema);
    if (vista.tipo === 'andar' && vista.k >= mapa.andares) mudarVista({ tipo: 'andar', k: mapa.andares - 1 });
    if (mapa.salaChat) {
      // sala de chat: tapete próprio para ficar visualmente separada das baias das missões
      const s = mapa.salaChat;
      fg.fillStyle = 'rgba(130,120,255,.10)'; fg.fillRect(s.bx * T, s.by * T, s.largura * T, 4 * T);
      fg.fillStyle = 'rgba(167,139,250,.35)'; fg.fillRect(s.bx * T, (s.by + 4) * T - 1, s.largura * T, 1);
      pintarBaia(fg, mapa, s, tema);
    }
  }

  function montar(temaNovo, pedidos) {
    tema = temaNovo;
    definirNomesAndar(tema.andares);
    mapa = criarMapa(pedidos);
    pintarCenario();
    mesaTrono = pintarMesaTrono(tema);
    balcao = pintarBalcao(tema);
    cena = new Cena(mapa, tema);
    redimensionar();
  }

  function redimensionar() {
    if (!mapa) return;
    const r = canvas.parentElement.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    largura = Math.max(200, r.width); altura = Math.max(150, r.height);
    canvas.width = Math.round(largura * dpr); canvas.height = Math.round(altura * dpr);
    canvas.style.width = `${largura}px`; canvas.style.height = `${altura}px`;
    const rv = retanguloVista();
    escalaBase = Math.min(largura / rv.w, altura / rv.h);
    if (escalaBase >= 2) escalaBase = Math.floor(escalaBase * 2) / 2;
    aplicarCamera();
    planejarGeral();
  }

  /** Retângulo do mundo que o andar atual ocupa (um andar = ANDAR_H tiles de altura). */
  function retanguloVista() {
    const k = vista.tipo === 'andar' ? vista.k : 0;
    return { x: 0, y: k * ANDAR_H * T, w: mapa.W * T, h: ANDAR_H * T };
  }

  /** Visão geral: escolhe colunas × linhas que deixam os andares o maior possível na tela. */
  function planejarGeral() {
    if (!mapa) return;
    const n = mapa.andares, fw = mapa.W * T, fh = ANDAR_H * T, gap = 16, titulo = 26;
    let melhor = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const s = Math.min((largura - gap * (cols + 1)) / (cols * fw), (altura - gap * (rows + 1) - titulo * rows) / (rows * fh));
      if (!melhor || s > melhor.s) melhor = { cols, rows, s };
    }
    const { cols, rows, s } = melhor;
    const cw = fw * s, ch = fh * s;
    const totW = cols * cw + (cols - 1) * gap, totH = rows * (ch + titulo) + (rows - 1) * gap;
    const x0 = (largura - totW) / 2, y0 = (altura - totH) / 2;
    celulas = Array.from({ length: n }, (_, k) => {
      const c = k % cols, r = Math.floor(k / cols);
      return { k, s, x: Math.round(x0 + c * (cw + gap)), y: Math.round(y0 + r * (ch + titulo + gap) + titulo), w: cw, h: ch };
    });
  }

  function usarCelula(cel) { escala = cel.s; offX = cel.x; offY = cel.y - cel.k * ANDAR_H * T * cel.s; }

  function mudarVista(nova) {
    if (nova.tipo === 'andar') ultimoAndar = nova.k;
    vista = nova;
    zoom = 1; panX = 0; panY = 0;
    document.body.classList.toggle('escritorio-geral', vista.tipo === 'geral');
    assinaturaBarra = '';
    redimensionar();
    desenharBarra();
  }

  function infoAndares() {
    const n = mapa ? mapa.andares : 1;
    const out = Array.from({ length: n }, (_, k) => ({ k, nome: nomeDoAndar(k), agentes: 0, atencao: 0 }));
    if (!cena) return out;
    for (const a of cena.atores.values()) {
      if (!a.destino || a.destino.tipo !== 'assento' || a.sair) continue;
      const k = andarDoTile(a.destino.tile.y);
      if (out[k]) out[k].agentes++;
    }
    for (const c of cena.contextos) {
      if (c.status !== 'PRECISA_DE_VOCE' || c.fluxoId === 'chat') continue;
      const b = mapa.baiaDe(c.id);
      if (b && out[b.andar || 0]) out[b.andar || 0].atencao++;
    }
    return out;
  }

  function desenharBarra() {
    if (!mapa) return;
    const info = infoAndares();
    const assin = JSON.stringify([vista, info]);
    if (assin === assinaturaBarra) return;
    assinaturaBarra = assin;
    barra.innerHTML = `<button type="button" data-vista="geral" class="${vista.tipo === 'geral' ? 'sel' : ''}" title="Todos os andares de uma vez (Esc volta)">🗺 Visão geral</button>`
      + info.map((a) => `<button type="button" data-andar="${a.k}" class="${vista.tipo === 'andar' && vista.k === a.k ? 'sel' : ''}${a.atencao ? ' atencao' : ''}" title="${a.nome}: ${a.agentes} agente(s)${a.atencao ? ` · ${a.atencao} precisando de você` : ''}">${a.nome} <span class="n">${a.agentes}</span>${a.atencao ? '<span class="alerta">!</span>' : ''}</button>`).join('');
  }
  /** "Hrist pede · Análise de impacto": a líder que pergunta e a etapa a que a pergunta se refere. */
  function quemPede(c) {
    if (c.status !== 'PRECISA_DE_VOCE' || !c.pergunta) return ROT_AT[c.status];
    const p = c.pergunta;
    const alvo = p.chave && String(p.chave).startsWith('passo:') ? String(p.chave).slice(6) : p.passo || c.passoAtual;
    const no = alvo && c.atlas.nodes.find((n) => n.id === alvo);
    const sobre = p.chave === 'spec' ? 'spec' : p.chave === 'plano' ? 'plano' : no ? (no.label || no.id) : '';
    return `${cena.nomeLider(c)} pede${sobre ? ` · ${sobre}` : ''}`;
  }

  function desenharPainelAtencao() {
    if (!mapa || !cena) return;
    const itens = cena.contextos
      .filter((c) => c.fluxoId !== 'chat' && ROT_AT[c.status])
      .map((c) => { const b = mapa.baiaDe(c.id); return { c, andar: b ? (b.andar || 0) : null }; });
    const aqui = vista.tipo === 'andar' ? vista.k : null;
    const assin = JSON.stringify([aqui, itens.map((i) => [i.c.id, i.c.status, i.andar, i.c.pergunta && i.c.pergunta.id])]);
    if (assin === assinaturaAtencao) return;
    assinaturaAtencao = assin;
    painelAt.hidden = !itens.length;
    if (!itens.length) { painelAt.innerHTML = ''; return; }
    const grupos = new Map();
    for (const i of itens.sort((a, b) => (a.andar ?? 99) - (b.andar ?? 99))) {
      const k = i.andar == null ? 'sem' : i.andar;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(i);
    }
    const fora = itens.filter((i) => i.andar !== aqui).length;
    painelAt.innerHTML = `<div class="at-topo"><b>⚠ Atenção</b><span class="at-n">${itens.length}</span>${aqui != null && fora ? `<small>${fora} em outro andar</small>` : ''}</div>`
      + [...grupos.entries()].map(([k, lista]) => `<div class="at-andar${k === aqui ? ' aqui' : ''}">
          <div class="at-nome">${k === 'sem' ? 'sem baia (veja o Painel)' : escH(nomeDoAndar(k))}${k === aqui ? ' · aqui' : ''}</div>
          ${lista.map((i) => `<button type="button" class="at-item st-${i.c.status}" data-ctx="${escH(i.c.id)}" data-andar="${i.andar == null ? '' : i.andar}" title="${escH(i.c.pergunta ? i.c.pergunta.texto : (i.c.motivo || ''))}">
            <b>${escH(rotuloContexto(i.c))}</b><span>${escH(quemPede(i.c))}</span><em>${k === aqui ? 'abrir' : 'ir ↗'}</em></button>`).join('')}
        </div>`).join('');
  }
  painelAt.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ctx]');
    if (!b) return;
    if (b.dataset.andar !== '') {
      const k = Number(b.dataset.andar);
      if (vista.tipo !== 'andar' || vista.k !== k) mudarVista({ tipo: 'andar', k });
    }
    if (onSelecionar) onSelecionar(b.dataset.ctx);
  });

  barra.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.vista === 'geral') return mudarVista(vista.tipo === 'geral' ? { tipo: 'andar', k: ultimoAndar } : { tipo: 'geral' });
    mudarVista({ tipo: 'andar', k: Number(b.dataset.andar) });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || vista.tipo !== 'geral' || document.body.dataset.visao !== 'escritorio') return;
    if (document.querySelector('.dlg-fundo, .modal:not([hidden])')) return;
    mudarVista({ tipo: 'andar', k: ultimoAndar });
  });

  /** Zoom (roda do mouse) e arrasto: mantém o mapa dentro da tela. */
  function aplicarCamera() {
    const rv = retanguloVista();
    const mw = rv.w, mh = rv.h;
    escala = escalaBase * zoom;
    const limitar = (v, tamanhoMapa, tamanhoTela) => {
      if (tamanhoMapa <= tamanhoTela) return 0;
      const folga = (tamanhoMapa - tamanhoTela) / 2;
      return Math.max(-folga, Math.min(folga, v));
    };
    panX = limitar(panX, mw * escala, largura);
    panY = limitar(panY, mh * escala, altura);
    offX = Math.round((largura - mw * escala) / 2 + panX) - rv.x * escala;
    offY = Math.round((altura - mh * escala) / 2 + panY) - rv.y * escala;
  }

  canvas.addEventListener('wheel', (e) => {
    if (!mapa) return;
    if (vista.tipo === 'geral') { e.preventDefault(); return; }
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const antes = paraMundo(cx, cy);
    zoom = Math.max(1, Math.min(4, zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
    if (zoom < 1.02) { zoom = 1; panX = 0; panY = 0; aplicarCamera(); return; }
    aplicarCamera();
    const depois = paraTela(antes.x, antes.y);
    panX += cx - depois.x; panY += cy - depois.y;
    aplicarCamera();
  }, { passive: false });
  canvas.addEventListener('mousedown', (e) => { if (e.button === 0 && vista.tipo === 'andar') { arrasto = { x: e.clientX, y: e.clientY, px: panX, py: panY }; arrastou = false; } });
  window.addEventListener('mousemove', (e) => {
    if (!arrasto) return;
    const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) arrastou = true;
    if (arrastou && zoom > 1) { panX = arrasto.px + dx; panY = arrasto.py + dy; aplicarCamera(); }
  });
  window.addEventListener('mouseup', () => { arrasto = null; });
  canvas.addEventListener('dblclick', () => { if (vista.tipo !== 'andar') return; zoom = 1; panX = 0; panY = 0; aplicarCamera(); });

  const paraTela = (x, y) => ({ x: (x * escala + offX), y: (y * escala + offY) });
  const paraMundo = (cx, cy) => ({ x: (cx - offX) / escala, y: (cy - offY) / escala });

  /* --------------------------------------------------------------- telas */

  function pintarTela(r, tipo, t, semente) {
    const cores = { codigo: '#0f1a2b', pagina: '#e8ecf2', busca: '#1d2433', terminal: '#040904', grafo: '#14202e', pensando: '#1a2233', pergunta: '#3a2f05', erro: '#5a0f14', desligada: '#07080c' };
    g.fillStyle = cores[tipo] || '#0c0f17';
    g.fillRect(r.x, r.y, r.w, r.h);
    const linha = (y, w, cor) => { g.fillStyle = cor; g.fillRect(r.x + 1, r.y + y, Math.max(1, Math.min(r.w - 2, w)), 1); };
    const k = Math.floor(t / 160);
    if (tipo === 'codigo') {
      const pal = ['#7fdbca', '#c792ea', '#82aaff', '#ffcb6b', '#f78c6c'];
      for (let i = 0; i < 4; i++) linha(1 + i * 2, 3 + ((semente + k + i * 7) * 37) % 9, pal[(k + i + semente) % pal.length]);
    } else if (tipo === 'pagina' || tipo === 'busca') {
      const off = Math.floor(t / 600) % 2;
      for (let i = 0; i < 4; i++) linha(1 + i * 2 + off, 4 + ((semente + i) * 13) % 7, tipo === 'pagina' ? '#9aa4b5' : '#e3b341');
      if (tipo === 'busca') { g.fillStyle = '#ffffff'; g.fillRect(r.x + r.w - 4, r.y + 1, 2, 2); }
    } else if (tipo === 'terminal') {
      const n = 1 + (k % 4);
      for (let i = 0; i < n; i++) linha(1 + i * 2, 3 + ((semente + i) * 11) % 8, '#39d353');
      if (Math.floor(t / 400) % 2) { g.fillStyle = '#39d353'; g.fillRect(r.x + 2, r.y + 1 + n * 2, 2, 1); }
    } else if (tipo === 'grafo') {
      g.fillStyle = '#4bb7e5'; g.fillRect(r.x + 2, r.y + 3, 2, 2); g.fillRect(r.x + 8, r.y + 1, 2, 2); g.fillRect(r.x + 8, r.y + 5, 2, 2);
      g.fillStyle = Math.floor(t / 300) % 2 ? '#ffd34d' : '#82aaff'; g.fillRect(r.x + 4, r.y + 3, 4, 1);
    } else if (tipo === 'pensando') {
      const d = Math.floor(t / 350) % 4;
      g.fillStyle = '#8ea4c8';
      for (let i = 0; i < Math.min(d, 3); i++) g.fillRect(r.x + 3 + i * 3, r.y + 4, 1, 1);
    } else if (tipo === 'pergunta') {
      if (Math.floor(t / 450) % 2) { g.fillStyle = '#ffd34d'; g.fillRect(r.x + 5, r.y + 1, 3, 1); g.fillRect(r.x + 7, r.y + 2, 1, 2); g.fillRect(r.x + 6, r.y + 4, 1, 1); g.fillRect(r.x + 6, r.y + 6, 1, 1); }
    } else if (tipo === 'erro') {
      g.fillStyle = Math.floor(t / 250) % 2 ? '#ff6b6b' : '#b3262e';
      g.fillRect(r.x + 6, r.y + 1, 1, 4); g.fillRect(r.x + 6, r.y + 6, 1, 1);
    }
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(r.x, r.y, r.w, 1);
  }

  /* ------------------------------------------------------------- desenho */

  function desenharPersonagem(a) {
    const anim = a.estado && a.estado.anim;
    const spr = quadro(a.spec, a.pose === 'sentado' ? 'sentado' : a.pose, a.pose === 'sentado' ? 'cima' : a.dir, a.frame, anim || 'parado');
    g.globalAlpha = a.alpha == null ? 1 : a.alpha;
    // sombra
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.fillRect(Math.round(a.x - 5), Math.round(a.y - 1), 10, 2);
    g.drawImage(spr, Math.round(a.x - PW / 2), Math.round(a.y - PH + 1));
    g.globalAlpha = 1;
  }

  function desenharMundo(agora) {
    g.setTransform(dpr * escala, 0, 0, dpr * escala, dpr * offX, dpr * offY);
    g.imageSmoothingEnabled = false;
    g.drawImage(fundo, 0, 0);

    // destaque da baia selecionada
    const ctxSel = selecionado && cena.contextos.find((c) => c.id === selecionado);
    for (const c of cena.contextos) {
      const b = mapa.baiaDe(c.id);
      if (!b) continue;
      const cor = COR_STATUS[c.status] || '#4bb7e5';
      g.fillStyle = cor + (c === ctxSel ? '40' : '18');
      g.fillRect(b.bx * T + 4, b.by * T + T, b.largura * T - 8, 3 * T - 2);
      if (c.status === 'PRECISA_DE_VOCE') {
        const pulso = 0.35 + 0.35 * Math.sin(agora / 220);
        g.strokeStyle = `rgba(255,211,77,${pulso})`; g.lineWidth = 1;
        g.strokeRect(b.bx * T + 3.5, b.by * T + T - 0.5, b.largura * T - 7, 3 * T);
      }
    }

    // telas dos monitores
    const ocup = cena.ocupantes();
    for (const b of [...mapa.baias, ...(mapa.salaChat ? [mapa.salaChat] : [])]) {
      for (let s = 0; s < b.mesas.length; s++) {
        const m = b.mesas[s];
        const a = ocup.get(`${b.assentos[s].x},${b.assentos[s].y}`);
        pintarTela(telaDaMesa(mapa, m), a && a.estado ? a.estado.tela : null, agora + s * 97, (b.bx * 3 + s) * 17);
      }
    }

    // Mimir
    const fase = cena.mimirAte > agora ? agora / 120 : agora / 900;
    g.drawImage(rostoMimir(fase), mapa.poco.x * T + 17, mapa.poco.y * T + 10);

    // entidades em ordem de profundidade
    const lista = [];
    for (const a of cena.atores.values()) lista.push({ y: a.y, d: () => desenharPersonagem(a) });
    for (const n of Object.values(cena.npcs)) lista.push({ y: n.y, d: () => desenharPersonagem(n) });
    lista.push({ y: 5 * T + 2, d: () => g.drawImage(mesaTrono, 15 * T - 4, 4 * T - 2) });
    lista.push({ y: 11 * T, d: () => g.drawImage(balcao, mapa.balcao.x * T, mapa.balcao.y * T) });
    lista.sort((a, b) => a.y - b.y);
    for (const e of lista) e.d();

    // efeitos
    for (const ef of cena.efeitos) {
      const k = ef.t / ef.dur;
      if (ef.tipo === 'fumaca') { g.fillStyle = `rgba(160,160,170,${0.55 * (1 - k)})`; const s = 2 + Math.round(k * 3); g.fillRect(Math.round(ef.x), Math.round(ef.y - k * 14), s, s); }
      else if (ef.tipo === 'brilho') { g.fillStyle = ef.cor || '#ffe27a'; g.globalAlpha = 1 - k; g.fillRect(Math.round(ef.x), Math.round(ef.y - k * 6), 1, 3); g.fillRect(Math.round(ef.x) - 1, Math.round(ef.y - k * 6) + 1, 3, 1); g.globalAlpha = 1; }
      else if (ef.tipo === 'carimbo') { g.globalAlpha = 1 - k; g.fillStyle = '#2ecc71'; g.fillRect(Math.round(ef.x) - 3, Math.round(ef.y - k * 8), 7, 7); g.fillStyle = '#fff'; g.fillRect(Math.round(ef.x) - 1, Math.round(ef.y - k * 8) + 3, 1, 2); g.fillRect(Math.round(ef.x), Math.round(ef.y - k * 8) + 4, 1, 1); g.fillRect(Math.round(ef.x) + 1, Math.round(ef.y - k * 8) + 1, 1, 3); g.globalAlpha = 1; }
    }

    // corvos (ou aviões de papel)
    for (const c of cena.corvos) {
      const spr = cena.mensageiroSprite === 'corvo' ? corvo(c.frame) : cena.mensageiroSprite === 'drone' ? drone(c.frame) : aviaoPapel(c.frame);
      g.drawImage(spr, Math.round(c.x - 6), Math.round(c.y - 4));
    }
  }

  /* -------------------------------------------- sobreposições (tela) */

  function bolha(x, y, texto, { fundo = '#ffffff', cor = '#141018', borda = '#141018', fonte = 11, pulso = 0, negrito = true } = {}) {
    g.font = `${negrito ? '700' : '500'} ${fonte}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
    const w = Math.ceil(g.measureText(texto).width) + 10;
    const h = fonte + 8;
    const s = 1 + pulso;
    const bx = Math.round(x - (w * s) / 2), by = Math.round(y - h * s - 6);
    g.save();
    g.translate(bx, by); g.scale(s, s);
    g.fillStyle = fundo; g.strokeStyle = borda; g.lineWidth = 2;
    g.beginPath(); g.roundRect(0, 0, w, h, 5); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(w / 2 - 4, h); g.lineTo(w / 2, h + 5); g.lineTo(w / 2 + 4, h); g.closePath(); g.fill();
    g.fillStyle = cor; g.textBaseline = 'middle'; g.fillText(texto, 5, h / 2 + 1);
    g.restore();
  }

  function rotuloLugar(x, y, texto) {
    const p = paraTela(x, y);
    g.font = '600 10px ui-monospace, "Cascadia Mono", Consolas, monospace';
    g.fillStyle = (tema.paleta && tema.paleta.rotulo) || 'rgba(232,226,210,.5)'; // piso claro pede rótulo escuro (paleta.rotulo)
    g.textAlign = 'center'; g.fillText(texto, p.x, p.y); g.textAlign = 'left';
  }

  function desenharSobreposicoes(agora, compacto = false) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lug = tema.lugares || {};
    if (!compacto) {
    rotuloLugar(6 * T, 2 * T + 9, lug.missoes || 'Quadro de missões');
    rotuloLugar(28 * T, 2 * T + 9, lug.atlas || 'Fluxos');
    rotuloLugar(16.9 * T, 6 * T + 6, lug.trono || '');
    rotuloLugar(30 * T, 12 * T + 4, lug.verificador || '');
    rotuloLugar(3.5 * T, 17.8 * T, lug.biblioteca || '');
    rotuloLugar(2.1 * T, 9.75 * T, lug.estantes || 'Biblioteca');
    rotuloLugar(28 * T, 18.7 * T, lug.copa || '');
    rotuloLugar(17 * T, 18.6 * T, lug.porta || '');
    if (mapa.areaBloqueados) rotuloLugar((mapa.areaBloqueados.x + mapa.areaBloqueados.w / 2) * T, mapa.areaBloqueados.y * T - 3, lug.bloqueados || '⛔ Bloqueados');
    }

    // nome da baia escrito no chão, dentro dela (como os rótulos dos lugares); ao passar o mouse, a dica ao lado dele
    for (const c of cena.contextos) {
      const b = mapa.baiaDe(c.id);
      if (!b) continue;
      const centro = paraTela((b.bx + b.largura / 2) * T, (b.by + 3) * T + T / 2);
      const larg = Math.max(40, (paraTela((b.bx + b.largura) * T, 0).x - paraTela(b.bx * T, 0).x) - 16);
      const caber = (txt) => { if (g.measureText(txt).width <= larg) return txt; let t = txt; while (t.length > 1 && g.measureText(`${t}…`).width > larg) t = t.slice(0, -1); return `${t}…`; };
      const serv = servicoDe(c);
      const pal = tema.paleta || {}; // piso claro pede nome escuro: paleta.rotuloBaia, rotuloBaiaServico e rotuloBaiaSombra
      g.save();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = pal.rotuloBaiaSombra || 'rgba(10,8,6,.65)'; g.shadowOffsetX = 1; g.shadowOffsetY = 1;
      g.font = '700 12px ui-monospace, "Cascadia Mono", Consolas, monospace';
      if ('letterSpacing' in g) g.letterSpacing = '1px';
      g.fillStyle = pal.rotuloBaia || 'rgba(155,231,216,.92)';
      g.fillText(caber(c.repo), centro.x, centro.y - (serv ? 6 : 0));
      if (serv) {
        g.font = '600 10px ui-monospace, "Cascadia Mono", Consolas, monospace';
        if ('letterSpacing' in g) g.letterSpacing = '0px';
        g.fillStyle = pal.rotuloBaiaServico || pal.rotuloBaia || 'rgba(155,231,216,.68)';
        g.fillText(caber(serv), centro.x, centro.y + 8);
      }
      g.restore();
    }

    // placa da sala de chat
    if (mapa.salaChat) {
      const s = mapa.salaChat;
      const abertos = cena.contextos.filter((c) => c.fluxoId === 'chat' && !['PARADO', 'CONCLUIDO'].includes(c.status)).length;
      const p = paraTela((s.bx + s.largura / 2) * T, (s.by + 3) * T + 5);
      g.font = '700 11px ui-monospace, "Cascadia Mono", Consolas, monospace';
      const txt = `💬 Chats ${abertos}/${s.assentos.length}`;
      const w = g.measureText(txt).width + 14;
      g.fillStyle = 'rgba(30,22,52,.9)'; g.beginPath(); g.roundRect(p.x - w / 2, p.y - 9, w, 17, 4); g.fill();
      g.strokeStyle = 'rgba(167,139,250,.6)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#e4dcff'; g.textBaseline = 'middle'; g.fillText(txt, p.x - w / 2 + 7, p.y + 1); g.textBaseline = 'alphabetic';
    }

    // bolhas dos atores
    for (const a of cena.atores.values()) {
      if (!a.estado || a.rota.length || (a.alpha != null && a.alpha < 1)) continue;
      const topo = paraTela(a.x, a.y - (a.pose === 'sentado' ? 18 : 24));
      const b = a.estado.bolha;
      if (compacto && !(b && (b.tipo === 'atencao' || b.tipo === 'erro' || b.tipo === 'bloqueio'))) continue; // visão geral: só o que pede você (e os bloqueados)
      // Em cima do agente, só o que pede você (como na visão geral). O que ele está executando
      // aparece ao passar o mouse, na dica (descrever).
      if (b && b.tipo === 'atencao') bolha(topo.x, topo.y, '!', { fundo: '#ffd34d', fonte: 15, pulso: 0.12 * Math.max(0, Math.sin(agora / 180)) });
      else if (b && b.tipo === 'erro') bolha(topo.x, topo.y, '✖ erro', { fundo: '#ff6b6b', cor: '#fff' });
      else if (b && b.tipo === 'bloqueio') bolha(topo.x, topo.y, b.texto || '⛔', { fundo: '#c94848', cor: '#fff', borda: '#4a1418' });
      else if (b && b.tipo === 'terminal' && a.ctx && a.ctx.aguardandoTerminal) bolha(topo.x, topo.y, b.texto, { fundo: '#0b1210', cor: '#39d353', borda: '#39d353' });
      if (a.id === agenteSel && a.ctx && a.ctx.id === selecionado) {
        // destaque do agente clicado: anel nos pés e seta azul
        const pe = paraTela(a.x, a.y);
        const pulso = 0.55 + 0.45 * Math.sin(agora / 200);
        g.strokeStyle = `rgba(130,200,255,${pulso})`; g.lineWidth = 2;
        g.beginPath(); g.ellipse(pe.x, pe.y - 1, 9 * escala / 2, 3.5 * escala / 2, 0, 0, Math.PI * 2); g.stroke();
        const m = paraTela(a.x, a.y + 4);
        g.fillStyle = '#82c8ff'; g.beginPath(); g.moveTo(m.x - 6, m.y + 10); g.lineTo(m.x + 6, m.y + 10); g.lineTo(m.x, m.y + 2); g.fill();
      } else if (a.ctx && a.ctx.id === selecionado && a.tipo === 'lider') {
        const m = paraTela(a.x, a.y + 4);
        g.fillStyle = '#ffd34d'; g.beginPath(); g.moveTo(m.x - 5, m.y + 8); g.lineTo(m.x + 5, m.y + 8); g.lineTo(m.x, m.y + 2); g.fill();
      }
    }
    // zz
    for (const ef of cena.efeitos) {
      if (ef.tipo !== 'zz') continue;
      const k = ef.t / ef.dur; const p = paraTela(ef.x + k * 6, ef.y - k * 14);
      g.globalAlpha = 1 - k; g.fillStyle = '#c7b8ff'; g.font = `700 ${10 + Math.round(k * 5)}px ui-monospace, monospace`; g.fillText('z', p.x, p.y); g.globalAlpha = 1;
    }
    // NPCs
    const orq = cena.npcs.orquestrador;
    if (cena.pendencias > 0) {
      const p = paraTela(orq.x, orq.y - 26);
      bolha(p.x, p.y, `${cena.pendencias} esperando você`, { fundo: '#ffd34d', fonte: 11 });
    }
    if (compacto) return;
    const gd = cena.npcs.guarda;
    if (gd.bolha) { const p = paraTela(gd.x, gd.y - 26); bolha(p.x, p.y, `🛡 ${gd.bolha.texto.slice(0, 34)}`, { fundo: '#fff4d6', fonte: 10 }); }
    const vf = cena.npcs.verificador;
    if (vf.conferindoAte > agora) { const p = paraTela(vf.x, vf.y - 24); bolha(p.x, p.y, '⌕ conferindo', { fundo: '#eafbea', fonte: 10 }); }
  }

  let ultimaBarra = 0;
  function desenharGeral(agora) {
    const info = infoAndares();
    for (const cel of celulas) {
      usarCelula(cel);
      g.save();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.beginPath(); g.rect(cel.x, cel.y, cel.w, cel.h); g.clip();
      desenharMundo(agora);
      desenharSobreposicoes(agora, true);
      g.restore();
      const a = info[cel.k] || { nome: nomeDoAndar(cel.k), agentes: 0, atencao: 0 };
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.strokeStyle = hoverAndar === cel.k ? '#82aaff' : a.atencao ? 'rgba(255,211,77,.85)' : 'rgba(130,140,180,.35)';
      g.lineWidth = hoverAndar === cel.k || a.atencao ? 2 : 1;
      g.strokeRect(cel.x - 0.5, cel.y - 0.5, cel.w + 1, cel.h + 1);
      g.textBaseline = 'alphabetic';
      g.font = '700 13px system-ui, "Segoe UI", sans-serif'; g.fillStyle = '#e6e4ef';
      g.fillText(a.nome, cel.x + 2, cel.y - 9);
      const w1 = g.measureText(a.nome).width;
      g.font = '500 12px system-ui, "Segoe UI", sans-serif'; g.fillStyle = '#9aa0b8';
      const sub = ` · ${a.agentes} agente(s)`;
      g.fillText(sub, cel.x + 2 + w1, cel.y - 9);
      if (a.atencao) {
        const w2 = g.measureText(sub).width;
        const txt = `! ${a.atencao} esperando você`;
        g.font = '700 11px system-ui, sans-serif';
        const w3 = g.measureText(txt).width + 12;
        const bx = cel.x + 10 + w1 + w2;
        g.fillStyle = '#ffd34d'; g.beginPath(); g.roundRect(bx, cel.y - 22, w3, 17, 8); g.fill();
        g.fillStyle = '#141018'; g.fillText(txt, bx + 6, cel.y - 9);
      }
    }
  }

  function celulaEm(cx, cy) { return celulas.find((c) => cx >= c.x && cx <= c.x + c.w && cy >= c.y - 26 && cy <= c.y + c.h) || null; }

  function quadroAnim(agora) {
    const dt = Math.min(100, agora - ultimo);
    ultimo = agora;
    if (cena) {
      cena.atualizar(dt, agora);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#0b0d14'; g.fillRect(0, 0, canvas.width, canvas.height);
      if (vista.tipo === 'geral') desenharGeral(agora);
      else {
        // um andar por vez: recorta no andar, para não aparecer um pedaço do vizinho
        const k = vista.k, a = paraTela(0, k * ANDAR_H * T), b = paraTela(mapa.W * T, (k + 1) * ANDAR_H * T);
        g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.beginPath(); g.rect(a.x, a.y, b.x - a.x, b.y - a.y); g.clip();
        desenharMundo(agora);
        desenharSobreposicoes(agora); // rótulos e bolhas também ficam no andar
        g.restore();
      }
      if (agora - ultimaBarra > 400) { ultimaBarra = agora; desenharBarra(); desenharPainelAtencao(); }
    }
    requestAnimationFrame(quadroAnim);
  }
  requestAnimationFrame(quadroAnim);

  /* --------------------------------------------------------------- input */

  function acertar(cx, cy) {
    if (vista.tipo === 'geral') {
      const cel = celulaEm(cx, cy);
      if (!cel) return null;
      usarCelula(cel);
      if (cy < cel.y) return { andar: cel.k };
    }
    const m = paraMundo(cx, cy);
    const atores = [...cena.atores.values(), ...Object.values(cena.npcs)].sort((a, b) => b.y - a.y);
    for (const a of atores) {
      if (m.x >= a.x - 7 && m.x <= a.x + 7 && m.y >= a.y - 22 && m.y <= a.y) return { ator: a };
    }
    for (const h of mapa.hotspots) if (m.x >= h.x && m.x <= h.x + h.w && m.y >= h.y && m.y <= h.y + h.h) return { hotspot: h.id };
    return null;
  }

  function descrever(alvo) {
    if (!alvo) return null;
    if (alvo.andar != null) { const a = infoAndares()[alvo.andar]; return a ? `${a.nome} · ${a.agentes} agente(s) · clique para entrar` : null; }
    if (alvo.ator) {
      const a = alvo.ator;
      if (a.tipo === 'npc') return `${a.nome} · ${(tema.personagens && tema.personagens[a.papel] && tema.personagens[a.papel].papel) || a.papel}`;
      const c = a.ctx;
      const e = a.estado || {};
      const fazendo = e.bolha && e.bolha.tipo === 'terminal' ? e.bolha.texto : [e.icone, e.rotulo].filter(Boolean).join(' ');
      const at = fazendo ? ` · ${fazendo}` : '';
      return `${a.nome} · ${a.tipo === 'lider' ? 'líder' : a.papel}${c ? ` · ${rotuloContexto(c)} · ${c.status}` : ''}${at}`;
    }
    const lug = tema.lugares || {};
    const nomes = { missoes: `${lug.missoes || 'Quadro de missões'} · clique para convocar`, atlas: `${lug.atlas || 'Organizador de fluxos'} · clique para abrir`, orquestrador: lug.trono || 'Orquestrador', guarda: lug.porta || 'Porta', verificador: lug.verificador || 'Verificador', poco: `${lug.biblioteca || 'Aprendizado'} · mapa de aprendizado`, estantes: `${lug.estantes || 'Biblioteca de skills'} · ativar e desativar skills`, chats: 'Sala de chat', bloqueados: (() => { const n = cena.contextos.filter((x) => x.status === 'BLOQUEADO').length; return `${lug.bloqueados || '⛔ Bloqueados'} · ${n ? `${n} esperando algo de fora (decisão, acesso, credencial, outra área) · clique para ver` : 'nenhum fluxo bloqueado'}`; })() };
    if (alvo.hotspot.startsWith('ctx:')) {
      const c = cena.contextos.find((x) => x.id === alvo.hotspot.slice(4));
      return c ? `Baia · ${rotuloContexto(c)} · ${c.status} · ${gruposDoContexto(c).length - 1} grupo(s) de trabalho` : 'Baia';
    }
    return nomes[alvo.hotspot] || alvo.hotspot;
  }

  canvas.addEventListener('mousemove', (e) => {
    if (!cena) return;
    const r = canvas.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    let alvo = acertar(cx, cy);
    if (vista.tipo === 'geral') {
      const cel = celulaEm(cx, cy);
      hoverAndar = cel ? cel.k : null;
      if (cel && !(alvo && alvo.ator)) alvo = { andar: cel.k };
    }
    hover = alvo && alvo.ator ? alvo.ator : null;
    canvas.style.cursor = alvo ? 'pointer' : 'default';
    if (onDica) onDica(descrever(alvo), e.clientX, e.clientY);
  });
  canvas.addEventListener('mouseleave', () => { hover = null; hoverAndar = null; if (onDica) onDica(null); });
  canvas.addEventListener('click', (e) => {
    if (!cena || arrastou) return;
    const r = canvas.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    if (vista.tipo === 'geral') {
      // visão geral: clicar entra no andar (e, se for num herói, já abre a conversa dele)
      const cel = celulaEm(cx, cy);
      if (!cel) return;
      const alvoG = acertar(cx, cy);
      mudarVista({ tipo: 'andar', k: cel.k });
      if (alvoG && alvoG.ator && alvoG.ator.ctx && onSelecionar) {
        onSelecionar(alvoG.ator.ctx.id, alvoG.ator.tipo === 'worker' && alvoG.ator.agent ? { agente: alvoG.ator.agent.id } : alvoG.ator.tipo === 'lider' ? { lider: true } : null);
        agenteSel = alvoG.ator.id;
      }
      return;
    }
    const alvo = acertar(cx, cy);
    if (!alvo) return;
    if (alvo.ator && alvo.ator.ctx) {
      // clicar num agente: seleciona a missão e destaca o agente; subagente abre o terminal isolado nele, a líder abre a conversa
      if (onSelecionar) onSelecionar(alvo.ator.ctx.id, alvo.ator.tipo === 'worker' && alvo.ator.agent ? { agente: alvo.ator.agent.id } : alvo.ator.tipo === 'lider' ? { lider: true } : null);
      agenteSel = alvo.ator.id;
      return;
    }
    if (alvo.ator && alvo.ator.tipo === 'npc') return onHotspot && onHotspot(alvo.ator.papel);
    if (alvo.hotspot && alvo.hotspot.startsWith('ctx:')) {
      // clicar na baia é o mesmo que clicar na líder dela: destaca a líder e abre a conversa
      const id = alvo.hotspot.slice(4);
      const lider = [...cena.atores.values()].find((a) => a.tipo === 'lider' && a.ctx && a.ctx.id === id);
      if (onSelecionar) onSelecionar(id, { lider: true });
      agenteSel = lider ? lider.id : null;
      return;
    }
    if (alvo.hotspot && onHotspot) onHotspot(alvo.hotspot);
  });
  new ResizeObserver(() => redimensionar()).observe(canvas.parentElement);

  return {
    atualizar({ state, tema: temaNovo }) {
      const assin = JSON.stringify(temaNovo);
      const primeira = assin !== assinatura;
      const pedidos = pedidosDeBaias(state);
      const layout = JSON.stringify(pedidos);
      if (primeira) { assinatura = assin; assinaturaLayout = layout; montar(temaNovo, pedidos); }
      else if (layout !== assinaturaLayout) {
        // baia cresceu, grupo novo ou contexto entrou/saiu: redesenha o cenário e os heróis se reacomodam
        assinaturaLayout = layout;
        mapa = criarMapa(pedidos);
        pintarCenario();
        cena.trocarMapa(mapa);
        redimensionar();
      }
      cena.sincronizar(state);
      if (primeira && zoom > 1) {
        // com zoom inicial, centraliza na baia do contexto em foco (ou na primeira ocupada)
        const foco = state.contextos.find((c) => c.id === (selecionado || state.foco) && c.baia != null) || state.contextos.find((c) => c.baia != null);
        const b = foco && mapa.baiaDe(foco.id);
        if (b) {
          if ((b.andar || 0) !== (vista.k || 0)) { vista = { tipo: 'andar', k: b.andar || 0 }; ultimoAndar = vista.k; redimensionar(); }
          const rv = retanguloVista();
          const wx = (b.bx + b.largura / 2) * T, wy = (b.by + 2) * T - rv.y;
          panX = largura / 2 - wx * escala - (largura - rv.w * escala) / 2;
          panY = altura / 2 - wy * escala - (altura - rv.h * escala) / 2;
          aplicarCamera();
        }
      }
    },
    selecionar(id) {
      // só quando a seleção muda: leva ao andar da baia (o painel chama isto a cada 2 s)
      if (id !== selecionado) agenteSel = null; // outra missão: o destaque do agente sai
      if (id && id !== selecionado && mapa && vista.tipo === 'andar') {
        const b = mapa.baiaDe(id);
        if (b && (b.andar || 0) !== vista.k) mudarVista({ tipo: 'andar', k: b.andar || 0 });
      }
      selecionado = id;
    },
    irParaAndar(k) { mudarVista({ tipo: 'andar', k }); },
    visaoGeral() { mudarVista({ tipo: 'geral' }); },
  };
}
