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
  // Odin executivo: terno risca-de-giz, gravata frouxa, tapa-olho fosco com detalhe dourado, sem chapéu, cadeira de couro preto e ouro
  odinCeo: { chave: 'npc:odin-ceo', estilo: 'odin', terno: true, pele: '#e0b48e', cabelo: '#e6e6ec', traje: '#2a2e3a', trajeEsc: '#1c1f28', trajeClaro: '#3c4152', listra: '#59607a', camisa: '#f2efe8', gravata: '#9b1c2e', gravataNo: '#c9a227', capa: null, capaEsc: null, chapeu: null, barba: '#eeeef4', tapaOlho: '#121214', tapaOlhoOuro: '#d4a63c', emblema: null, botas: '#111114', luvas: null, cinto: null, cadeira: ['#0d0d10', '#1c1c22', '#c9a227'] },
  // Heimdall na recepção: blazer dourado, crachá e um headset dourado gigante
  heimdallRecepcao: { chave: 'npc:heimdall-recepcao', estilo: 'pessoa', pele: '#c9925f', cabelo: '#f2ecda', traje: '#c9a227', trajeEsc: '#2b2f3a', trajeClaro: '#ecd27a', capa: null, mascara: null, emblema: 'circulo', emblemaCor: '#ffffff', botas: '#222', fone: '#e0a91b', foneGrande: true },
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
    const tapa = s.tapaOlho || '#1a1a1a';
    p(g, tapa, 6, y + 4, 2, 1); p(g, tapa, 5, y + 3, 6, 1); // tapa-olho e tira
    if (s.tapaOlhoOuro) { p(g, s.tapaOlhoOuro, 7, y + 4, 1, 1); p(g, s.tapaOlhoOuro, 10, y + 3, 1, 1); } // rebite e fivela dourados
    p(g, '#1d2a44', 9, y + 4, 1, 1);
    if (s.chapeu) { p(g, s.chapeu, 3, y + 1, 10, 1); p(g, s.chapeu, 5, y - 2, 6, 3); p(g, '#2b2f3a', 5, y, 6, 1); }
    else { p(g, s.cabelo, 5, y + 1, 6, 1); p(g, s.cabelo, 4, y + 1, 1, 1); p(g, s.cabelo, 11, y + 1, 1, 1); } // cabelo branco penteado
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
  if (s.fone) {
    const f = typeof s.fone === 'string' ? s.fone : '#222';
    p(g, f, 4, y + 1, 8, 1); p(g, f, 4, y + 2, 1, 3); p(g, f, 11, y + 2, 1, 3); p(g, f, 10, y + 6, 2, 1);
    if (s.foneGrande) { p(g, f, 3, y + 3, 2, 3); p(g, f, 11, y + 3, 2, 3); p(g, f, 4, y, 8, 1); p(g, f, 9, y + 7, 3, 1); } // conchas e microfone
  }
  if (s.bone) { p(g, '#2b2f3a', 5, y - 1, 6, 2); p(g, '#2b2f3a', 9, y + 1, 4, 1); }
  if (s.oculos) { p(g, '#222', 5, y + 4, 2, 1); p(g, '#222', 9, y + 4, 2, 1); p(g, '#222', 7, y + 4, 2, 1); }
}

function torsoFrente(g, s, dy = 0) {
  const y = 10 + dy;
  p(g, s.traje, 4, y, 8, 6);
  p(g, s.trajeEsc, 11, y, 1, 6);
  p(g, s.trajeClaro, 5, y, 1, 3);
  p(g, s.pele, 7, y, 2, 1); // pescoço
  if (s.terno) {
    for (const sx of [5, 7, 10]) p(g, s.listra, sx, y + 1, 1, 5); // risca-de-giz
    p(g, s.camisa, 7, y + 2, 2, 4); // camisa aberta
    p(g, s.gravata, 8, y + 3, 1, 3); p(g, s.gravata, 7, y + 5, 1, 1); // gravata frouxa e torta
    if (s.gravataNo) p(g, s.gravataNo, 8, y + 3, 1, 1);
  }
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
  if ((s.estilo === 'odin' && !s.terno) || s.estilo === 'forseti') { // túnica longa
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
  if (s.terno) { p(g, s.listra, 6, 16 + le, 1, 5); p(g, s.listra, 9, 16 + ld, 1, 5); }
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
  if ((s.estilo === 'odin' && !s.terno) || s.estilo === 'forseti') { p(g, s.trajeEsc, 6, 16, 5, 6); p(g, s.botas, 7 + (passo % 2), 22, 3, 1); }
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
  if (s.estilo === 'odin') { p(g, s.barba, 8, 8, 4, 4); if (s.chapeu) { p(g, s.chapeu, 4, 3, 9, 1); p(g, s.chapeu, 6, 0, 5, 3); } else p(g, s.tapaOlho || '#1a1a1a', 7, 5, 5, 1); }
  if (s.terno) { p(g, s.listra, 7, 11, 1, 4); p(g, s.gravata, 10, 11, 1, 3); }
  if (s.mascara) p(g, s.mascara, 8, 5, 4, 2);
  p(g, s.mascara ? '#ffffff' : '#1d1d28', 10, 6, 1, 1);
  if (s.elmo) { p(g, s.elmo, 6, 1, 6, 3); if (s.estilo === 'valquiria') { p(g, s.asas, 4, 0, 3, 1); p(g, s.asas, 5, 1, 2, 2); } }
  if (s.fone) { const f = typeof s.fone === 'string' ? s.fone : '#222'; p(g, f, 7, 3, 1, 4); if (s.foneGrande) { p(g, f, 6, 4, 2, 3); p(g, f, 8, 8, 3, 1); } }
}

function cabecaCostas(g, s, dy = 0) {
  const y = 2 + dy;
  p(g, s.pele, 4, y + 4, 1, 2); p(g, s.pele, 11, y + 4, 1, 2);
  if (s.estilo === 'odin') { p(g, s.cabelo, 5, y + 2, 6, 7); if (s.chapeu) { p(g, s.chapeu, 3, y + 1, 10, 1); p(g, s.chapeu, 5, y - 2, 6, 3); } else { p(g, s.cabelo, 5, y + 1, 6, 1); p(g, s.tapaOlho || '#1a1a1a', 4, y + 3, 8, 1); } return; }
  p(g, s.cabelo, 5, y, 6, 8);
  p(g, 'rgba(0,0,0,.15)', 5, y + 6, 6, 2);
  if (s.mascara) p(g, s.mascara, 5, y + 4, 6, 1);
  if (s.elmo) { p(g, s.elmo, 5, y - 1, 6, 4); p(g, s.elmoEsc, 5, y + 2, 6, 1); if (s.estilo === 'valquiria') { p(g, s.asas, 2, y - 1, 3, 1); p(g, s.asas, 3, y, 2, 2); p(g, s.asas, 11, y - 1, 3, 1); p(g, s.asas, 11, y, 2, 2); p(g, s.cabelo, 7, y + 3, 2, 7); } }
  if (s.fone) { const f = typeof s.fone === 'string' ? s.fone : '#222'; p(g, f, 4, y + 1, 8, 1); if (s.foneGrande) { p(g, f, 3, y + 3, 2, 3); p(g, f, 11, y + 3, 2, 3); } }
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
  const [c1, c2, c3] = s.cadeira || ['#3a2a20', '#5a4030', '#6e4d38'];
  p(g, c1, 3, 17, 10, 6); p(g, c2, 4, 17, 8, 5); p(g, c3, 4, 17, 8, 1);
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

/** Drone de monitoramento preto: alternativa aos corvos (tema → personagens.mensageiros.sprite = "drone"). */
export function drone(frame) {
  const chave = `drone|${frame}`;
  if (cache.has(chave)) return cache.get(chave);
  const c = canvas(12, 8);
  const g = c.getContext('2d');
  const giro = frame % 2 === 0;
  p(g, '#15151c', 4, 3, 4, 3); p(g, '#2a2c38', 5, 3, 2, 1);          // corpo
  p(g, '#15151c', 2, 2, 2, 1); p(g, '#15151c', 8, 2, 2, 1);          // braços
  p(g, giro ? '#8a8fa3' : '#4a4e60', 0, 1, 4, 1); p(g, giro ? '#4a4e60' : '#8a8fa3', 8, 1, 4, 1); // hélices
  p(g, frame % 4 < 2 ? '#ff4d4d' : '#3b1b1b', 5, 5, 1, 1);           // luz piscando
  p(g, '#e3b341', 7, 4, 1, 1);                                          // câmera
  p(g, '#15151c', 4, 6, 1, 2); p(g, '#15151c', 7, 6, 1, 2);          // pés
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
  const cen = tema.cenario || {}; // detalhes opcionais do tema (veja o README, seção Tema)
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
        if (cen.copaGasta && x >= 30 && y <= 17) { // carpete gasto perto das máquinas de café
          for (let k = 0; k < 5; k++) p(g, 'rgba(255,235,200,.10)', px + Math.floor(r() * 12), py + Math.floor(r() * 12), 4, 3);
        }
        continue;
      }
      p(g, (x * 7 + y * 3) % 5 === 0 ? pal.pisoAlt : pal.piso, px, py, T, T);
      if (cen.piso === 'marmore') { // placas de mármore com veios
        if (x % 2 === 0) p(g, pal.pisoJunta, px, py, 1, T);
        if (y % 2 === 0) p(g, pal.pisoJunta, px, py, T, 1);
        if (r() < 0.5) { const vx = Math.floor(r() * 10), vy = Math.floor(r() * 10); for (let k = 0; k < 6; k++) p(g, 'rgba(120,110,95,.18)', px + vx + k, py + vy + (k >> 1), 1, 1); }
        if (r() < 0.12) p(g, 'rgba(255,255,255,.35)', px + Math.floor(r() * 12), py + Math.floor(r() * 12), 3, 1);
        continue;
      }
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
    if (cen.solPoente) { p(g, '#ffe08a', x0 + w / 2 - 4, y0 + h - 5, 8, 5); p(g, '#fff2c2', x0 + w / 2 - 2, y0 + h - 4, 4, 2); } // pôr do sol artificial
    else for (let k = 0; k < 6; k++) p(g, '#ffffff', x0 + Math.floor(r() * w), y0 + Math.floor(r() * 5), 1, 1);
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
    // trono (executivo: cadeira de couro preto e ouro)
    const tx = 16 * T - 2, ty = 2 * T - 10;
    const [tr1, tr2, tr3] = cen.trono === 'executivo' ? ['#0d0d10', '#c9a227', '#1e1e26'] : ['#5a3a1e', '#c9a447', '#7a4f28'];
    p(g, tr1, tx, ty, 2 * T + 4, 30); p(g, tr2, tx + 2, ty + 2, 2 * T, 3); p(g, tr3, tx + 4, ty + 6, 2 * T - 4, 22);
    p(g, tr2, tx + 2 * T / 2 + 1, ty - 4, 2, 6);
    if (cen.trono === 'executivo') { for (let k = 0; k < 3; k++) p(g, '#2c2c36', tx + 6, ty + 9 + k * 6, 2 * T - 8, 1); p(g, tr2, tx, ty + 28, 2 * T + 4, 2); } // capitonê e base dourada
    // lança (Gungnir); no tema executivo ela vira a caneta-tinteiro na mesa
    if (cen.gungnir !== 'caneta') { p(g, '#8a6a3a', 19 * T + 6, 2 * T - 12, 2, 40); p(g, '#d8dde6', 19 * T + 5, 2 * T - 18, 4, 7); p(g, '#ffffff', 19 * T + 6, 2 * T - 20, 2, 2); }
    // porta dupla de carvalho com placas de bronze (na parede, à direita do trono)
    if (cen.portaCarvalho) {
      const px0 = 19 * T + 2, py0 = 7, pw = 2 * T - 4, ph = 2 * T - 9;
      p(g, '#3b2414', px0 - 2, py0 - 2, pw + 4, ph + 2); p(g, '#6b4423', px0, py0, pw, ph); p(g, '#7d5230', px0 + 2, py0 + 2, pw / 2 - 3, ph - 4); p(g, '#7d5230', px0 + pw / 2 + 1, py0 + 2, pw / 2 - 3, ph - 4);
      p(g, '#3b2414', px0 + pw / 2 - 1, py0, 2, ph); // fresta entre as folhas
      p(g, '#b08d57', px0 + 4, py0 + 5, 7, 3); p(g, '#b08d57', px0 + pw - 11, py0 + 5, 7, 3); // placas de bronze
      p(g, '#d9b77a', px0 + pw / 2 - 3, py0 + 12, 1, 3); p(g, '#d9b77a', px0 + pw / 2 + 2, py0 + 12, 1, 3); // maçanetas
    }
    // parede de vidro da presidência, com vista para os departamentos
    if (cen.paredeVidro) {
      const vy = y0 + h - 6;
      p(g, 'rgba(170,220,255,.22)', x0, vy, w, 4); p(g, 'rgba(170,220,255,.18)', x0, y0 + 2, 3, h - 6); p(g, 'rgba(170,220,255,.18)', x0 + w - 3, y0 + 2, 3, h - 6);
      for (let k = 0; k < w; k += 18) p(g, 'rgba(255,255,255,.55)', x0 + k + 3, vy, 6, 1); // reflexos
      p(g, '#c9a227', x0, vy + 4, w, 1); // perfil dourado
    }
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

  // sala de bloqueados: tapete avermelhado com faixa de interdição e uma placa
  if (mapa.areaBloqueados) {
    const a = mapa.areaBloqueados;
    const x0 = a.x * T, y0 = a.y * T, w = a.w * T, h = a.h * T;
    p(g, 'rgba(201,72,72,.16)', x0, y0, w, h);
    for (let i = 0; i < w; i += 4) { const cor = (i / 4) % 2 ? '#2b1a1a' : '#d64545'; p(g, cor, x0 + i, y0, 4, 2); p(g, cor, x0 + i, y0 + h - 2, 4, 2); }
    for (let j = 0; j < h; j += 4) { const cor = (j / 4) % 2 ? '#2b1a1a' : '#d64545'; p(g, cor, x0, y0 + j, 2, 4); p(g, cor, x0 + w - 2, y0 + j, 2, 4); }
    p(g, '#5a4030', x0 + w - 9, y0 + 4, 2, 11); p(g, '#d64545', x0 + w - 14, y0 + 2, 12, 8); p(g, '#ffffff', x0 + w - 12, y0 + 5, 8, 2); // placa de "proibido"
  }

  // plantas
  for (const pl of mapa.plantas) {
    const x0 = pl.x * T, y0 = pl.y * T;
    p(g, '#8a5a3a', x0 + 4, y0 + 9, 8, 6); p(g, '#6a4028', x0 + 4, y0 + 9, 8, 1);
    p(g, '#2f7d4a', x0 + 3, y0 + 1, 10, 9); p(g, '#3fa060', x0 + 5, y0 - 1, 6, 6); p(g, '#4dbb73', x0 + 6, y0 + 1, 2, 3);
  }

  // parede de baixo com a porta (Bifröst)
  p(g, pal.paredeTopo, 0, (H - 1) * T, W * T, T);
  if (cen.recepcao === 'cftv') {
    // recepção: balcão semicircular e a parede de 12 monitores de câmera (todos os andares e o estacionamento)
    const mx = 10 * T + 4, my = (H - 1) * T + 2;
    p(g, '#1b1b24', mx - 2, my - 1, 6 * 9 + 3, 13);
    for (let i = 0; i < 12; i++) {
      const sx = mx + (i % 6) * 9, sy = my + Math.floor(i / 6) * 6;
      p(g, ['#6f9aa8', '#5d8796', '#7fa7b3'][i % 3], sx, sy, 8, 5);
      p(g, 'rgba(0,0,0,.25)', sx, sy + 2, 8, 1); // linha de varredura
      if (i % 4 === 1) p(g, '#e74c3c', sx + 6, sy, 1, 1); // REC
    }
    const bx = 13 * T, by = (H - 2) * T + 6; // balcão em arco em volta do recepcionista
    p(g, '#7a5a3a', bx, by + 4, 3 * T, 6); p(g, pal.tapeteBorda || '#d4a63c', bx, by + 3, 3 * T, 1);
    p(g, '#7a5a3a', bx - 4, by - 4, 5, 12); p(g, '#7a5a3a', bx + 3 * T - 1, by - 4, 5, 12);
  }
  const ponte = ['#e74c3c', '#f39c12', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6'];
  for (let i = 0; i < 6; i++) {
    p(g, ponte[i], mapa.porta.x * T, (H - 1) * T + i * 2 + 2, mapa.porta.w * T, 2);
    p(g, ponte[i], mapa.porta.x * T + 2, (H - 2) * T + 10 + i, mapa.porta.w * T - 4, 1);
  }
  // paredes laterais
  p(g, pal.paredeTopo, 0, 0, T / 2, H * T); p(g, pal.paredeTopo, (W - 1) * T + T / 2, 0, T / 2, H * T);
  p(g, pal.parede, T / 2, 2 * T, T / 2, (H - 3) * T); p(g, pal.parede, (W - 1) * T, 2 * T, T / 2, (H - 3) * T);
  if (pal.luz) { g.fillStyle = pal.luz; g.fillRect(0, 0, W * T, H * T); } // luz ambiente (ex.: pôr do sol)

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
  if ((tema.cenario || {}).gungnir === 'caneta') { p(g, '#c8ccd6', 20, 4, 7, 1); p(g, '#ffffff', 20, 4, 2, 1); p(g, '#3a3f4d', 26, 4, 1, 1); } // caneta-tinteiro de prata (Gungnir)
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

/** Fundo de um andar de cima (k ≥ 1), pintado no mesmo canvas do prédio, na faixa do andar. */
export function pintarFundoAndar(g, mapa, k, tema, nome) {
  const { T, W } = mapa;
  const pal = tema.paleta || {};
  const AH = 20;
  const y0 = k * AH * T;
  const r = rnd(31 + k);
  // piso (carpete em placas, um tom por andar para diferenciar)
  const tons = Array.isArray(pal.andares) && pal.andares.length ? pal.andares : ['#2a3046', '#2b2f3f', '#2d2a3f', '#283342', '#30293b', '#2a3338', '#332c2c'];
  const base = tons[(k - 1) % tons.length];
  for (let y = 2; y < AH - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const px = x * T, py = y0 + y * T;
      p(g, (x + y) % 2 ? base : 'rgba(255,255,255,.035)', px, py, T, T);
      if ((x + y) % 2) continue;
      p(g, base, px, py, T, T); p(g, 'rgba(255,255,255,.035)', px, py, T, T);
      if (r() < 0.08) p(g, 'rgba(0,0,0,.12)', px + 3, py + 3, 2, 2);
    }
  }
  // parede de cima, com o nome do andar
  p(g, pal.paredeTopo || '#1d2130', 0, y0, W * T, 6);
  p(g, pal.parede || '#262b3d', 0, y0 + 6, W * T, 2 * T - 6);
  p(g, pal.rodape || '#151824', 0, y0 + 2 * T - 3, W * T, 3);
  // paredes laterais e de baixo
  p(g, pal.paredeTopo || '#1d2130', 0, y0, T, AH * T);
  p(g, pal.paredeTopo || '#1d2130', (W - 1) * T, y0, T, AH * T);
  p(g, pal.paredeTopo || '#1d2130', 0, y0 + (AH - 1) * T, W * T, T);
  // elevador (portas de metal na parede, à esquerda)
  const ex = 2 * T, ey = y0 + 4;
  p(g, '#5b6275', ex - 3, ey - 2, 2 * T + 6, 2 * T - 4);
  p(g, '#9aa3b8', ex, ey, T - 1, 2 * T - 10); p(g, '#8a93a8', ex + T + 1, ey, T - 1, 2 * T - 10);
  p(g, '#2b2f3c', ex + T - 1, ey, 2, 2 * T - 10);
  p(g, '#ffd34d', ex + T - 2, ey - 3, 4, 2); // luz do andar
  // placa com o nome do andar (centro da parede)
  const txt = nome || `${k}º andar`;
  g.font = '700 9px ui-monospace, "Cascadia Mono", Consolas, monospace';
  const tw = Math.ceil(g.measureText(txt).width) + 12;
  const tx = Math.round((W * T - tw) / 2), ty = y0 + 9;
  p(g, '#141824', tx, ty, tw, 14); p(g, '#c9a447', tx, ty, tw, 1); p(g, '#c9a447', tx, ty + 13, tw, 1);
  g.fillStyle = '#e8e6f0'; g.textBaseline = 'middle'; g.fillText(txt, tx + 6, ty + 7.5); g.textBaseline = 'alphabetic';
  // janelas e plantas
  for (const jx of [8, 25]) { p(g, '#1b1b26', jx * T, y0 + 6, 2 * T, 18); p(g, pal.ceu || '#0f1a33', jx * T + 2, y0 + 8, 2 * T - 4, 14); }
  for (const [px, py] of [[31, 3], [1, 9], [31, 17]]) { p(g, '#3c6b3a', px * T + 4, y0 + py * T + 2, 8, 8); p(g, '#7a4a2a', px * T + 5, y0 + py * T + 10, 6, 5); }
}
