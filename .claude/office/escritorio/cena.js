// cena.js — traduz o estado do orquestrador em atores no escritório.
// Líder (sessão do contexto) senta no meio da baia; workers (subagentes) nas mesas ao lado.
import { T, caminho, andarDoTile } from './mapa.js';
import { specHeroi, specValquiria, specPessoa, NPC, hash } from './sprites.js';

const VEL = 3.4 * T;           // px por segundo
const TEMPO_COPA = 25000;      // ms na copa antes de ir embora

const ehVerificador = (a) => a.role === 'verificador' || a.skill === 'verificador';
const ativo = (a) => (a.status === 'WORKING' || a.status === 'WAITING_APPROVAL') && !ehVerificador(a);

/**
 * Grupos de trabalho de um contexto, na ordem dos assentos: [[líder], [worker, filhos…], …].
 * Subagente lançado por outro subagente fica no grupo do pai (isolado dos outros grupos).
 */
export function gruposDoContexto(c) {
  const ativos = c.agents.filter(ativo);
  const porId = new Map(ativos.map((a) => [a.id, a]));
  const filhos = new Map();
  for (const a of ativos) {
    const p = a.pai && porId.has(a.pai) ? a.pai : null;
    if (!filhos.has(p)) filhos.set(p, []);
    filhos.get(p).push(a);
  }
  const ord = (l) => [...l].sort((x, y) => String(x.inicio).localeCompare(String(y.inicio)));
  const dfs = (a, out, nivel) => { out.push({ ...a, nivel }); for (const f of ord(filhos.get(a.id) || [])) dfs(f, out, nivel + 1); };
  const grupos = [[{ lider: true, id: 'lider', nivel: 0 }]];
  for (const r of ord(filhos.get(null) || [])) { const g = []; dfs(r, g, 0); grupos.push(g); }
  return grupos;
}

export function specPorEstilo(estilo, semente, extra) {
  if (estilo === 'valquiria') return specValquiria(semente, extra);
  if (estilo === 'pessoa') return specPessoa(semente, extra);
  return specHeroi(semente, extra);
}

export function nomeDoWorker(tema, skill) {
  const h = (tema.herois || {})[skill];
  if (h && h.nome) return h.nome;
  const nomes = (tema.trabalhadores && tema.trabalhadores.nomes) || ['Herói'];
  return nomes[hash(skill) % nomes.length];
}

export function nomeDaLider(tema, repo) {
  const l = tema.lideres || {};
  const nomes = l.nomes && l.nomes.length ? l.nomes : ['Líder'];
  return `${l.titulo ? l.titulo + ' ' : ''}${nomes[hash(repo) % nomes.length]}`;
}

/** O serviço de um contexto (o título, quando o alvo é um card ou Epic): aparece ao lado da chave. */
export function servicoDe(c) {
  return c && c.fluxoId !== 'chat' && c.titulo && c.titulo !== c.repo ? c.titulo : '';
}
/** Rótulo de um contexto em texto: "PROJ-123 · nome-do-servico" ou só o repo. */
export function rotuloContexto(c) {
  const s = servicoDe(c);
  return s ? `${c.repo} · ${s}` : c.repo;
}

export function animPorAtividade(tipo) {
  switch (tipo) {
    case 'digitando': return { pose: 'sentado', anim: 'digitando', tela: 'codigo', icone: '✎' };
    case 'lendo': return { pose: 'sentado', anim: 'lendo', tela: 'pagina', icone: '≡' };
    case 'buscando': return { pose: 'sentado', anim: 'lendo', tela: 'busca', icone: '⌕' };
    case 'rodando': return { pose: 'sentado', anim: 'rodando', tela: 'terminal', icone: '▸' };
    case 'delegando': return { pose: 'sentado', anim: 'delegando', tela: 'grafo', icone: '➜' };
    case 'perguntando': return { pose: 'mao', anim: null, tela: 'pergunta', icone: '?' };
    default: return { pose: 'sentado', anim: 'pensando', tela: 'pensando', icone: '…' };
  }
}

function estadoDoLider(c) {
  const at = c.atividade && c.atividade.lider;
  if (c.noTerminal) return { pose: 'sentado', anim: 'parado', tela: 'terminal', bolha: { tipo: 'terminal', texto: '>_ no terminal' } };
  switch (c.status) {
    case 'PRECISA_DE_VOCE': return { pose: 'mao', tela: 'pergunta', bolha: { tipo: 'atencao', texto: '!' } };
    case 'EM_ESPERA': return { pose: 'sentado', anim: 'parado', tela: 'desligada' }; // resumo deixado: sem bolha nem alerta
    case 'PAUSADO':
    case 'PAUSADO_LIMITE': return { pose: 'sentado', anim: 'dormindo', tela: 'desligada', bolha: { tipo: 'zz' } };
    case 'ERRO': return { pose: 'sentado', anim: 'erro', tela: 'erro', bolha: { tipo: 'erro', texto: 'erro' }, fumaca: true };
    default: {
      if (c.aguardandoTerminal) return { pose: 'mao', tela: 'pergunta', bolha: { tipo: 'terminal', texto: '>_ esperando você' } };
      const a = animPorAtividade(at ? at.tipo : 'pensando');
      return { ...a, rotulo: at && at.alvo ? at.alvo : null };
    }
  }
}

/** Chat livre na sala de chat: digita enquanto o orquestrador responde; com a vez sua, mostra 💬. */
function estadoDoChat(c) {
  if (['ERRO', 'PAUSADO', 'PAUSADO_LIMITE'].includes(c.status) || c.noTerminal) return estadoDoLider(c);
  if (c.status === 'TRABALHANDO') {
    const at = c.atividade && c.atividade.lider;
    const a = animPorAtividade(at ? at.tipo : 'pensando');
    return { ...a, rotulo: at && at.alvo ? at.alvo : 'respondendo' };
  }
  return { pose: 'sentado', anim: 'parado', tela: 'pergunta', icone: '💬', rotulo: c.titulo || 'sua vez' };
}

function estadoDoWorker(c, ag) {
  // pausado (por você ou pelo limite): os agentes dormem na mesa, onde estavam
  if (['PAUSADO', 'PAUSADO_LIMITE'].includes(c.status)) return { pose: 'sentado', anim: 'dormindo', tela: 'desligada', bolha: { tipo: 'zz' } };
  if (ag.status === 'WAITING_APPROVAL') return { pose: 'sentado', anim: 'parado', tela: 'pergunta' };
  const at = c.atividade && c.atividade.workers && c.atividade.workers[ag.id];
  const a = animPorAtividade(at ? at.tipo : 'digitando');
  return { ...a, rotulo: at && at.alvo ? at.alvo : null };
}

export class Cena {
  trocarMapa(mapa) { this.mapa = mapa; }

  constructor(mapa, tema) {
    this.mapa = mapa;
    this.tema = tema;
    this.atores = new Map();
    this.saiu = new Set(); // líderes que já saíram pela porta: não voltam a ser criados a cada atualização do estado
    this.ultimoSeq = 0;
    this.primeira = true;
    this.efeitos = [];
    this.pendencias = 0;
    this.contextos = [];
    const pers = tema.personagens || {};
    const npc = (k, padrao) => NPC[(pers[k] && pers[k].sprite) || padrao] || NPC[padrao];
    this.npcs = {
      orquestrador: { id: 'npc:orquestrador', tipo: 'npc', papel: 'orquestrador', nome: (pers.orquestrador && pers.orquestrador.nome) || 'Orquestrador', spec: npc('orquestrador', 'orquestradorNeutro'), x: 16.5 * T, y: 4.6 * T, dir: 'baixo', pose: 'pe', frame: 0, t: 0 },
      guarda: { id: 'npc:guarda', tipo: 'npc', papel: 'guarda', nome: (pers.guarda && pers.guarda.nome) || 'Guarda', spec: npc('guarda', 'guardaNeutro'), x: mapa.heimdall.x, y: mapa.heimdall.y, dir: 'baixo', pose: 'pe', frame: 0, t: 0, escudoAte: 0, bolha: null },
      verificador: { id: 'npc:verificador', tipo: 'npc', papel: 'verificador', nome: (pers.verificador && pers.verificador.nome) || 'Verificador', spec: npc('verificador', 'revisorNeutro'), x: 30 * T, y: 10.7 * T, dir: 'baixo', pose: 'pe', frame: 0, t: 0, conferindoAte: 0 },
    };
    this.mensageiroSprite = (pers.mensageiros && pers.mensageiros.sprite) || 'aviao';
    this.mimirAte = 0;
    const poleiro = [{ x: 16 * T + 1, y: 2 * T - 12 }, { x: 17 * T + 5, y: 2 * T - 12 }];
    this.corvos = poleiro.map((pp, i) => ({ id: i, casa: pp, x: pp.x, y: pp.y, voo: null, frame: 0, t: 0 }));
  }

  ator(id, criar) {
    if (!this.atores.has(id)) {
      const a = criar();
      const e = this.mapa.entrada[hash(id) % 2];
      Object.assign(a, { id, x: e.x * T + T / 2, y: (e.y + 1) * T - 1, dir: 'cima', pose: 'pe', frame: 0, t: 0, rota: [], destino: null, alpha: 1, sair: false, estado: null });
      a.novo = true;
      this.atores.set(id, a);
    }
    return this.atores.get(id);
  }

  nomeLider(c) { return nomeDaLider(this.tema, c.repo); }

  nomeWorker(skill) { return nomeDoWorker(this.tema, skill); }

  /* ---------------------------------------------------------------- destino */

  tileDe(a) { return { x: Math.floor(a.x / T), y: Math.floor((a.y - 1) / T) }; }

  irPara(a, destino) {
    const atual = a.destino;
    if (atual && atual.tipo === destino.tipo && (!destino.tile || (atual.tile && atual.tile.x === destino.tile.x && atual.tile.y === destino.tile.y))) return;
    if (atual && ['entrega', 'copa', 'saida'].includes(atual.tipo) && ['entrega', 'copa'].includes(destino.tipo)) return; // já está no caminho de saída
    let tile = destino.tile;
    if (destino.tipo === 'entrega') tile = this.mapa.entrega[hash(a.id) % this.mapa.entrega.length];
    if (destino.tipo === 'copa') tile = this.vagaCopa(a);
    if (destino.tipo === 'saida') {
      // sai pela chegada do próprio andar: a porta no térreo, o elevador nos de cima
      const ch = this.mapa.chegadaDoAndar(andarDoTile(this.tileDe(a).y));
      tile = ch[hash(a.id) % ch.length];
    }
    a.destino = { ...destino, tile };
    a.chegou = false;
    if (this.primeira && destino.tipo === 'assento') {
      a.x = tile.x * T + T / 2; a.y = (tile.y + 1) * T - 1; a.rota = []; a.chegou = true; a.novo = false;
      return;
    }
    // outro andar: pega o elevador e aparece na chegada do andar de destino
    const kDe = andarDoTile(this.tileDe(a).y), kPara = andarDoTile(tile.y);
    if (kDe !== kPara) {
      const ch = this.mapa.chegadaDoAndar(kPara);
      const t0 = ch[hash(a.id) % ch.length];
      a.x = t0.x * T + T / 2; a.y = (t0.y + 1) * T - 1;
    }
    const rota = caminho(this.mapa, this.tileDe(a), tile);
    a.rota = rota.map((t) => ({ x: t.x * T + T / 2, y: (t.y + 1) * T - 1 }));
    if (!a.rota.length) { a.x = tile.x * T + T / 2; a.y = (tile.y + 1) * T - 1; }
  }

  vagaCopa(a) {
    const ocupadas = new Set([...this.atores.values()].filter((o) => o !== a && o.destino && o.destino.tipo === 'copa').map((o) => `${o.destino.tile.x},${o.destino.tile.y}`));
    const livre = this.mapa.copa.find((v) => !ocupadas.has(`${v.x},${v.y}`));
    return livre || this.mapa.copa[hash(a.id) % this.mapa.copa.length];
  }

  /* ---------------------------------------------------------- sincronizar */

  sincronizar(estado) {
    const agora = performance.now();
    const vistos = new Set();
    this.contextos = estado.contextos;
    this.pendencias = estado.pendencias;
    // chats livres abertos sentam na sala de chat, na ordem em que foram abertos
    const chatsAbertos = estado.contextos.filter((c) => c.fluxoId === 'chat' && !['PARADO', 'CONCLUIDO'].includes(c.status))
      .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    const bloqueados = estado.contextos.filter((c) => c.status === 'BLOQUEADO' && c.fluxoId !== 'chat'); // ordem fixa na sala de bloqueados
    for (const c of estado.contextos) {
      if (c.fluxoId === 'chat') {
        const i = chatsAbertos.indexOf(c);
        const lugar = this.mapa.salaChat && i >= 0 ? this.mapa.salaChat.assentos[i] : null;
        if (!lugar && (this.primeira || this.saiu.has(`L:${c.id}`))) continue; // quem já saiu pela porta não é recriado a cada atualização
        if (lugar) this.saiu.delete(`L:${c.id}`);
        const estiloL = (this.tema.lideres && this.tema.lideres.estilo) || 'pessoa';
        const ator = this.ator(`L:${c.id}`, () => ({ tipo: 'lider', spec: specPorEstilo(estiloL, c.repo), nome: this.nomeLider(c), papel: 'chat livre' }));
        ator.ctx = c;
        ator.papel = `chat · ${c.titulo || c.repo.replace(/^chat-/, '')}`;
        vistos.add(ator.id);
        if (lugar) { ator.sair = false; this.irPara(ator, { tipo: 'assento', tile: lugar }); ator.estado = estadoDoChat(c); }
        else { ator.estado = null; this.irPara(ator, { tipo: 'saida' }); }
        continue;
      }
      if (c.status === 'BLOQUEADO' && this.mapa.areaBloqueados) {
        // bloqueado por algo de fora: a líder espera de pé na sala de bloqueados (sem baia), com a placa vermelha
        const lugares = this.mapa.areaBloqueados.lugares;
        const i = bloqueados.indexOf(c);
        const estiloB = (this.tema.lideres && this.tema.lideres.estilo) || 'pessoa';
        const lider = this.ator(`L:${c.id}`, () => ({ tipo: 'lider', spec: specPorEstilo(estiloB, c.repo), nome: this.nomeLider(c), papel: 'líder do contexto' }));
        const b = c.bloqueio || {};
        lider.ctx = c; lider.sair = false; vistos.add(lider.id);
        lider.papel = `⛔ bloqueado${b.quem ? ` · depende de ${b.quem}` : ''}: ${b.texto || 'pendência'}`;
        this.irPara(lider, { tipo: 'bloqueado', tile: lugares[i % lugares.length] });
        lider.estado = { pose: 'pe', bolha: { tipo: 'bloqueio', texto: '⛔' } };
        continue;
      }
      if (c.baia == null && (this.primeira || this.saiu.has(`L:${c.id}`))) continue; // ao abrir a página, quem já terminou não aparece (nem volta depois de sair)
      if (c.baia != null && !['PARADO', 'CONCLUIDO'].includes(c.status)) this.saiu.delete(`L:${c.id}`);
      const estiloLider = (this.tema.lideres && this.tema.lideres.estilo) || 'pessoa';
      const lider = this.ator(`L:${c.id}`, () => ({ tipo: 'lider', spec: specPorEstilo(estiloLider, c.repo), nome: this.nomeLider(c), papel: 'líder do contexto' }));
      lider.ctx = c;
      vistos.add(lider.id);
      const baia = c.baia != null ? this.mapa.baiaDe(c.id) : null;
      if (baia) {
        lider.sair = false;
        const n = baia.assentos.length;
        const lugar = (i) => (i < n ? baia.assentos[i] : { x: baia.bx + 1 + 2 * (i % n), y: baia.by + 3 }); // sem cadeira: fica no corredor
        this.irPara(lider, { tipo: 'assento', tile: lugar(0) });
        lider.estado = estadoDoLider(c);
        const ordem = gruposDoContexto(c).flat().slice(1);
        ordem.forEach((ag, k) => {
          const estilo = (this.tema.trabalhadores && this.tema.trabalhadores.estilo) || 'pessoa';
          const extra = (this.tema.herois || {})[ag.skill] || {};
          const w = this.ator(`W:${c.id}:${ag.id}`, () => ({ tipo: 'worker', spec: specPorEstilo(estilo, ag.skill, extra.cores || {}), nome: this.nomeWorker(ag.skill), papel: ag.role }));
          w.ctx = c; w.agent = ag;
          vistos.add(w.id);
          this.irPara(w, { tipo: 'assento', tile: lugar(k + 1) });
          w.estado = estadoDoWorker(c, ag);
          if (k + 1 >= n) w.estado = { ...w.estado, pose: 'pe' };
        });
        if (c.agents.some((a) => a.status === 'WORKING' && ehVerificador(a))) this.npcs.verificador.conferindoAte = agora + 2500;
      } else {
        lider.estado = null;
        this.irPara(lider, c.status === 'CONCLUIDO' ? { tipo: 'entrega' } : { tipo: 'saida' });
      }
    }
    for (const a of this.atores.values()) {
      if (vistos.has(a.id)) continue;
      a.estado = null;
      if (a.tipo === 'worker') {
        const c = estado.contextos.find((x) => a.ctx && x.id === a.ctx.id);
        const ag = c && c.agents.find((x) => a.agent && x.id === a.agent.id);
        this.irPara(a, ag && ag.status === 'DONE' ? { tipo: 'entrega' } : { tipo: 'copa' });
      } else this.irPara(a, { tipo: 'saida' });
    }
    for (const ev of estado.eventosRecentes || []) {
      if (ev.seq <= this.ultimoSeq) continue;
      if (!this.primeira) this.reagir(ev, agora);
    }
    const seqs = (estado.eventosRecentes || []).map((e) => e.seq);
    if (seqs.length) this.ultimoSeq = Math.max(this.ultimoSeq, ...seqs);
    this.primeira = false;
  }

  reagir(ev, agora) {
    if (ev.tipo === 'guarda.bloqueio') {
      const g = this.npcs.guarda;
      g.escudoAte = agora + 4500;
      g.bolha = { tipo: 'guarda', texto: ev.texto.replace(/^guarda bloqueou:\s*/, 'barrei: ') };
      this.efeitos.push({ tipo: 'brilho', x: g.x, y: g.y - 14, t: 0, dur: 900, cor: '#ffd34d' });
      return;
    }
    if (ev.tipo === 'retro') { this.mimirAte = agora + 6000; return; }
    const voa = ['worker.inicio', 'worker.fim', 'passo', 'pergunta.abrir', 'contexto.status', 'contexto.criar'];
    if (!voa.includes(ev.tipo) || !ev.contexto) return;
    const lider = this.atores.get(`L:${ev.contexto}`);
    if (!lider || andarDoTile(this.tileDe(lider).y) > 0) return; // corvos só voam no térreo
    const corvo = this.corvos.find((c) => !c.voo);
    if (!corvo) return;
    corvo.voo = { de: { x: corvo.casa.x, y: corvo.casa.y }, para: { x: lider.x - 6, y: lider.y - 34 }, t: 0, dur: 900, volta: true };
  }

  /* --------------------------------------------------------------- tempo */

  atualizar(dt, agora) {
    for (const a of [...this.atores.values()]) {
      a.t += dt;
      if (a.rota.length) {
        const alvo = a.rota[0];
        const dx = alvo.x - a.x, dy = alvo.y - a.y;
        const dist = Math.hypot(dx, dy);
        const passo = VEL * dt / 1000;
        if (Math.abs(dx) > Math.abs(dy)) a.dir = dx > 0 ? 'direita' : 'esquerda'; else a.dir = dy > 0 ? 'baixo' : 'cima';
        a.pose = 'anda';
        if (dist <= passo) { a.x = alvo.x; a.y = alvo.y; a.rota.shift(); } else { a.x += dx / dist * passo; a.y += dy / dist * passo; }
        a.frame = Math.floor(a.t / 130) % 4;
        continue;
      }
      if (a.destino && !a.chegou) { a.chegou = true; this.chegou(a, agora); }
      this.animarParado(a, agora);
      if (a.sair) a.alpha = Math.max(0, a.alpha - dt / 600);
      if (a.alpha <= 0) { if (a.sair) this.saiu.add(a.id); this.atores.delete(a.id); }
    }
    for (const n of Object.values(this.npcs)) {
      n.t += dt;
      n.frame = Math.floor(n.t / 600) % 2;
      if (n.papel === 'guarda') { n.pose = n.escudoAte > agora ? 'escudo' : 'pe'; if (n.escudoAte <= agora) n.bolha = null; }
    }
    for (const c of this.corvos) {
      c.t += dt;
      c.frame = c.voo ? Math.floor(c.t / 90) % 2 : 0;
      if (!c.voo) continue;
      c.voo.t += dt;
      const k = Math.min(1, c.voo.t / c.voo.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      c.x = c.voo.de.x + (c.voo.para.x - c.voo.de.x) * e;
      c.y = c.voo.de.y + (c.voo.para.y - c.voo.de.y) * e - Math.sin(k * Math.PI) * 22;
      if (k >= 1) c.voo = c.voo.volta ? { de: { x: c.x, y: c.y }, para: c.casa, t: 0, dur: 900, volta: false } : null;
    }
    for (const ef of this.efeitos) ef.t += dt;
    this.efeitos = this.efeitos.filter((ef) => ef.t < ef.dur);
    // fumaça e zz contínuos
    for (const a of this.atores.values()) {
      if (!a.estado || a.rota.length) continue;
      if (a.estado.fumaca && Math.random() < dt / 260) this.efeitos.push({ tipo: 'fumaca', x: a.x + (Math.random() * 6 - 3), y: a.y - 30, t: 0, dur: 1400 });
      if (a.estado.anim === 'dormindo' && Math.random() < dt / 900) this.efeitos.push({ tipo: 'zz', x: a.x + 4, y: a.y - 22, t: 0, dur: 1800 });
    }
    const v = this.npcs.verificador;
    if (v.conferindoAte > agora && Math.random() < dt / 300) this.efeitos.push({ tipo: 'brilho', x: v.x + (Math.random() * 30 - 15), y: v.y - 22 + Math.random() * 8, t: 0, dur: 700, cor: '#ffe27a' });
  }

  chegou(a, agora) {
    const d = a.destino;
    if (!d) return;
    if (d.tipo === 'assento') { a.dir = 'cima'; a.novo = false; return; }
    if (d.tipo === 'entrega') {
      a.dir = 'cima'; a.pose = 'pe';
      this.npcs.verificador.conferindoAte = agora + 1600;
      setTimeout(() => {
        this.efeitos.push({ tipo: 'carimbo', x: a.x, y: a.y - 30, t: 0, dur: 1100 });
        a.destino = null;
        this.irPara(a, { tipo: 'copa' });
      }, 1600);
      return;
    }
    if (d.tipo === 'copa') { a.dir = 'baixo'; a.pose = 'pe'; a.copaAte = agora + TEMPO_COPA; return; }
    if (d.tipo === 'bloqueado') { a.dir = 'baixo'; a.pose = 'pe'; a.novo = false; return; }
    if (d.tipo === 'saida') { a.sair = true; }
  }

  animarParado(a, agora) {
    const d = a.destino;
    if (d && d.tipo === 'copa' && a.copaAte && agora > a.copaAte && !a.sair) { a.destino = null; this.irPara(a, { tipo: 'saida' }); return; }
    if (d && d.tipo === 'assento' && a.estado) {
      a.pose = a.estado.pose;
      a.dir = a.estado.pose === 'mao' ? 'baixo' : 'cima';
      const vel = a.estado.anim === 'digitando' ? 140 : a.estado.anim === 'rodando' ? 200 : a.estado.anim === 'erro' ? 220 : 520;
      a.frame = Math.floor(a.t / vel) % 4;
      return;
    }
    if (a.pose === 'anda') a.pose = 'pe';
    a.frame = Math.floor(a.t / 700) % 2;
  }

  /** Quem está sentado em cada mesa (para pintar a tela do monitor). */
  ocupantes() {
    const mapa = new Map();
    for (const a of this.atores.values()) {
      if (a.rota.length || !a.destino || a.destino.tipo !== 'assento' || !a.estado) continue;
      mapa.set(`${a.destino.tile.x},${a.destino.tile.y}`, a);
    }
    return mapa;
  }
}
