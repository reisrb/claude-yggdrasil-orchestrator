// mapa.js — layout do escritório em tiles (16px), colisão e caminhos (BFS).
export const T = 16;
export const LARGURA = 34;
export const ALTURA = 20;
export const AREA = { x0: 5, x1: 28, linhas: [7, 11] }; // área das baias no térreo (tiles)
export const MAX_ASSENTOS = 11;                          // 2·11+1 = 23 tiles = uma linha inteira
export const ANDAR_H = 20;                               // altura de cada andar (tiles); andares empilhados no mesmo mundo
export const LINHAS_ANDAR = [3, 7, 11, 15];              // fileiras de baias dos andares de cima (relativas ao andar)
export const MAX_ANDARES = 8;
export const andarDoTile = (y) => Math.floor(y / ANDAR_H);
const NOMES_ANDAR = ['Térreo', '1º andar', '2º andar', '3º andar', '4º andar', '5º andar', '6º andar', '7º andar'];
export const nomeDoAndar = (k) => NOMES_ANDAR[k] || `${k}º andar`;

/** Todas as fileiras de baias, na ordem de preenchimento: térreo, depois 1º andar, 2º… (cria andar quando enche). */
function fileiras() {
  const out = AREA.linhas.map((y) => ({ y, andar: 0 }));
  for (let k = 1; k < MAX_ANDARES; k++) for (const y of LINHAS_ANDAR) out.push({ y: k * ANDAR_H + y, andar: k });
  return out;
}

/**
 * Distribui as baias (uma por contexto) nas fileiras, da esquerda para a direita.
 * Quando as fileiras do térreo enchem, as próximas baias sobem para o 1º andar, e assim por diante.
 * pedidos: [{ chave, assentos, grupos: [tamanho do grupo, ...] }] — o 1º grupo é a líder.
 */
export function planejarBaias(pedidos) {
  const out = [];
  const linhas = fileiras();
  let lin = 0, x = AREA.x0;
  for (const p of pedidos) {
    let n = Math.max(3, Math.min(MAX_ASSENTOS, p.assentos | 0));
    if (x + 2 * n + 1 > AREA.x1) { lin++; x = AREA.x0; }
    if (lin >= linhas.length) break; // sem espaço: o contexto aparece só no painel
    n = Math.min(n, Math.floor((AREA.x1 - x - 1) / 2));
    const bx = x, by = linhas[lin].y, largura = 2 * n + 1;
    const divisorias = [];
    let acc = 0;
    for (const tam of (p.grupos || []).slice(0, -1)) { acc += tam; if (acc < n) divisorias.push(bx + 2 * acc); }
    out.push({
      chave: p.chave, bx, by, largura, divisorias, andar: linhas[lin].andar,
      assentos: Array.from({ length: n }, (_, s) => ({ x: bx + 1 + s * 2, y: by + 2 })),
      mesas: Array.from({ length: n }, (_, s) => ({ x: bx + 1 + s * 2, y: by + 1 })),
    });
    x += largura + 1;
  }
  return out;
}

export function criarMapa(pedidos) {
  // baias primeiro: elas dizem quantos andares o prédio precisa
  const baias = planejarBaias(pedidos || []);
  const andares = Math.max(1, ...baias.map((b) => b.andar + 1));
  const W = LARGURA, HT = ALTURA, H = andares * ANDAR_H;
  const bloq = Array.from({ length: H }, () => new Array(W).fill(false));
  const bloquear = (x, y, w = 1, h = 1) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (bloq[j] && i >= 0 && i < W) bloq[j][i] = true;
  };

  // paredes (térreo)
  bloquear(0, 0, W, 2);
  bloquear(0, 0, 1, H);
  bloquear(W - 1, 0, 1, H);
  bloquear(0, HT - 1, W, 1);
  const porta = { x: 16, y: HT - 1, w: 2 };
  bq(bloq, porta);

  // Hliðskjálf (trono + mesa do orquestrador)
  const trono = { x: 13, y: 2, w: 8, h: 3 };
  bloquear(trono.x, trono.y, trono.w, trono.h);
  const odin = { x: 16.5 * T, y: 3.9 * T };

  // andares de cima: paredes próprias e um elevador (quem trabalha lá chega e sai por ele)
  const elevadores = [null];
  for (let k = 1; k < andares; k++) {
    const y0 = k * ANDAR_H;
    bloquear(0, y0, W, 2);
    bloquear(0, y0 + ANDAR_H - 1, W, 1);
    elevadores.push({ x: 2, y: y0 + 2, w: 2, tiles: [{ x: 2, y: y0 + 2 }, { x: 3, y: y0 + 2 }] });
  }

  // baias (dinâmicas, uma por contexto)
  for (const b of baias) {
    bloquear(b.bx, b.by, b.largura, 1);              // divisória do fundo
    bloquear(b.bx, b.by, 1, 3);                      // lateral esquerda
    bloquear(b.bx + b.largura - 1, b.by, 1, 3);      // lateral direita
    bloquear(b.bx + 1, b.by + 1, b.largura - 2, 1);  // fileira de mesas
    for (const d of b.divisorias) bloquear(d, b.by, 1, 3); // separação entre grupos
  }

  // sala de chat: chats livres com o orquestrador, isolada das baias das missões (3 lugares = maxChats padrão)
  const salaChat = {
    chave: 'sala-chat', bx: 6, by: 15, largura: 7, divisorias: [],
    assentos: [{ x: 7, y: 17 }, { x: 9, y: 17 }, { x: 11, y: 17 }],
    mesas: [{ x: 7, y: 16 }, { x: 9, y: 16 }, { x: 11, y: 16 }],
  };
  bloquear(salaChat.bx, salaChat.by, salaChat.largura, 1);
  bloquear(salaChat.bx, salaChat.by, 1, 3);
  bloquear(salaChat.bx + salaChat.largura - 1, salaChat.by, 1, 3);
  bloquear(salaChat.bx + 1, salaChat.by + 1, salaChat.largura - 2, 1);

  // balcão do verificador
  const balcao = { x: 28, y: 10, w: 4 };
  bloquear(balcao.x, balcao.y, balcao.w, 1);
  bloquear(29, 8, 2, 2); // área atrás do balcão
  const forseti = { x: 30 * T, y: 10 * T - 1 };
  const entrega = [{ x: 29, y: 11 }, { x: 30, y: 11 }, { x: 28, y: 11 }];

  // biblioteca e poço
  bloquear(1, 3, 2, 4);   // estantes de cima
  bloquear(1, 10, 2, 3);  // estantes de baixo
  const poco = { x: 2, y: 15, w: 3, h: 2 };
  bloquear(poco.x, poco.y, poco.w, poco.h);

  // copa
  bloquear(25, 17, 4, 1);  // sofá
  bloquear(29, 15, 2, 2);  // mesa
  bloquear(32, 15, 1, 1);  // café
  bloquear(32, 17, 1, 1);  // planta
  const copa = [
    { x: 25, y: 16 }, { x: 27, y: 16 }, { x: 28, y: 16 }, { x: 26, y: 15 }, { x: 31, y: 16 },
    { x: 31, y: 17 }, { x: 24, y: 16 }, { x: 28, y: 15 }, { x: 24, y: 17 }, { x: 31, y: 15 },
  ];

  // plantas e enfeites
  const plantas = [{ x: 3, y: 2 }, { x: 10, y: 2 }, { x: 23, y: 2 }, { x: 31, y: 2 }, { x: 1, y: 8 }, { x: 22, y: 18 }];
  for (const p of plantas) bloquear(p.x, p.y);

  // guarda na porta
  const heimdall = { x: 14.5 * T, y: (HT - 1) * T - 1 };
  bloquear(14, HT - 2, 1, 1);

  const hotspots = [
    { id: 'missoes', x: 3 * T, y: 0, w: 6 * T, h: 2 * T },
    { id: 'atlas', x: 25 * T, y: 0, w: 6 * T, h: 2 * T },
    { id: 'orquestrador', x: trono.x * T, y: trono.y * T, w: trono.w * T, h: (trono.h + 1) * T },
    { id: 'guarda', x: 13.5 * T, y: (HT - 3) * T, w: 2 * T, h: 2 * T },
    { id: 'verificador', x: 28 * T, y: 8 * T, w: 4 * T, h: 3 * T },
    { id: 'poco', x: 1 * T, y: 14 * T, w: 5 * T, h: 4 * T },
    { id: 'estantes', x: 1 * T, y: 3 * T, w: 2 * T, h: 4 * T },
    { id: 'estantes', x: 1 * T, y: 10 * T, w: 2 * T, h: 3 * T },
    { id: 'chats', x: salaChat.bx * T, y: salaChat.by * T, w: salaChat.largura * T, h: 3 * T },
    ...baias.map((b) => ({ id: `ctx:${b.chave}`, x: b.bx * T, y: b.by * T, w: b.largura * T, h: 4 * T })),
  ];

  return {
    baiaDe: (chave) => baias.find((b) => b.chave === chave) || null,
    T, W, H, HT, andares, elevadores, bloq, baias, salaChat, trono, odin, balcao, forseti, entrega, poco, copa, plantas, heimdall, porta, hotspots,
    entrada: [{ x: 16, y: HT - 1 }, { x: 17, y: HT - 1 }],
    /** Onde se chega num andar: a porta no térreo, o elevador nos de cima. */
    chegadaDoAndar: (k) => (k > 0 && elevadores[k] ? elevadores[k].tiles : [{ x: 16, y: HT - 1 }, { x: 17, y: HT - 1 }]),
  };
}

function bq(bloq, porta) {
  for (let i = porta.x; i < porta.x + porta.w; i++) bloq[porta.y][i] = false;
}

/** BFS em 4 direções. Retorna a lista de tiles até o destino (sem o de partida), ou [] se não houver caminho. */
export function caminho(mapa, de, para) {
  const { W, H, bloq } = mapa;
  const livre = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (!bloq[y][x] || (x === para.x && y === para.y) || (x === de.x && y === de.y));
  if (de.x === para.x && de.y === para.y) return [];
  const chave = (x, y) => y * W + x;
  const veio = new Map([[chave(de.x, de.y), null]]);
  const fila = [de];
  while (fila.length) {
    const atual = fila.shift();
    if (atual.x === para.x && atual.y === para.y) break;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = atual.x + dx, ny = atual.y + dy;
      const k = chave(nx, ny);
      if (!veio.has(k) && livre(nx, ny)) { veio.set(k, atual); fila.push({ x: nx, y: ny }); }
    }
  }
  if (!veio.has(chave(para.x, para.y))) return [];
  const rota = [];
  let p = para;
  while (p && !(p.x === de.x && p.y === de.y)) { rota.unshift(p); p = veio.get(chave(p.x, p.y)); }
  return rota;
}
