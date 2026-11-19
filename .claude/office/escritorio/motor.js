// motor.js — Canvas 2D: escala, laço de animação, desenho e clique.
import { criarMapa, T, MAX_ASSENTOS } from './mapa.js';
import { pintarFundo, pintarBaia, telaDaMesa, pintarMesaTrono, pintarBalcao, quadro, corvo, aviaoPapel, rostoMimir, PW, PH } from './sprites.js';
import { Cena, gruposDoContexto } from './cena.js';

const COR_STATUS = {
  TRABALHANDO: '#4bb7e5', PRECISA_DE_VOCE: '#ffd34d', PAUSADO_LIMITE: '#a78bfa', ERRO: '#ff6b6b', CONCLUIDO: '#2ecc71', PARADO: '#8b93a7',
};

export function criarEscritorio(canvas, { onSelecionar, onHotspot, onDica, zoomInicial = 1 } = {}) {
  const g = canvas.getContext('2d');
  let mapa = null, tema = null, cena = null, fundo = null, mesaTrono = null, balcao = null;
  let assinatura = '';
  let escala = 2, offX = 0, offY = 0, dpr = 1, largura = 0, altura = 0;
  let escalaBase = 2, zoom = Math.max(1, Math.min(4, Number(zoomInicial) || 1)), panX = 0, panY = 0, arrasto = null, arrastou = false;
  let selecionado = null;
  let hover = null;
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
    fundo = pintarFundo(mapa, tema);
    const fg = fundo.getContext('2d');
    for (const b of mapa.baias) pintarBaia(fg, mapa, b, tema);
  }

  function montar(temaNovo, pedidos) {
    tema = temaNovo;
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
    const mw = mapa.W * T, mh = mapa.H * T;
    escalaBase = Math.min(largura / mw, altura / mh);
    if (escalaBase >= 2) escalaBase = Math.floor(escalaBase * 2) / 2;
    aplicarCamera();
  }

  /** Zoom (roda do mouse) e arrasto: mantém o mapa dentro da tela. */
  function aplicarCamera() {
    const mw = mapa.W * T, mh = mapa.H * T;
    escala = escalaBase * zoom;
    const limitar = (v, tamanhoMapa, tamanhoTela) => {
      if (tamanhoMapa <= tamanhoTela) return 0;
      const folga = (tamanhoMapa - tamanhoTela) / 2;
      return Math.max(-folga, Math.min(folga, v));
    };
    panX = limitar(panX, mw * escala, largura);
    panY = limitar(panY, mh * escala, altura);
    offX = Math.round((largura - mw * escala) / 2 + panX);
    offY = Math.round((altura - mh * escala) / 2 + panY);
  }

  canvas.addEventListener('wheel', (e) => {
    if (!mapa) return;
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
  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { arrasto = { x: e.clientX, y: e.clientY, px: panX, py: panY }; arrastou = false; } });
  window.addEventListener('mousemove', (e) => {
    if (!arrasto) return;
    const dx = e.clientX - arrasto.x, dy = e.clientY - arrasto.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) arrastou = true;
    if (arrastou && zoom > 1) { panX = arrasto.px + dx; panY = arrasto.py + dy; aplicarCamera(); }
  });
  window.addEventListener('mouseup', () => { arrasto = null; });
  canvas.addEventListener('dblclick', () => { zoom = 1; panX = 0; panY = 0; aplicarCamera(); });

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
    for (const b of mapa.baias) {
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
      const spr = cena.mensageiroSprite === 'corvo' ? corvo(c.frame) : aviaoPapel(c.frame);
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
    g.fillStyle = 'rgba(232,226,210,.5)'; g.textAlign = 'center'; g.fillText(texto, p.x, p.y); g.textAlign = 'left';
  }

  function desenharSobreposicoes(agora) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lug = tema.lugares || {};
    rotuloLugar(6 * T, 2 * T + 9, lug.missoes || 'Quadro de missões');
    rotuloLugar(28 * T, 2 * T + 9, lug.atlas || 'Mapa Atlas');
    rotuloLugar(16.9 * T, 6 * T + 6, lug.trono || '');
    rotuloLugar(30 * T, 12 * T + 4, lug.verificador || '');
    rotuloLugar(3.5 * T, 17.8 * T, lug.biblioteca || '');
    rotuloLugar(28 * T, 18.7 * T, lug.copa || '');
    rotuloLugar(17 * T, 18.6 * T, lug.porta || '');

    // placas das baias (na frente da baia, longe das bolhas sobre as cabeças)
    for (const c of cena.contextos) {
      const b = mapa.baiaDe(c.id);
      if (!b) continue;
      const p = paraTela((b.bx + b.largura / 2) * T, (b.by + 3) * T + 5);
      g.font = '700 11px ui-monospace, "Cascadia Mono", Consolas, monospace';
      const txt = c.repo.length > 22 ? c.repo.slice(0, 21) + '…' : c.repo;
      const w = g.measureText(txt).width + 22;
      g.fillStyle = 'rgba(12,14,22,.88)'; g.beginPath(); g.roundRect(p.x - w / 2, p.y - 9, w, 17, 4); g.fill();
      g.fillStyle = COR_STATUS[c.status] || '#4bb7e5'; g.beginPath(); g.arc(p.x - w / 2 + 8, p.y, 3.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8e6f0'; g.textBaseline = 'middle'; g.fillText(txt, p.x - w / 2 + 15, p.y + 1); g.textBaseline = 'alphabetic';
    }

    // bolhas dos atores
    for (const a of cena.atores.values()) {
      if (!a.estado || a.rota.length || (a.alpha != null && a.alpha < 1)) continue;
      const topo = paraTela(a.x, a.y - (a.pose === 'sentado' ? 18 : 24));
      const b = a.estado.bolha;
      if (b && b.tipo === 'atencao') bolha(topo.x, topo.y, '!', { fundo: '#ffd34d', fonte: 15, pulso: 0.12 * Math.max(0, Math.sin(agora / 180)) });
      else if (b && b.tipo === 'erro') bolha(topo.x, topo.y, '✖ erro', { fundo: '#ff6b6b', cor: '#fff' });
      else if (b && b.tipo === 'terminal') bolha(topo.x, topo.y, b.texto, { fundo: '#0b1210', cor: '#39d353', borda: '#39d353' });
      else if (b && b.tipo === 'zz') { /* zz é efeito */ } else if (a.estado.icone) {
        const sel = a.ctx && a.ctx.id === selecionado;
        const rot = a.estado.rotulo && (sel || hover === a) ? ` ${a.estado.rotulo.slice(0, 22)}` : '';
        bolha(topo.x, topo.y, `${a.estado.icone}${rot}`, { fundo: 'rgba(20,22,34,.92)', cor: '#d8dcff', borda: 'rgba(130,170,255,.55)', fonte: 10, negrito: false });
      }
      if (a.ctx && a.ctx.id === selecionado && a.tipo === 'lider') {
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
    const gd = cena.npcs.guarda;
    if (gd.bolha) { const p = paraTela(gd.x, gd.y - 26); bolha(p.x, p.y, `🛡 ${gd.bolha.texto.slice(0, 34)}`, { fundo: '#fff4d6', fonte: 10 }); }
    const vf = cena.npcs.verificador;
    if (vf.conferindoAte > agora) { const p = paraTela(vf.x, vf.y - 24); bolha(p.x, p.y, '⌕ conferindo', { fundo: '#eafbea', fonte: 10 }); }
  }

  function quadroAnim(agora) {
    const dt = Math.min(100, agora - ultimo);
    ultimo = agora;
    if (cena) {
      cena.atualizar(dt, agora);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#0b0d14'; g.fillRect(0, 0, canvas.width, canvas.height);
      desenharMundo(agora);
      desenharSobreposicoes(agora);
    }
    requestAnimationFrame(quadroAnim);
  }
  requestAnimationFrame(quadroAnim);

  /* --------------------------------------------------------------- input */

  function acertar(cx, cy) {
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
    if (alvo.ator) {
      const a = alvo.ator;
      if (a.tipo === 'npc') return `${a.nome} · ${(tema.personagens && tema.personagens[a.papel] && tema.personagens[a.papel].papel) || a.papel}`;
      const c = a.ctx;
      const at = a.estado && a.estado.rotulo ? ` · ${a.estado.rotulo}` : '';
      return `${a.nome} · ${a.tipo === 'lider' ? 'líder' : a.papel}${c ? ` · ${c.repo} · ${c.status}` : ''}${at}`;
    }
    const lug = tema.lugares || {};
    const nomes = { missoes: `${lug.missoes || 'Quadro de missões'} · clique para convocar`, atlas: `${lug.atlas || 'Mapa Atlas'} · clique para abrir`, orquestrador: lug.trono || 'Orquestrador', guarda: lug.porta || 'Porta', verificador: lug.verificador || 'Verificador', biblioteca: lug.biblioteca || 'Biblioteca' };
    if (alvo.hotspot.startsWith('ctx:')) {
      const c = cena.contextos.find((x) => x.id === alvo.hotspot.slice(4));
      return c ? `Baia · ${c.repo} · ${c.status} · ${gruposDoContexto(c).length - 1} grupo(s) de trabalho` : 'Baia';
    }
    return nomes[alvo.hotspot] || alvo.hotspot;
  }

  canvas.addEventListener('mousemove', (e) => {
    if (!cena) return;
    const r = canvas.getBoundingClientRect();
    const alvo = acertar(e.clientX - r.left, e.clientY - r.top);
    hover = alvo && alvo.ator ? alvo.ator : null;
    canvas.style.cursor = alvo ? 'pointer' : 'default';
    if (onDica) onDica(descrever(alvo), e.clientX, e.clientY);
  });
  canvas.addEventListener('mouseleave', () => { hover = null; if (onDica) onDica(null); });
  canvas.addEventListener('click', (e) => {
    if (!cena || arrastou) return;
    const r = canvas.getBoundingClientRect();
    const alvo = acertar(e.clientX - r.left, e.clientY - r.top);
    if (!alvo) return;
    if (alvo.ator && alvo.ator.ctx) return onSelecionar && onSelecionar(alvo.ator.ctx.id);
    if (alvo.ator && alvo.ator.tipo === 'npc') return onHotspot && onHotspot(alvo.ator.papel);
    if (alvo.hotspot && alvo.hotspot.startsWith('ctx:')) return onSelecionar && onSelecionar(alvo.hotspot.slice(4));
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
      }
      cena.sincronizar(state);
      if (primeira && zoom > 1) {
        // com zoom inicial, centraliza na baia do contexto em foco (ou na primeira ocupada)
        const foco = state.contextos.find((c) => c.id === (selecionado || state.foco) && c.baia != null) || state.contextos.find((c) => c.baia != null);
        const b = foco && mapa.baiaDe(foco.id);
        if (b) {
          const wx = (b.bx + b.largura / 2) * T, wy = (b.by + 2) * T;
          panX = largura / 2 - wx * escala - (largura - mapa.W * T * escala) / 2;
          panY = altura / 2 - wy * escala - (altura - mapa.H * T * escala) / 2;
          aplicarCamera();
        }
      }
    },
    selecionar(id) { selecionado = id; },
  };
}
