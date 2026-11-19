// sprites.js — pixel art feita em código. Personagens 16×24, props em tiles de 16.
// Tudo original: heróis gerados por semente (capa, máscara, emblema, cores) e elenco nórdico.

export const PW = 16;
export const PH = 24;
const CONTORNO = '#120e18';
const cache = new Map();

export function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const hsl = (h, s, l) => `hsl(${Math.round(h)} ${s}% ${l}%)`;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
const p = (g, cor, x, y, w = 1, h = 1) => { if (!cor) return; g.fillStyle = cor; g.fillRect(x, y, w, h); };

/* --------------------------------------------------------------- specs */

const PELES = ['#f6d1b0', '#eabd8c', '#d29a68', '#b0764a', '#8a5634', '#653d24'];
const CABELOS = ['#2b1d14', '#4a2f1b', '#7a4a22', '#c8963e', '#e9dcb8', '#1d1d24', '#9c3b22', '#5b5f6b'];
const EMBLEMAS = ['estrela', 'raio', 'circulo', 'losango', 'triangulo', 'asa'];

export function specHeroi(semente, extra = {}) {
  const h = hash(semente);
  const hue = h % 360;
  const capaHue = (hue + 150 + ((h >> 9) % 60)) % 360;
  return {
    chave: `heroi:${semente}`,
    estilo: 'heroi',
    pele: PELES[(h >> 3) % PELES.length],
    cabelo: CABELOS[(h >> 6) % CABELOS.length],
    traje: hsl(hue, 62, 46), trajeEsc: hsl(hue, 58, 31), trajeClaro: hsl(hue, 72, 62),
    capa: hsl(capaHue, 62, 40), capaEsc: hsl(capaHue, 60, 27),
    mascara: (h >> 12) % 10 < 6 ? hsl(hue, 45, 16) : null,
    emblema: EMBLEMAS[(h >> 15) % EMBLEMAS.length],
    emblemaCor: (h >> 18) % 2 ? '#ffd34d' : '#f4f4f4',
    botas: hsl(hue, 35, 20),
    luvas: (h >> 20) % 3 === 0 ? '#f0f0f0' : hsl(hue, 38, 24),
    cinto: (h >> 22) % 2 ? '#ffd34d' : '#2a2a35',
    ...extra,
  };
}

export function specValquiria(semente, extra = {}) {
  const h = hash(`v:${semente}`);
  const base = specHeroi(`v:${semente}`);
  return {
    ...base,
    chave: `valquiria:${semente}`,
    estilo: 'valquiria',
    cabelo: ['#e9dcb8', '#c8963e', '#9c3b22', '#2b1d14', '#d9c27a'][(h >> 4) % 5],
    traje: ['#8e9aaf', '#a5adbf', '#7f8aa3'][(h >> 7) % 3],
    trajeEsc: '#5d6678', trajeClaro: '#c9d1de',
    capa: hsl(h % 360, 55, 38), capaEsc: hsl(h % 360, 55, 25),
    mascara: null, elmo: '#cfd6e0', elmoEsc: '#8d96a6', asas: '#ffffff',
    emblema: 'asa', emblemaCor: '#ffd34d', cinto: '#ffd34d', botas: '#4a3b2a', luvas: '#6b5a44',
    ...extra,
  };
}

export function specPessoa(semente, extra = {}) {
  const h = hash(`p:${semente}`);
  const hue = h % 360;
  return {
    chave: `pessoa:${semente}`,
    estilo: 'pessoa',
    pele: PELES[(h >> 3) % PELES.length],
    cabelo: CABELOS[(h >> 6) % CABELOS.length],
    traje: hsl(hue, 45, 50), trajeEsc: '#2f3a52', trajeClaro: hsl(hue, 55, 66),
    capa: null, capaEsc: null, mascara: null, emblema: null,
    botas: '#2a2420', luvas: null, cinto: null, cabeloLongo: (h >> 9) % 2 === 0,
    ...extra,
  };
}

export const NPC = {
  odin: { chave: 'npc:odin', estilo: 'odin', pele: '#e0b48e', cabelo: '#d9d9de', traje: '#4b5874', trajeEsc: '#323b50', trajeClaro: '#6d7c9c', capa: '#26304a', capaEsc: '#192034', chapeu: '#3a3f4d', barba: '#e8e8ee', emblema: null, botas: '#2b2622', luvas: null, cinto: '#9b7a3b' },
  heimdall: { chave: 'npc:heimdall', estilo: 'heimdall', pele: '#c9925f', cabelo: '#e3c16a', traje: '#d4a63c', trajeEsc: '#9a7426', trajeClaro: '#f0cd6a', capa: '#e8e4dc', capaEsc: '#b9b2a6', elmo: '#e7c45a', elmoEsc: '#a7832c', emblema: 'circulo', emblemaCor: '#ffffff', botas: '#4a3520', luvas: '#7a5a30', cinto: '#5a4024' },
  forseti: { chave: 'npc:forseti', estilo: 'forseti', pele: '#e8c19a', cabelo: '#8a5a2b', traje: '#eae6dc', trajeEsc: '#bdb5a2', trajeClaro: '#ffffff', capa: '#c9a447', capaEsc: '#97782c', barba: '#8a5a2b', emblema: 'losango', emblemaCor: '#c9a447', botas: '#6b5136', luvas: null, cinto: '#c9a447' },
  orquestradorNeutro: { chave: 'npc:orq', estilo: 'pessoa', pele: '#d29a68', cabelo: '#2b1d14', traje: '#3f6fb5', trajeEsc: '#2f3a52', trajeClaro: '#6b93cf', capa: null, mascara: null, emblema: null, botas: '#222', fone: true },
  guardaNeutro: { chave: 'npc:guarda', estilo: 'pessoa', pele: '#8a5634', cabelo: '#1d1d24', traje: '#e3b52e', trajeEsc: '#2b2f3a', trajeClaro: '#f3d36a', capa: null, mascara: null, emblema: null, botas: '#222', bone: true },
  revisorNeutro: { chave: 'npc:revisor', estilo: 'pessoa', pele: '#f6d1b0', cabelo: '#7a4a22', traje: '#7d8b99', trajeEsc: '#3a4250', trajeClaro: '#a9b6c3', capa: null, mascara: null, emblema: null, botas: '#222', oculos: true },
};

/* ------------------------------------------------------------- partes */

function emblema(g, s, x, y) {
  const c = s.emblemaCor;
  switch (s.emblema) {
    case 'estrela': p(g, c, x + 1, y, 1, 3); p(g, c, x, y + 1, 3, 1); break;
    case 'raio': p(g, c, x + 1, y, 1, 1); p(g, c, x, y + 1, 2, 1); p(g, c, x + 1, y + 2, 1, 1); break;
    case 'circulo': p(g, c, x, y, 2, 2); p(g, c, x + 1, y + 1, 1, 1); break;
    case 'losango': p(g, c, x + 1, y, 1, 1); p(g, c, x, y + 1, 2, 1); p(g, c, x + 1, y + 2, 1, 1); break;
    case 'triangulo': p(g, c, x + 1, y, 1, 1); p(g, c, x, y + 1, 3, 1); break;
    case 'asa': p(g, c, x, y, 1, 1); p(g, c, x + 2, y, 1, 1); p(g, c, x, y + 1, 3, 1); break;
    default: break;
  }
}

function cabecaFrente(g, s, dy = 0, olhosFechados = false) {
  const y = 2 + dy;
  p(g, s.pele, 5, y + 2, 6, 6);            // rosto
  p(g, s.pele, 4, y + 4, 1, 2); p(g, s.pele, 11, y + 4, 1, 2); // orelhas
  if (s.estilo === 'odin') {
    p(g, s.cabelo, 4, y + 2, 1, 5); p(g, s.cabelo, 11, y + 2, 1, 5);
    p(g, s.barba, 5, y + 6, 6, 4); p(g, s.barba, 6, y + 10, 4, 2); // barba longa
    p(g, '#1a1a1a', 6, y + 4, 2, 1); p(g, '#1a1a1a', 5, y + 3, 6, 1); // tapa-olho e tira
    p(g, '#1d2a44', 9, y + 4, 1, 1);
    p(g, s.chapeu, 3, y + 1, 10, 1); p(g, s.chapeu, 5, y - 2, 6, 3); p(g, '#2b2f3a', 5, y, 6, 1);
    return;
  }
  if (s.estilo === 'forseti') {
    p(g, s.cabelo, 5, y + 1, 6, 2); p(g, s.barba, 5, y + 6, 6, 2);
    p(g, '#ffd34d', 5, y + 1, 6, 1); // diadema
  } else {
    p(g, s.cabelo, 5, y, 6, 2); p(g, s.cabelo, 4, y + 1, 1, 3); p(g, s.cabelo, 11, y + 1, 1, 3);
    if (s.cabeloLongo) { p(g, s.cabelo, 4, y + 4, 1, 4); p(g, s.cabelo, 11, y + 4, 1, 4); }
  }
  if (s.mascara) { p(g, s.mascara, 5, y + 3, 6, 2); }
  const olho = olhosFechados ? s.pele : '#1d1d28';
  if (s.mascara) { p(g, '#ffffff', 6, y + 4, 1, 1); p(g, '#ffffff', 9, y + 4, 1, 1); }
  else { p(g, olho, 6, y + 4, 1, 1); p(g, olho, 9, y + 4, 1, 1); }
  if (olhosFechados) { p(g, '#4a3a33', 6, y + 4, 1, 1); p(g, '#4a3a33', 9, y + 4, 1, 1); }
  p(g, 'rgba(120,60,50,.55)', 7, y + 6, 2, 1); // boca
  if (s.estilo === 'valquiria' || s.estilo === 'heimdall') {
    p(g, s.elmo, 5, y - 1, 6, 3); p(g, s.elmoEsc, 5, y + 1, 6, 1); p(g, s.elmo, 7, y - 2, 2, 1);
    if (s.estilo === 'valquiria') {
      p(g, s.asas, 2, y - 1, 3, 1); p(g, s.asas, 3, y, 2, 2); p(g, s.asas, 11, y - 1, 3, 1); p(g, s.asas, 11, y, 2, 2);
      p(g, s.cabelo, 4, y + 5, 1, 5); p(g, s.cabelo, 11, y + 5, 1, 5); // tranças
    } else {
      p(g, s.elmoEsc, 4, y, 1, 3); p(g, s.elmoEsc, 11, y, 1, 3);
    }
  }
  if (s.fone) { p(g, '#222', 4, y + 1, 8, 1); p(g, '#222', 4, y + 2, 1, 3); p(g, '#222', 11, y + 2, 1, 3); p(g, '#222', 10, y + 6, 2, 1); }
  if (s.bone) { p(g, '#2b2f3a', 5, y - 1, 6, 2); p(g, '#2b2f3a', 9, y + 1, 4, 1); }
  if (s.oculos) { p(g, '#222', 5, y + 4, 2, 1); p(g, '#222', 9, y + 4, 2, 1); p(g, '#222', 7, y + 4, 2, 1); }
}

function torsoFrente(g, s, dy = 0) {
  const y = 10 + dy;
  p(g, s.traje, 4, y, 8, 6);
  p(g, s.trajeEsc, 11, y, 1, 6);
  p(g, s.trajeClaro, 5, y, 1, 3);
  p(g, s.pele, 7, y, 2, 1); // pescoço
  if (s.emblema) emblema(g, s, 7, y + 2);
  if (s.cinto) p(g, s.cinto, 4, y + 5, 8, 1);
  if (s.estilo === 'heimdall') { p(g, '#f4efe2', 11, y + 4, 2, 1); p(g, '#f4efe2', 12, y + 3, 1, 1); } // Gjallarhorn
  if (s.estilo === 'pessoa' && s.traje === '#e3b52e') { p(g, '#2b2f3a', 7, y, 2, 6); } // colete
}

function bracos(g, s, modo, f, dy = 0) {
  const manga = s.estilo === 'pessoa' ? s.traje : s.traje;
  const mao = s.luvas || s.pele;
  const y = 11 + dy;
  if (modo === 'mao') {
    p(g, manga, 3, y, 1, 5); p(g, mao, 3, y + 5, 1, 1);
    const ox = f % 2 ? 1 : 0;
    p(g, manga, 12, y - 6, 1, 7); p(g, mao, 12 + ox, y - 8, 1, 2);
    return;
  }
  if (modo === 'escudo') {
    p(g, manga, 3, y, 1, 5); p(g, manga, 12, y, 1, 5);
    p(g, '#8b5a2b', 2, y - 1, 7, 8); p(g, '#c9a447', 3, y, 5, 6); p(g, '#8b5a2b', 5, y + 2, 1, 2); p(g, '#ffffff', 4, y + 1, 1, 1);
    return;
  }
  const swing = modo === 'anda' ? [0, -1, 0, 1][f % 4] : 0;
  p(g, manga, 3, y + swing, 1, 5); p(g, mao, 3, y + 5 + swing, 1, 1);
  p(g, manga, 12, y - swing, 1, 5); p(g, mao, 12, y + 5 - swing, 1, 1);
}

function pernas(g, s, modo, f) {
  if (s.estilo === 'odin' || s.estilo === 'forseti') { // túnica longa
    p(g, s.trajeEsc, 4, 16, 8, 6); p(g, s.traje, 5, 16, 6, 5);
    const pe = modo === 'anda' ? f % 2 : 0;
    p(g, s.botas, 5 + pe, 22, 2, 1); p(g, s.botas, 9 - pe, 22, 2, 1);
    return;
  }
  const calca = s.estilo === 'pessoa' ? s.trajeEsc : s.trajeEsc;
  let le = 0, ld = 0;
  if (modo === 'anda') { le = f % 4 === 1 ? -1 : 0; ld = f % 4 === 3 ? -1 : 0; }
  p(g, calca, 5, 16 + le, 3, 5); p(g, s.botas, 5, 21 + le, 3, 2);
  p(g, calca, 8, 16 + ld, 3, 5); p(g, s.botas, 8, 21 + ld, 3, 2);
  p(g, 'rgba(0,0,0,.18)', 7, 16, 1, 5);
}

function capaAtras(g, s, dy = 0) {
  if (!s.capa) return;
  p(g, s.capa, 3, 10 + dy, 10, 11); p(g, s.capaEsc, 3, 20 + dy, 10, 1);
}

/* ----------------------------------------------------------- poses */

function emPe(g, s, pose, dir, f) {
  const respira = pose === 'pe' && f % 2 === 1 ? 1 : 0;
  if (dir === 'baixo') {
    capaAtras(g, s);
    pernas(g, s, pose, f);
    torsoFrente(g, s, respira ? 0 : 0);
    bracos(g, s, pose === 'mao' ? 'mao' : pose === 'escudo' ? 'escudo' : pose, f);
    cabecaFrente(g, s, respira);
    return;
  }
  if (dir === 'cima') {
    pernas(g, s, pose, f);
    p(g, s.traje, 4, 10, 8, 6);
    bracos(g, s, pose, f);
    if (s.capa) { p(g, s.capa, 3, 10, 10, 11); p(g, s.capaEsc, 5, 11, 1, 9); p(g, s.capaEsc, 10, 11, 1, 9); p(g, s.capaEsc, 3, 20, 10, 1); }
    cabecaCostas(g, s, respira);
    return;
  }
  // lado (direita; esquerda = espelho)
  const passo = pose === 'anda' ? f % 4 : 0;
  if (s.capa) { const v = passo % 2; p(g, s.capa, 3 - v, 10, 4, 11); p(g, s.capaEsc, 3 - v, 20, 4, 1); }
  const calca = s.trajeEsc;
  if (s.estilo === 'odin' || s.estilo === 'forseti') { p(g, s.trajeEsc, 6, 16, 5, 6); p(g, s.botas, 7 + (passo % 2), 22, 3, 1); }
  else {
    const a = passo === 1 ? 1 : passo === 3 ? -1 : 0;
    p(g, calca, 6 + a, 16, 3, 5); p(g, s.botas, 6 + a, 21, 4, 2);
    p(g, calca, 7 - a, 16, 3, 5); p(g, s.botas, 7 - a, 21, 4, 2);
  }
  p(g, s.traje, 6, 10, 5, 6); p(g, s.trajeClaro, 9, 10, 1, 3);
  if (s.cinto) p(g, s.cinto, 6, 15, 5, 1);
  const sw = pose === 'anda' ? [0, -1, 0, 1][passo] : 0;
  p(g, s.traje, 8 + sw, 11, 2, 4); p(g, s.luvas || s.pele, 8 + sw, 15, 2, 1);
  // cabeça de perfil
  p(g, s.pele, 7, 4, 5, 6); p(g, s.cabelo, 6, 2, 5, 3); p(g, s.cabelo, 6, 4, 2, 3);
  if (s.estilo === 'odin') { p(g, s.barba, 8, 8, 4, 4); p(g, s.chapeu, 4, 3, 9, 1); p(g, s.chapeu, 6, 0, 5, 3); }
  if (s.mascara) p(g, s.mascara, 8, 5, 4, 2);
  p(g, s.mascara ? '#ffffff' : '#1d1d28', 10, 6, 1, 1);
  if (s.elmo) { p(g, s.elmo, 6, 1, 6, 3); if (s.estilo === 'valquiria') { p(g, s.asas, 4, 0, 3, 1); p(g, s.asas, 5, 1, 2, 2); } }
  if (s.fone) { p(g, '#222', 7, 3, 1, 4); }
}

function cabecaCostas(g, s, dy = 0) {
  const y = 2 + dy;
  p(g, s.pele, 4, y + 4, 1, 2); p(g, s.pele, 11, y + 4, 1, 2);
  if (s.estilo === 'odin') { p(g, s.cabelo, 5, y + 2, 6, 7); p(g, s.chapeu, 3, y + 1, 10, 1); p(g, s.chapeu, 5, y - 2, 6, 3); return; }
  p(g, s.cabelo, 5, y, 6, 8);
  p(g, 'rgba(0,0,0,.15)', 5, y + 6, 6, 2);
  if (s.mascara) p(g, s.mascara, 5, y + 4, 6, 1);
  if (s.elmo) { p(g, s.elmo, 5, y - 1, 6, 4); p(g, s.elmoEsc, 5, y + 2, 6, 1); if (s.estilo === 'valquiria') { p(g, s.asas, 2, y - 1, 3, 1); p(g, s.asas, 3, y, 2, 2); p(g, s.asas, 11, y - 1, 3, 1); p(g, s.asas, 11, y, 2, 2); p(g, s.cabelo, 7, y + 3, 2, 7); } }
  if (s.fone) { p(g, '#222', 4, y + 1, 8, 1); }
  if (s.bone) { p(g, '#2b2f3a', 5, y - 1, 6, 2); }
}

/** Sentado de costas para nós, olhando o monitor. anim: digitando | lendo | rodando | pensando | delegando | dormindo | erro | parado */
function sentado(g, s, anim, f) {
  const dy = anim === 'dormindo' ? 2 : 0;
  if (s.capa) { p(g, s.capa, 3, 11, 10, 10); p(g, s.capaEsc, 5, 12, 1, 9); p(g, s.capaEsc, 10, 12, 1, 9); }
  else { p(g, s.traje, 4, 11, 8, 9); p(g, s.trajeEsc, 4, 19, 8, 1); }
  const manga = s.traje;
  const mao = s.luvas || s.pele;
  if (anim === 'erro') {
    const t = f % 2;
    p(g, manga, 3, 5, 2, 7); p(g, manga, 11, 5, 2, 7); p(g, mao, 4 + t, 4, 2, 1); p(g, mao, 10 - t, 4, 2, 1);
  } else if (anim === 'digitando' || anim === 'rodando') {
    const t = anim === 'digitando' ? f % 2 : (f >> 1) % 2;
    p(g, manga, 3, 10, 2, 4); p(g, mao, 4, 9 - t, 1, 1);
    p(g, manga, 11, 10, 2, 4); p(g, mao, 11, 9 - (1 - t), 1, 1);
  } else if (anim === 'lendo') {
    p(g, manga, 3, 11, 1, 4); p(g, manga, 12, 11, 1, 4);
  } else if (anim === 'pensando') {
    p(g, manga, 3, 11, 1, 5); p(g, manga, 11, 7, 2, 5); p(g, mao, 11, 6, 1, 1);
  } else if (anim === 'delegando') {
    const t = f % 2;
    p(g, manga, 3, 11, 1, 5); p(g, manga, 12, 9 - t, 2, 3); p(g, mao, 14, 8 - t, 1, 1);
  } else {
    p(g, manga, 3, 11, 1, 5); p(g, manga, 12, 11, 1, 5);
  }
  cabecaCostas(g, s, dy + 3);
  // encosto da cadeira
  p(g, '#3a2a20', 3, 17, 10, 6); p(g, '#5a4030', 4, 17, 8, 5); p(g, '#6e4d38', 4, 17, 8, 1);
}

function contornar(c) {
  const g = c.getContext('2d');
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const w = c.width, h = c.height;
  const opaco = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 40;
  const marcas = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (opaco(x, y)) continue;
    if (opaco(x - 1, y) || opaco(x + 1, y) || opaco(x, y - 1) || opaco(x, y + 1)) marcas.push([x, y]);
  }
  g.fillStyle = CONTORNO;
  for (const [x, y] of marcas) g.fillRect(x, y, 1, 1);
}

/**
 * Quadro de um personagem. pose: pe | anda | mao | escudo | sentado ; dir: baixo | cima | direita | esquerda
 * anim (só sentado): digitando | lendo | rodando | pensando | delegando | dormindo | erro | parado
 */
export function quadro(spec, pose, dir, frame, anim = 'parado') {
  const chave = `${spec.chave}|${pose}|${dir}|${frame}|${pose === 'sentado' ? anim : ''}`;
  if (cache.has(chave)) return cache.get(chave);
  const c = canvas(PW, PH);
  const g = c.getContext('2d');
  if (pose === 'sentado') sentado(g, spec, anim, frame);
  else if (dir === 'esquerda') {
    const tmp = canvas(PW, PH);
    emPe(tmp.getContext('2d'), spec, pose, 'direita', frame);
    g.translate(PW, 0); g.scale(-1, 1); g.drawImage(tmp, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
  } else emPe(g, spec, pose, dir, frame);
  contornar(c);
  cache.set(chave, c);
  return c;
}

/* ------------------------------------------------------------- corvos */

export function corvo(frame) {
  const chave = `corvo|${frame}`;
  if (cache.has(chave)) return cache.get(chave);
  const c = canvas(12, 8);
  const g = c.getContext('2d');
  const asaCima = frame % 2 === 0;
  p(g, '#15151f', 4, 3, 5, 3); p(g, '#15151f', 8, 2, 2, 2); p(g, '#e3b341', 10, 3, 1, 1); p(g, '#2c3550', 5, 3, 2, 1);
  p(g, '#15151f', 2, 4, 2, 1);
  if (asaCima) { p(g, '#1c1c2a', 3, 0, 4, 3); p(g, '#262a40', 4, 1, 2, 1); }
  else { p(g, '#1c1c2a', 3, 5, 4, 3); p(g, '#262a40', 4, 6, 2, 1); }
  cache.set(chave, c);
  return c;
}

export function aviaoPapel(frame) {
  const chave = `aviao|${frame}`;
  if (cache.has(chave)) return cache.get(chave);
  const c = canvas(12, 8);
  const g = c.getContext('2d');
  p(g, '#f4f4f4', 1, 3, 10, 1); p(g, '#dcdcdc', 3, 4, 6, 1); p(g, '#f4f4f4', 5, 2 - (frame % 2), 4, 1); p(g, '#bfbfbf', 1, 4, 2, 1);
  cache.set(chave, c);
  return c;
}

/* ---------------------------------------------------- cenário (fundo) */

function rnd(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); }

/** Pinta o fundo estático do mapa (1 px = 1 px do mundo). */
export function pintarFundo(mapa, tema) {
  const { T, W, H } = mapa;
  const pal = tema.paleta || {};
  const c = canvas(W * T, H * T);
  const g = c.getContext('2d');
  const r = rnd(7);

  // piso de madeira
  for (let y = 2; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const px = x * T, py = y * T;
      const naCopa = x >= 23 && y >= 14;
      if (naCopa) {
        p(g, (x + y) % 2 ? pal.copaPiso : pal.copaPisoAlt, px, py, T, T);
        p(g, 'rgba(255,255,255,.04)', px, py, T, 1);
        continue;
      }
      p(g, (x * 7 + y * 3) % 5 === 0 ? pal.pisoAlt : pal.piso, px, py, T, T);
      for (let k = 0; k < 4; k++) p(g, pal.pisoJunta, px, py + k * 4 + 3, T, 1);
      const off = (y * 5 + x * 3) % 16;
      p(g, pal.pisoJunta, px + off, py, 1, 3); p(g, pal.pisoJunta, px + ((off + 8) % 16), py + 4, 1, 3);
      if (r() < 0.15) p(g, 'rgba(255,255,255,.05)', px + Math.floor(r() * 12), py + 1 + Math.floor(r() * 3) * 4, 4, 1);
    }
  }

  // parede de cima com janelas (aurora / céu)
  p(g, pal.paredeTopo, 0, 0, W * T, 6);
  p(g, pal.parede, 0, 6, W * T, 2 * T - 6);
  p(g, pal.rodape, 0, 2 * T - 3, W * T, 3);
  const aur = pal.aurora || ['#38d39f', '#4bb7e5', '#8f6bff'];
  for (const jx of [10, 21]) {
    const x0 = jx * T + 2, y0 = 8, w = 2 * T - 4, h = 18;
    p(g, '#1b1b26', x0 - 2, y0 - 2, w + 4, h + 4);
    p(g, pal.ceu, x0, y0, w, h);
    for (let i = 0; i < w; i++) {
      const yy = y0 + 4 + Math.round(Math.sin(i / 4 + jx) * 2);
      p(g, aur[i % aur.length], x0 + i, yy, 1, 3);
      p(g, 'rgba(255,255,255,.08)', x0 + i, yy + 3, 1, 4);
    }
    for (let k = 0; k < 6; k++) p(g, '#ffffff', x0 + Math.floor(r() * w), y0 + Math.floor(r() * 5), 1, 1);
    p(g, '#3b3b4d', x0 + w / 2 - 1, y0, 2, h); p(g, '#3b3b4d', x0, y0 + h / 2, w, 1);
  }

  // quadro de missões (cortiça)
  {
    const x0 = 3 * T + 2, y0 = 4, w = 6 * T - 4, h = 2 * T - 9;
    p(g, '#5a3c22', x0 - 2, y0 - 2, w + 4, h + 4); p(g, '#b88a55', x0, y0, w, h);
    const cores = ['#f4e9c8', '#cfe3f7', '#f7d1d1', '#d7f0cf', '#f4e9c8'];
    for (let i = 0; i < 5; i++) {
      const px = x0 + 4 + i * 18, py = y0 + 3 + (i % 2) * 3;
      p(g, cores[i], px, py, 12, 12); p(g, '#c0392b', px + 5, py - 1, 2, 2);
      for (let l = 0; l < 3; l++) p(g, 'rgba(0,0,0,.25)', px + 2, py + 4 + l * 3, 8 - (l % 2) * 3, 1);
    }
  }
  // quadro branco (Atlas)
  {
    const x0 = 25 * T + 2, y0 = 4, w = 6 * T - 4, h = 2 * T - 9;
    p(g, '#8d96a6', x0 - 2, y0 - 2, w + 4, h + 4); p(g, '#f4f6fa', x0, y0, w, h);
    const nos = [[10, 8], [30, 6], [30, 15], [52, 10], [74, 10]];
    p(g, '#7f8ea3', 14, 0, 0, 0);
    const lig = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4]];
    for (const [a, b] of lig) {
      const [ax, ay] = nos[a], [bx, by] = nos[b];
      for (let t = 0; t <= 1; t += 0.05) p(g, '#9aa7ba', x0 + Math.round(ax + (bx - ax) * t) + 3, y0 + Math.round(ay + (by - ay) * t) + 1, 1, 1);
    }
    nos.forEach(([nx, ny], i) => p(g, ['#2ecc71', '#2ecc71', '#3498db', '#f1c40f', '#bdc3c7'][i], x0 + nx, y0 + ny - 1, 7, 4));
  }

  // Hliðskjálf: plataforma com tapete
  {
    const t = mapa.trono;
    const x0 = t.x * T, y0 = t.y * T, w = t.w * T, h = (t.h + 1) * T;
    p(g, 'rgba(0,0,0,.35)', x0 + 2, y0 + 4, w, h);
    p(g, '#4a3b55', x0, y0, w, h);
    p(g, pal.tapete, x0 + 8, y0 + 4, w - 16, h - 10);
    p(g, pal.tapeteBorda, x0 + 8, y0 + 4, w - 16, 1); p(g, pal.tapeteBorda, x0 + 8, y0 + h - 7, w - 16, 1);
    p(g, pal.tapeteBorda, x0 + 8, y0 + 4, 1, h - 10); p(g, pal.tapeteBorda, x0 + w - 9, y0 + 4, 1, h - 10);
    p(g, '#5d4d6b', x0, y0 + h - 4, w, 4); // degrau
    // trono
    const tx = 16 * T - 2, ty = 2 * T - 10;
    p(g, '#5a3a1e', tx, ty, 2 * T + 4, 30); p(g, '#c9a447', tx + 2, ty + 2, 2 * T, 3); p(g, '#7a4f28', tx + 4, ty + 6, 2 * T - 4, 22);
    p(g, '#c9a447', tx + 2 * T / 2 + 1, ty - 4, 2, 6);
    // lança (Gungnir)
    p(g, '#8a6a3a', 19 * T + 6, 2 * T - 12, 2, 40); p(g, '#d8dde6', 19 * T + 5, 2 * T - 18, 4, 7); p(g, '#ffffff', 19 * T + 6, 2 * T - 20, 2, 2);
  }

  // estantes (biblioteca) e poço
  for (const [ex, ey, eh] of [[1, 3, 4], [1, 10, 3]]) {
    p(g, pal.madeiraEsc, ex * T, ey * T, 2 * T, eh * T);
    for (let k = 0; k < eh * 2; k++) {
      const yy = ey * T + 2 + k * 8;
      p(g, pal.madeira, ex * T + 1, yy + 6, 2 * T - 2, 2);
      for (let b = 0; b < 7; b++) p(g, ['#8e3b46', '#3b6e8e', '#c9a447', '#4d7a4a', '#6b4b8a'][(b + k) % 5], ex * T + 2 + b * 4, yy, 3, 6);
    }
  }
  {
    const x0 = mapa.poco.x * T, y0 = mapa.poco.y * T;
    p(g, '#4c4c5a', x0, y0 + 4, 3 * T, 2 * T - 4); p(g, '#6c6c7c', x0, y0 + 4, 3 * T, 3);
    p(g, '#1a3f6b', x0 + 5, y0 + 9, 3 * T - 10, 2 * T - 16); p(g, '#2a6aa8', x0 + 7, y0 + 11, 3 * T - 14, 3);
    for (let k = 0; k < 6; k++) p(g, '#3a3a46', x0 + k * 8 + 2, y0 + 2 * T - 4, 6, 3);
  }

  // balcão do verificador
  {
    const b = mapa.balcao;
    p(g, 'rgba(0,0,0,.3)', b.x * T + 2, b.y * T + 4, b.w * T, T);
  }

  // copa: sofá, mesa, cafeteira, planta
  p(g, '#7b2d3a', 25 * T, 17 * T + 2, 4 * T, T - 2); p(g, '#9a3b4b', 25 * T, 17 * T - 4, 4 * T, 7); p(g, '#63222e', 25 * T, 17 * T + 10, 4 * T, 4);
  p(g, pal.madeira, 29 * T + 2, 15 * T + 4, 2 * T - 4, 2 * T - 8); p(g, pal.madeiraEsc, 29 * T + 2, 17 * T - 6, 2 * T - 4, 2);
  p(g, '#f4f4f4', 29 * T + 8, 15 * T + 10, 5, 5); p(g, '#6b4226', 29 * T + 9, 15 * T + 11, 3, 2);
  p(g, '#2b2b36', 32 * T + 2, 15 * T - 4, 12, 18); p(g, '#c0392b', 32 * T + 4, 15 * T - 1, 3, 2); p(g, '#9aa7ba', 32 * T + 4, 15 * T + 6, 8, 5);

  // plantas
  for (const pl of mapa.plantas) {
    const x0 = pl.x * T, y0 = pl.y * T;
    p(g, '#8a5a3a', x0 + 4, y0 + 9, 8, 6); p(g, '#6a4028', x0 + 4, y0 + 9, 8, 1);
    p(g, '#2f7d4a', x0 + 3, y0 + 1, 10, 9); p(g, '#3fa060', x0 + 5, y0 - 1, 6, 6); p(g, '#4dbb73', x0 + 6, y0 + 1, 2, 3);
  }

  // parede de baixo com a porta (Bifröst)
  p(g, pal.paredeTopo, 0, (H - 1) * T, W * T, T);
  const ponte = ['#e74c3c', '#f39c12', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6'];
  for (let i = 0; i < 6; i++) {
    p(g, ponte[i], mapa.porta.x * T, (H - 1) * T + i * 2 + 2, mapa.porta.w * T, 2);
    p(g, ponte[i], mapa.porta.x * T + 2, (H - 2) * T + 10 + i, mapa.porta.w * T - 4, 1);
  }
  // paredes laterais
  p(g, pal.paredeTopo, 0, 0, T / 2, H * T); p(g, pal.paredeTopo, (W - 1) * T + T / 2, 0, T / 2, H * T);
  p(g, pal.parede, T / 2, 2 * T, T / 2, (H - 3) * T); p(g, pal.parede, (W - 1) * T, 2 * T, T / 2, (H - 3) * T);

  return c;
}

/** Baia: divisórias e mesas com monitor (desenhadas no fundo, a tela é dinâmica). */
export function pintarBaia(g, mapa, baia, tema) {
  const { T } = mapa;
  const pal = tema.paleta || {};
  const { bx, by, largura } = baia;
  // divisória do fundo
  p(g, pal.divisoria, bx * T, by * T + 4, largura * T, T - 4); p(g, pal.divisoriaTopo, bx * T, by * T + 2, largura * T, 3);
  p(g, 'rgba(0,0,0,.25)', bx * T, by * T + T - 2, largura * T, 2);
  // laterais
  for (const sx of [bx, bx + largura - 1]) {
    p(g, pal.divisoria, sx * T + 5, by * T + 4, 6, 3 * T - 6); p(g, pal.divisoriaTopo, sx * T + 5, by * T + 2, 6, 3);
  }
  // divisórias baixas entre grupos (subagentes que lançaram outros ficam isolados)
  for (const dx of baia.divisorias || []) {
    p(g, pal.divisoria, dx * T + 6, by * T + T, 4, 2 * T - 2); p(g, pal.divisoriaTopo, dx * T + 6, by * T + T - 1, 4, 2);
  }
  // mesas e monitores
  for (const m of baia.mesas) {
    const x0 = m.x * T - 2, y0 = m.y * T + 2;
    p(g, pal.madeiraEsc, x0, y0 + 8, T + 4, 6); p(g, pal.madeira, x0, y0 + 4, T + 4, 6);
    p(g, '#1f2330', m.x * T + 1, y0 - 6, 14, 10);  // monitor (moldura)
    p(g, '#3a3f52', m.x * T + 6, y0 + 4, 4, 2);     // pé
    p(g, '#d8d8d8', m.x * T + 3, y0 + 7, 10, 2);    // teclado
  }
}

/** Retângulo da tela do monitor de uma mesa (em px do mundo). */
export function telaDaMesa(mapa, m) {
  const { T } = mapa;
  return { x: m.x * T + 2, y: m.y * T + 2 - 5, w: 12, h: 8 };
}

/** Peças de frente que cobrem personagens: mesa do trono e balcão. */
export function pintarMesaTrono(tema) {
  const pal = tema.paleta || {};
  const c = canvas(4 * 16 + 8, 18);
  const g = c.getContext('2d');
  p(g, 'rgba(0,0,0,.3)', 2, 14, 4 * 16 + 6, 4);
  p(g, pal.madeiraEsc, 0, 6, 4 * 16 + 8, 10); p(g, pal.madeira, 0, 2, 4 * 16 + 8, 7); p(g, '#c9a447', 0, 2, 4 * 16 + 8, 1);
  p(g, '#f4e9c8', 10, 3, 9, 4); p(g, '#cfe3f7', 46, 3, 8, 5); p(g, '#2b2b36', 28, 0, 14, 5); p(g, '#4bb7e5', 30, 1, 10, 3);
  return c;
}

export function pintarBalcao(tema) {
  const pal = tema.paleta || {};
  const c = canvas(4 * 16, 16);
  const g = c.getContext('2d');
  p(g, pal.madeiraEsc, 0, 5, 64, 11); p(g, pal.madeira, 0, 1, 64, 6); p(g, '#c9a447', 0, 1, 64, 1);
  p(g, '#f4e9c8', 8, 2, 8, 3); p(g, '#c0392b', 40, 2, 5, 3); p(g, '#6b4226', 41, 0, 3, 2);
  return c;
}

export function rostoMimir(fase) {
  const c = canvas(14, 10);
  const g = c.getContext('2d');
  const brilho = 0.5 + 0.5 * Math.sin(fase);
  p(g, `rgba(120,200,255,${0.35 + 0.4 * brilho})`, 0, 0, 14, 10);
  p(g, '#cfe9ff', 4, 3, 2, 1); p(g, '#cfe9ff', 9, 3, 2, 1); p(g, '#cfe9ff', 5, 6, 5, 1); p(g, '#e8f6ff', 2, 7, 10, 3);
  return c;
}
