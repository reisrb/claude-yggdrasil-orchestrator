// painel.js — caixa de atenção, conversa, missões, Atlas, notificações. Fala com server.js.
import { criarEscritorio } from './escritorio/motor.js';
import { quadro, specValquiria, specPessoa, specHeroi, hash } from './escritorio/sprites.js';
import { gruposDoContexto, specPorEstilo, nomeDoWorker, animPorAtividade } from './escritorio/cena.js';
import { criarFluxos } from './fluxos.js';
import { criarAprendizado } from './aprendizado.js';
import { criarBiblioteca } from './biblioteca.js';
import { criarTerminal } from './terminal.js';

const TOKEN = document.querySelector('meta[name="orq-token"]').content;
const $ = (s) => document.querySelector(s);
const guardado = {
  ler(k, padrao) { try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } },
  gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* armazenamento indisponível */ } },
};

const ROTULO = { TRABALHANDO: 'trabalhando', PRECISA_DE_VOCE: 'precisa de você', PAUSADO_LIMITE: 'pausado (limite)', ERRO: 'erro', CONCLUIDO: 'concluído', PARADO: 'parado' };
const ORDEM = { PRECISA_DE_VOCE: 0, ERRO: 1, PAUSADO_LIMITE: 2, TRABALHANDO: 3, CONCLUIDO: 4, PARADO: 5 };

let dados = null;
let selecionado = new URLSearchParams(location.search).get('sel') || guardado.ler('orq.selecionado', null);
let som = guardado.ler('orq.som', true);
let pendentesAntes = null;
let assinaturaConversa = '';
let enviando = false;
let visao = 'escritorio';
let aba = new URLSearchParams(location.search).get('aba') || guardado.ler('orq.aba', 'conversa');
let telaCheia = false;
let proximoCiclo = null;

/* ------------------------------------------------------------------- util */

async function api(rota, corpo) {
  const op = corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Orq-Token': TOKEN }, body: JSON.stringify(corpo) } : { cache: 'no-store' };
  const r = await fetch(rota, op);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
  return j;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function md(s) {
  return esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
}
function ha(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
const hora = (iso) => { try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

function toast(texto, erro = false) {
  const el = document.createElement('div');
  el.className = `toast${erro ? ' erro' : ''}`;
  el.textContent = texto;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), erro ? 6000 : 3500);
}

function contextoSel() { return dados && dados.state.contextos.find((c) => c.id === selecionado); }

function specLider(repo) {
  const estilo = (dados && dados.tema.lideres && dados.tema.lideres.estilo) || 'pessoa';
  return estilo === 'valquiria' ? specValquiria(repo) : estilo === 'heroi' ? specHeroi(repo) : specPessoa(repo);
}
function nomeLider(repo) {
  const l = (dados && dados.tema.lideres) || {};
  const nomes = l.nomes && l.nomes.length ? l.nomes : ['Líder'];
  return `${l.titulo ? l.titulo + ' ' : ''}${nomes[hash(repo) % nomes.length]}`;
}

/* ------------------------------------------------------------- escritório */

const escritorio = criarEscritorio($('#tela'), {
  zoomInicial: new URLSearchParams(location.search).get('zoom'),
  onSelecionar: (id) => selecionar(id),
  onHotspot: (id) => hotspot(id),
  onDica: (texto, x, y) => {
    const d = $('#dica');
    if (!texto) { d.hidden = true; return; }
    d.textContent = texto; d.hidden = false;
    d.style.left = `${Math.min(x + 14, window.innerWidth - d.offsetWidth - 8)}px`;
    d.style.top = `${y + 16}px`;
  },
});

function hotspot(id) {
  if (id === 'missoes') return abrirMissoes();
  if (id === 'atlas') { location.hash = '#/fluxos'; return; }
  if (id === 'poco' || id === 'biblioteca') { location.hash = '#/aprendizado'; return; }
  if (id === 'estantes') { location.hash = '#/biblioteca'; return; }
  if (id === 'orquestrador') {
    const prox = [...dados.state.contextos].filter((c) => c.status === 'PRECISA_DE_VOCE').sort((a, b) => String(a.pergunta && a.pergunta.desde).localeCompare(String(b.pergunta && b.pergunta.desde)))[0];
    if (prox) return selecionar(prox.id);
    const nome = (dados.tema.personagens && dados.tema.personagens.orquestrador && dados.tema.personagens.orquestrador.nome) || 'Orquestrador';
    return toast(`${nome}: ninguém esperando você agora.`);
  }
  if (id === 'guarda') return abrirGuarda();
  if (id === 'verificador') return toast('O verificador confere cada critério de aceite antes de fechar o ciclo.');

}

/* ----------------------------------------------------------------- ciclo */

function atualizarJa() { clearTimeout(proximoCiclo); ciclo(); }

async function ciclo() {
  clearTimeout(proximoCiclo);
  try {
    dados = await api('/state');
    $('#conexao').hidden = true;
    renderizar();
    if (selecionado) await atualizarConversa();
  } catch (e) {
    $('#conexao').hidden = false;
    $('#conexao').textContent = `sem conexão com o servidor do Office (${e.message})`;
  } finally {
    proximoCiclo = setTimeout(ciclo, 2000);
  }
}

function renderizar() {
  const { state, config, servidor, tema } = dados;
  const nome = config.nome || 'Office';
  $('#nome').textContent = `${nome}${config.time ? ` · ${config.time}` : ''}`;
  $('#modo').textContent = `modo ${state.modo}`;
  $('#sim').hidden = !servidor.simulado;
  const ativos = state.contextos.filter((c) => c.baia != null);
  const trabalhando = state.contextos.filter((c) => c.status === 'TRABALHANDO').length;
  const custo = state.contextos.reduce((s, c) => s + (c.metricas.custoUsd || 0), 0);
  $('#resumo').innerHTML = `<b>${ativos.length}</b>/${state.maxContextos} contextos · <b>${trabalhando}</b> trabalhando · <b class="amarelo">${state.pendencias}</b> esperando você · US$ ${custo.toFixed(2)}`;
  document.title = `${state.pendencias ? `(${state.pendencias}) ` : ''}${nome} · Office`;
  $('#btn-som').classList.toggle('desligado', !som);
  $('#btn-notif').classList.toggle('desligado', !('Notification' in window) || Notification.permission !== 'granted');

  escritorio.atualizar({ state, tema });
  if (selecionado && !contextoSel()) { selecionado = null; guardado.gravar('orq.selecionado', null); }
  escritorio.selecionar(selecionado);

  avisarPendencias(state);
  renderizarLista(state);
  renderizarDetalhe(state);
  if (visao === 'painel') renderizarPainel(state);
  if (visao === 'fluxos') fluxos.atualizar(dados);
  if (visao === 'biblioteca') biblioteca.atualizar(dados);
  renderizarLimites(dados.limites);
}

function avisarPendencias(state) {
  const agora = new Set(state.contextos.filter((c) => c.status === 'PRECISA_DE_VOCE').map((c) => `${c.id}|${c.pergunta && c.pergunta.id}`));
  if (pendentesAntes) {
    for (const chave of agora) {
      if (pendentesAntes.has(chave)) continue;
      const c = state.contextos.find((x) => chave.startsWith(`${x.id}|`));
      if (!c) continue;
      if (som) tocarAviso();
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try {
          const n = new Notification(`${c.repo} precisa de você`, { body: c.pergunta ? c.pergunta.texto.slice(0, 180) : '', tag: c.id });
          n.onclick = () => { window.focus(); selecionar(c.id); n.close(); };
        } catch { /* notificação indisponível */ }
      }
    }
  }
  pendentesAntes = agora;
}

let audio = null;
function tocarAviso() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime;
    [[880, 0], [1320, 0.13]].forEach(([f, d]) => {
      const o = audio.createOscillator(); const gn = audio.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      gn.gain.setValueAtTime(0.0001, t0 + d); gn.gain.exponentialRampToValueAtTime(0.12, t0 + d + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.22);
      o.connect(gn).connect(audio.destination); o.start(t0 + d); o.stop(t0 + d + 0.25);
    });
  } catch { /* sem áudio */ }
}

/* ----------------------------------------------------------------- lista */

function renderizarLista(state) {
  const lista = [...state.contextos].sort((a, b) => (ORDEM[a.status] - ORDEM[b.status]) || String(a.pergunta && a.pergunta.desde || a.criadoEm).localeCompare(String(b.pergunta && b.pergunta.desde || b.criadoEm)));
  $('#contagem').textContent = state.pendencias ? `${state.pendencias} esperando` : `${lista.length}`;
  $('#contagem').className = `chip${state.pendencias ? ' st-PRECISA_DE_VOCE' : ''}`;
  const ul = $('#lista');
  if (!lista.length) { ul.innerHTML = '<li class="nada">Nenhum contexto. Use <b>Nova missão</b> ou clique no quadro de missões.</li>'; return; }
  const rolagem = ul.scrollTop;
  ul.innerHTML = lista.map((c) => {
    const ativ = c.atividade && c.atividade.lider;
    const linha3 = c.pergunta ? `❓ ${esc(c.pergunta.texto)}`
      : c.motivo ? esc(c.motivo)
        : ativ ? `${esc(ativ.tipo)}${ativ.alvo ? ` · ${esc(ativ.alvo)}` : ''}`
          : esc(c.ultimaMensagem || '');
    return `<li class="item${c.id === selecionado ? ' sel' : ''}${c.status === 'PRECISA_DE_VOCE' ? ' atencao' : ''}" data-id="${esc(c.id)}">
      <canvas width="16" height="24" data-repo="${esc(c.repo)}"></canvas>
      <div>
        <div class="l1"><b>${esc(c.repo)}</b><span class="chip st-${c.status}">${ROTULO[c.status] || c.status}</span></div>
        <div class="l2">${esc(nomeLider(c.repo))} · ${esc(c.fluxoNome)}${c.noTerminal ? ' · no terminal' : ''}</div>
        <div class="l3">${linha3}</div>
      </div>
      <div class="tempo">${ha(c.pergunta ? c.pergunta.desde : c.atualizadoEm)}</div>
    </li>`;
  }).join('');
  ul.scrollTop = rolagem;
  for (const cv of ul.querySelectorAll('canvas')) {
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(quadro(specLider(cv.dataset.repo), 'pe', 'baixo', 0), 0, 0);
  }
}
$('#lista').addEventListener('click', (e) => { const li = e.target.closest('.item'); if (li) selecionar(li.dataset.id); });

/* --------------------------------------------------------------- detalhe */

function selecionar(id) {
  selecionado = id;
  guardado.gravar('orq.selecionado', id);
  assinaturaConversa = '';
  escritorio.selecionar(id);
  if (!id) { terminal.desconectar(); terminal.sairDaTelaCheia(); definirTelaCheia(false); }
  else if (aba === 'terminal' || telaCheia) terminal.conectar(id);
  if (dados) { renderizarLista(dados.state); renderizarDetalhe(dados.state); }
  atualizarConversa();
}
$('#voltar').addEventListener('click', () => selecionar(null));

function renderizarDetalhe(state) {
  const c = contextoSel();
  $('#vazio').hidden = !!c;
  $('#conversa').hidden = !c;
  if (!c) {
    $('#eventos').innerHTML = [...state.eventosRecentes].reverse().slice(0, 25)
      .map((e) => `<li><span>${hora(e.ts)}</span>${esc(e.texto)}</li>`).join('') || '<li>nada ainda</li>';
    return;
  }
  $('#conv-repo').textContent = c.repo;
  $('#conv-status').textContent = ROTULO[c.status] || c.status;
  $('#conv-status').className = `chip st-${c.status}`;
  $('#conv-sub').textContent = `${nomeLider(c.repo)} · ${c.fluxoNome} · ${c.metricas.turnos} turno(s) · US$ ${c.metricas.custoUsd.toFixed(3)}${c.motivo ? ` · ${c.motivo}` : ''}`;
  const terminal = E_TERMINAL.has(c.status);
  const botao = (acao) => document.querySelector(`.conv-acoes [data-acao="${acao}"]`);
  botao('retomar').hidden = !['PAUSADO_LIMITE', 'ERRO'].includes(c.status);
  botao('parar').hidden = terminal;
  botao('dispensar').hidden = !terminal;
  botao('terminal').textContent = c.noTerminal ? 'Devolver ao Office' : 'Terminal';

  const p = c.pergunta;
  const card = $('#pergunta');
  card.hidden = !p;
  if (p) {
    $('#p-tipo').textContent = p.tipo;
    $('#p-tipo').className = 'chip st-PRECISA_DE_VOCE';
    $('#p-desde').textContent = ha(p.desde);
    $('#p-texto').innerHTML = md(p.texto) + (p.explicacao ? `<div style="font-weight:400;color:#cfd3e6;margin-top:6px">${md(p.explicacao)}</div>` : '');
    const opcoes = p.opcoes && p.opcoes.length ? p.opcoes : p.tipo === 'checkpoint' ? ['Aprovar', 'Rejeitar', 'Explica melhor'] : [];
    const chave = JSON.stringify([p.id, opcoes]);
    if ($('#p-opcoes').dataset.chave !== chave) {
      $('#p-opcoes').dataset.chave = chave;
      $('#p-opcoes').innerHTML = opcoes.map((o) => `<button type="button" class="btn${/^aprovar/i.test(o) ? ' primario' : ''}" data-opcao="${esc(o)}">${esc(o)}</button>`).join('');
    }
  }
  const encerrado = E_TERMINAL.has(c.status);
  const pode = !c.noTerminal && c.origem !== 'terminal' && !encerrado && !enviando;
  $('#resposta').disabled = !pode;
  $('#enviar').disabled = !pode;
  $('#resposta').placeholder = c.noTerminal ? 'Este contexto está no terminal. Devolva ao Office para escrever por aqui.'
    : c.origem === 'terminal' ? 'Sessão aberta no seu terminal: escreva por lá (aqui você acompanha).'
      : encerrado ? 'Contexto encerrado. Para continuar a conversa, leve a sessão ao terminal.'
        : c.status === 'PRECISA_DE_VOCE' ? 'Responda aqui, ou use os botões do cartão acima…'
          : c.status === 'TRABALHANDO' ? 'Mensagem para o agente: entra no próximo turno…'
            : 'Mensagem para o agente: retoma com a sua instrução…';
  if (aba === 'decisoes') renderizarDecisoes(c);
}

function renderizarDecisoes(c) {
  const ds = [...(c.decisoes || [])].reverse();
  const chave = JSON.stringify(ds.map((d) => [d.id, d.resposta]));
  const box = $('#decisoes');
  if (box.dataset.chave === chave) return;
  box.dataset.chave = chave;
  box.innerHTML = ds.length ? ds.map((d) => `<div class="dec${d.resposta ? '' : ' pendente'}">
      <div class="dec-topo"><span class="chip${d.resposta ? '' : ' st-PRECISA_DE_VOCE'}">${esc(d.tipo)}${d.chave ? ` · ${esc(d.chave)}` : ''}</span><span>${hora(d.desde)}</span></div>
      <div class="dec-p">${md(d.texto)}</div>
      ${d.explicacao ? `<details><summary>explicação</summary><div class="dec-exp">${md(d.explicacao)}</div></details>` : ''}
      ${d.opcoes && d.opcoes.length ? `<div class="dec-op">opções: ${d.opcoes.map(esc).join(' · ')}</div>` : ''}
      <div class="dec-r">${d.resposta ? `→ <b>${md(d.resposta)}</b> <small>${hora(d.respondidaEm)}</small>` : '<i>pendente: responda no cartão abaixo</i>'}</div>
    </div>`).join('') : '<p class="vazio-dec">Nenhuma decisão ainda neste contexto.</p>';
}
const E_TERMINAL = new Set(['CONCLUIDO', 'PARADO']);

async function atualizarConversa() {
  const c = contextoSel();
  if (!c) return;
  let msgs = [];
  try { msgs = (await api(`/contextos/${encodeURIComponent(c.id)}/conversa`)).mensagens; } catch { return; }
  const assin = `${c.id}|${msgs.length}`;
  if (assin === assinaturaConversa) return;
  assinaturaConversa = assin;
  const box = $('#mensagens');
  const noFim = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = msgs.map((m) => `<div class="msg ${esc(m.quem)}${m.tipo === 'pergunta' ? ' pergunta-msg' : ''}">${md(m.texto)}<span class="hora">${hora(m.ts)}</span></div>`).join('')
    || '<div class="msg sistema">Sem mensagens ainda.</div>';
  if (noFim) box.scrollTop = box.scrollHeight;
}

async function responder(texto) {
  const c = contextoSel();
  if (!c || !texto.trim() || enviando) return;
  enviando = true;
  const resposta = texto.trim();
  // otimista: o cartão some e o herói abaixa a mão na hora; o servidor confirma em seguida
  c.status = 'TRABALHANDO'; c.pergunta = null;
  dados.state.pendencias = Math.max(0, dados.state.pendencias - 1);
  $('#resposta').value = '';
  $('#mensagens').insertAdjacentHTML('beforeend', `<div class="msg voce">${md(resposta)}<span class="hora">enviando…</span></div>`);
  $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
  renderizar();
  try {
    await api('/responder', { contextoId: c.id, texto: resposta });
  } catch (e) {
    toast(e.message, true);
  } finally {
    enviando = false; assinaturaConversa = ''; atualizarJa();
  }
}
async function mensagemLivre(texto) {
  const c = contextoSel();
  if (!c || !texto.trim() || enviando) return;
  enviando = true;
  const msg = texto.trim();
  $('#resposta').value = '';
  $('#mensagens').insertAdjacentHTML('beforeend', `<div class="msg voce">${md(msg)}<span class="hora">enviando…</span></div>`);
  $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
  try {
    const r = await api('/mensagem', { contextoId: c.id, texto: msg });
    if (r.enfileirada) toast('O agente está no meio de um turno: sua mensagem vai assim que ele terminar.');
  } catch (e) { toast(e.message, true); } finally { enviando = false; assinaturaConversa = ''; atualizarJa(); }
}
function enviar(texto) {
  const c = contextoSel();
  if (!c) return;
  return c.status === 'PRECISA_DE_VOCE' ? responder(texto) : mensagemLivre(texto);
}
$('#composer').addEventListener('submit', (e) => { e.preventDefault(); enviar($('#resposta').value); });
$('#resposta').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviar($('#resposta').value); } });
$('#p-opcoes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-opcao]');
  if (!b) return;
  const obs = $('#p-outra').value.trim();
  $('#p-outra').value = '';
  responder(obs ? `${b.dataset.opcao}. Observação: ${obs}` : b.dataset.opcao);
});
function enviarAlternativa() {
  const t = $('#p-outra').value.trim();
  if (!t) { $('#p-outra').focus(); return; }
  $('#p-outra').value = '';
  responder(`Outra alternativa: ${t}`);
}
$('#p-enviar-outra').addEventListener('click', enviarAlternativa);
$('#p-outra').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); enviarAlternativa(); } });
$('#p-detalhes').addEventListener('click', () => { mostrarAba('terminal'); terminal.irParaOFim(); });

/* -------------------------------------------------- abas do contexto */

const terminal = criarTerminal($('#terminal'), { onTelaCheia: (on) => definirTelaCheia(on) });
function definirTelaCheia(on) {
  telaCheia = on;
  document.body.classList.toggle('term-cheia', on);
  document.documentElement.style.setProperty('--topo-h', `${$('#topo').offsetHeight}px`);
  mostrarAba(on ? (aba === 'terminal' ? 'conversa' : aba) : aba);
}
function mostrarAba(nova) {
  aba = nova;
  guardado.gravar('orq.aba', aba);
  document.querySelectorAll('.abas-det [data-aba]').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === aba));
  $('#mensagens').hidden = aba !== 'conversa';
  $('#decisoes').hidden = aba !== 'decisoes';
  $('#terminal').hidden = !(aba === 'terminal' || telaCheia);
  if ((aba === 'terminal' || telaCheia) && selecionado) terminal.conectar(selecionado);
  else terminal.desconectar();
  const c = contextoSel();
  if (c && aba === 'decisoes') { $('#decisoes').dataset.chave = ''; renderizarDecisoes(c); }
}
document.querySelector('.abas-det').addEventListener('click', (e) => {
  const b = e.target.closest('[data-aba]');
  if (!b) return;
  if (telaCheia && b.dataset.aba === 'terminal') { terminal.sairDaTelaCheia(); definirTelaCheia(false); }
  mostrarAba(b.dataset.aba);
});
mostrarAba(aba);
if (new URLSearchParams(location.search).get('cheia') === '1') { $('#terminal').classList.add('cheia'); setTimeout(() => definirTelaCheia(true), 0); }

document.querySelector('.conv-acoes').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-acao]');
  const c = contextoSel();
  if (!b || !c) return;
  const acao = b.dataset.acao;
  try {
    if (acao === 'atlas') { location.hash = `#/fluxos?ctx=${encodeURIComponent(c.id)}`; return; }
    if (acao === 'terminal') return abrirTerminal(c);
    if (acao === 'parar' && !confirm(`Parar o contexto ${c.repo}? O turno atual é interrompido.`)) return;
    await api(`/${acao}`, { contextoId: c.id });
    toast(acao === 'retomar' ? 'Retomando…' : acao === 'parar' ? 'Contexto parado.' : 'Contexto dispensado.');
    if (acao === 'dispensar') selecionar(null);
    atualizarJa();
  } catch (err) { toast(err.message, true); }
});

/* ---------------------------------------------------------------- modais */

function modal(titulo, html) {
  $('#modal-titulo').textContent = titulo;
  $('#modal-corpo').innerHTML = html;
  $('#modal').hidden = false;
  return $('#modal-corpo');
}
const fecharModal = () => { $('#modal').hidden = true; };
$('#modal-fechar').addEventListener('click', fecharModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') fecharModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(); });

function abrirMissoes(fluxoPre) {
  if (!dados) return;
  if (typeof fluxoPre !== 'string') fluxoPre = null;
  const { catalogo, state, config } = dados;
  const ativos = state.contextos.filter((c) => c.baia != null);
  const ocupados = new Set(ativos.map((c) => c.repo));
  const lotado = ativos.length >= state.maxContextos;
  const lug = (dados.tema.lugares && dados.tema.lugares.missoes) || 'Quadro de missões';
  const corpo = modal(lug, `
    ${!config.gatilho && !dados.servidor.simulado ? '<p class="amarelo">O gatilho está desligado em orquestrador.json (gatilho.habilitado).</p>' : ''}
    ${lotado ? `<p class="amarelo">Todas as ${state.maxContextos} baias estão ocupadas (maxContextos). Conclua ou pare um contexto antes.</p>` : ''}
    <div class="fluxos">${catalogo.fluxos.map((f, i) => `<button type="button" class="fluxo${(fluxoPre ? f.id === fluxoPre : i === 0) ? ' sel' : ''}" data-fluxo="${esc(f.id)}"><b>${esc(f.missao)}</b><small>${esc(f.descricao || f.nome)}</small><br><small>${f.passos.length} passo(s): ${esc(f.passos.map((p) => p.nome || p.id).join(' → '))}</small></button>`).join('') || '<p>Nenhum fluxo em time/fluxos/.</p>'}</div>
    <div class="campo"><label for="m-repo">Repositório (em repos/)</label>
      <select id="m-repo">${catalogo.repos.map((r) => `<option value="${esc(r)}"${ocupados.has(r) ? ' disabled' : ''}>${esc(r)}${ocupados.has(r) ? ' (ocupado)' : ''}</option>`).join('') || '<option value="">nenhum repo em repos/</option>'}</select></div>
    <div class="campo"><label for="m-nota">Nota para o agente (opcional)</label><textarea id="m-nota" rows="3" maxlength="2000" placeholder="Contexto extra, cuidado especial, ticket…"></textarea></div>
    <div class="linha-acoes"><button type="button" class="btn" id="m-cancelar">Cancelar</button><button type="button" class="btn primario" id="m-convocar"${lotado ? ' disabled' : ''}>Convocar</button></div>`);
  corpo.querySelector('.fluxos').addEventListener('click', (e) => {
    const b = e.target.closest('.fluxo'); if (!b) return;
    corpo.querySelectorAll('.fluxo').forEach((x) => x.classList.toggle('sel', x === b));
  });
  corpo.querySelector('#m-cancelar').addEventListener('click', fecharModal);
  corpo.querySelector('#m-convocar').addEventListener('click', async () => {
    const fluxoId = corpo.querySelector('.fluxo.sel') && corpo.querySelector('.fluxo.sel').dataset.fluxo;
    const repo = corpo.querySelector('#m-repo').value;
    const nota = corpo.querySelector('#m-nota').value.trim();
    try {
      const r = await api('/trigger', { fluxoId, repo, nota: nota || undefined });
      fecharModal(); toast(`Missão criada para ${repo}.`); selecionar(r.contextoId); atualizarJa();
    } catch (e) { toast(e.message, true); }
  });
}
$('#btn-missao').addEventListener('click', abrirMissoes);

async function abrirTerminal(c) {
  if (c.noTerminal) {
    try { await api('/terminal', { contextoId: c.id, valor: false }); toast('Contexto devolvido ao Office.'); } catch (e) { toast(e.message, true); }
    return;
  }
  const corpo = modal(`Levar ${c.repo} para o terminal`, `
    <p>Continue <b>a mesma sessão</b> no terminal para conversar a fundo. Enquanto estiver lá, o Office mostra o contexto como “no terminal” e não aceita resposta por aqui. Depois é só devolver.</p>
    <div class="cmd" id="t-cmd">${c.sessionId ? esc(`cd "${dados.servidor.raiz}" && claude --resume ${c.sessionId}`) : 'Este contexto ainda não tem sessão.'}</div>
    <div class="linha-acoes"><button type="button" class="btn" id="t-copiar">Copiar comando</button><button type="button" class="btn primario" id="t-levar"${dados.servidor.simulado ? ' title="Na simulação não existe sessão real"' : ''}>Marcar como no terminal</button></div>`);
  corpo.querySelector('#t-copiar').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(corpo.querySelector('#t-cmd').textContent); toast('Comando copiado.'); } catch { toast('Não consegui copiar; selecione o texto.', true); }
  });
  corpo.querySelector('#t-levar').addEventListener('click', async () => {
    try { await api('/terminal', { contextoId: c.id, valor: true }); fecharModal(); toast('Marcado como no terminal.'); } catch (e) { toast(e.message, true); }
  });
}

function abrirGuarda() {
  const g = dados.state.guarda;
  const nome = (dados.tema.personagens && dados.tema.personagens.guarda && dados.tema.personagens.guarda.nome) || 'Guarda';
  modal(`${nome} · bloqueios`, `
    <p style="margin-top:0">${g.liberadaAte ? `<b class="amarelo">Guarda liberada até ${hora(g.liberadaAte)}.</b>` : 'Guarda ativa: push, MR/PR, --no-verify, rm -rf fora de repos/, settings e skills do time ficam bloqueados.'}</p>
    <ol class="eventos">${[...g.bloqueios].reverse().map((b) => `<li><span>${hora(b.ts)}</span>${esc(b.alvo)} — ${esc(b.motivo)}</li>`).join('') || '<li>Nenhum bloqueio até agora.</li>'}</ol>`);
}

/* ------------------------------------------------------ notificações/som */

$('#btn-notif').addEventListener('click', async () => {
  if (!('Notification' in window)) return toast('Este navegador não tem notificações.', true);
  if (Notification.permission === 'granted') return toast('Notificações já estão ativas (aparecem quando a aba não está visível).');
  const r = await Notification.requestPermission();
  toast(r === 'granted' ? 'Notificações ativadas.' : 'Notificações não permitidas.', r !== 'granted');
  if (dados) renderizar();
});
$('#btn-som').addEventListener('click', () => {
  som = !som; guardado.gravar('orq.som', som);
  $('#btn-som').classList.toggle('desligado', !som);
  if (som) tocarAviso();
  toast(som ? 'Som ligado.' : 'Som desligado.');
});

/* ------------------------------------------------------------ visões */

const fluxos = criarFluxos($('#pagina-fluxos'), {
  onAbrirContexto: (id) => selecionar(id),
  onConvocar: (fluxoId) => abrirMissoes(fluxoId),
});
const aprendizado = criarAprendizado($('#pagina-aprendizado'));
const biblioteca = criarBiblioteca($('#pagina-biblioteca'), { api, toast });

function renderizarLimites(l) {
  const box = $('#limites');
  const tempo = (iso) => {
    const s = Math.max(0, (Date.parse(iso) - Date.now()) / 1000);
    if (!isFinite(s)) return '';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return s <= 0 ? 'renovado' : h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
  };
  const cor = (p) => (p == null ? '#8b93a7' : p >= 80 ? '#ff6b6b' : p >= 50 ? '#ffd34d' : '#2ecc71');
  if (!l || (!l.cincoHoras && !l.semana)) {
    box.innerHTML = '<span class="lim-off">5h – · semana –</span>';
    box.title = 'Os limites chegam pela statusline do Claude Code (ponte statusline-ponte.js). Abra uma sessão do Claude Code para atualizar.';
    return;
  }
  const c = l.cincoHoras || {}, w = l.semana || {};
  const pc = c.pct != null ? Math.ceil(c.pct) : null, pw = w.pct != null ? Math.ceil(w.pct) : null;
  const idadeMin = Math.round((Date.now() - Date.parse(l.atualizadoEm)) / 60000);
  const barra = `<span class="lim-barra"><span style="width:${Math.min(100, pc || 0)}%;background:${cor(pc)}"></span></span>`;
  box.innerHTML = `<span class="lim-item">5h ${barra}<b style="color:${cor(pc)}">${pc == null ? '–' : `${pc}%`}</b></span>`
    + `<span class="lim-item">semana <b style="color:${cor(pw)}">${pw == null ? '–' : `${pw}%`}</b></span>`
    + (c.renova ? `<span class="lim-item">⏳ ${tempo(c.renova)}</span>` : '')
    + (idadeMin > 15 ? `<span class="lim-velho">· de ${idadeMin} min atrás</span>` : '');
  box.classList.toggle('velho', idadeMin > 15);
  box.title = `Sessão de 5 h: ${pc ?? '–'}% (renova ${c.renova ? new Date(c.renova).toLocaleString('pt-BR') : '–'}) · semana: ${pw ?? '–'}% (renova ${w.renova ? new Date(w.renova).toLocaleString('pt-BR') : '–'}) · atualizado ${new Date(l.atualizadoEm).toLocaleTimeString('pt-BR')}`;
}

function rota() {
  const [nome, q] = location.hash.replace(/^#\/?/, '').split('?');
  const alvo = nome === 'atlas' ? 'fluxos' : nome;
  visao = ['painel', 'fluxos', 'aprendizado', 'biblioteca'].includes(alvo) ? alvo : 'escritorio';
  document.body.dataset.visao = visao;
  document.querySelectorAll('[data-visao]').forEach((a) => a.classList.toggle('ativa', a.dataset.visao === visao));
  $('#palco').hidden = visao !== 'escritorio';
  $('#pagina-painel').hidden = visao !== 'painel';
  $('#pagina-fluxos').hidden = visao !== 'fluxos';
  $('#pagina-aprendizado').hidden = visao !== 'aprendizado';
  $('#pagina-biblioteca').hidden = visao !== 'biblioteca';
  if (visao === 'fluxos') fluxos.focar(new URLSearchParams(q || '').get('ctx'));
  if (visao === 'aprendizado') aprendizado.mostrar(); else aprendizado.esconder();
  if (visao === 'biblioteca') biblioteca.mostrar();
  if (dados) renderizar();
}
window.addEventListener('hashchange', rota);

const ROT_AGENTE = { WORKING: 'trabalhando', WAITING_APPROVAL: 'aguardando', DONE: 'concluído', ERROR: 'erro' };

function cardAgente(c, a) {
  const at = c.atividade && c.atividade.workers && c.atividade.workers[a.id];
  const anim = at ? animPorAtividade(at.tipo) : null;
  return `<div class="ag st-ag-${a.status}" style="--nivel:${a.nivel || 0}" data-ctx="${esc(c.id)}">
    <canvas width="16" height="24" data-av="worker" data-semente="${esc(a.skill)}"></canvas>
    <div class="ag-info">
      <div class="ag-l1"><b>${esc(nomeDoWorker(dados.tema, a.skill))}</b><span class="chip ag-st">${ROT_AGENTE[a.status] || a.status}</span></div>
      <div class="ag-l2">${esc(a.role)} · <code>${esc(a.skill)}</code></div>
      <div class="ag-l3">${anim ? `${anim.icone} ${esc(at.tipo)}${at.alvo ? ` · ${esc(at.alvo)}` : ''}` : esc(a.summary || '')}</div>
    </div>
    <div class="tempo">${ha(a.inicio)}</div>
  </div>`;
}

function renderizarPainel(state) {
  const box = $('#pagina-painel');
  const lista = [...state.contextos].sort((a, b) => (ORDEM[a.status] - ORDEM[b.status]) || a.criadoEm.localeCompare(b.criadoEm));
  if (!lista.length) { box.innerHTML = '<p class="vazio-painel">Nenhum grupo de trabalho. Convoque uma missão.</p>'; return; }
  const rolagem = box.scrollTop;
  box.innerHTML = `<div class="grupos">${lista.map((c) => {
    const grupos = gruposDoContexto(c);
    const concluidos = c.agents.filter((a) => a.status === 'DONE' || a.status === 'ERROR');
    const lid = c.atividade && c.atividade.lider;
    const animL = lid ? animPorAtividade(lid.tipo) : null;
    const passo = c.passoAtual && (c.atlas.nodes.find((n) => n.id === c.passoAtual) || {}).label;
    return `<section class="grupo${c.id === selecionado ? ' sel' : ''}${c.status === 'PRECISA_DE_VOCE' ? ' atencao' : ''}" data-ctx="${esc(c.id)}">
      <header class="grupo-topo">
        <canvas width="16" height="24" data-av="lider" data-semente="${esc(c.repo)}"></canvas>
        <div><div class="l1"><b>${esc(c.repo)}</b> <span class="chip st-${c.status}">${ROTULO[c.status] || c.status}</span></div>
          <small>${esc(nomeLider(c.repo))} · ${esc(c.fluxoNome)}${passo ? ` · passo: ${esc(passo)}` : ''} · US$ ${c.metricas.custoUsd.toFixed(2)}</small></div>
      </header>
      ${c.pergunta ? `<div class="grupo-pergunta">❓ ${esc(c.pergunta.texto)}<button type="button" class="btn primario" data-responder="${esc(c.id)}">Responder</button></div>` : ''}
      ${c.motivo && !c.pergunta ? `<div class="grupo-motivo">${esc(c.motivo)}</div>` : ''}
      <div class="arvore">
        <div class="ag lider" data-ctx="${esc(c.id)}">
          <canvas width="16" height="24" data-av="lider" data-semente="${esc(c.repo)}"></canvas>
          <div class="ag-info"><div class="ag-l1"><b>${esc(nomeLider(c.repo))}</b><span class="chip">líder</span></div>
          <div class="ag-l3">${animL ? `${animL.icone} ${esc(lid.tipo)}${lid.alvo ? ` · ${esc(lid.alvo)}` : ''}` : esc(c.ultimaMensagem || '').slice(0, 120)}</div></div>
        </div>
        ${grupos.slice(1).map((g) => `<div class="subgrupo">${g.map((a) => cardAgente(c, a)).join('')}</div>`).join('') || '<div class="sem-workers">nenhum subagente trabalhando agora</div>'}
      </div>
      ${concluidos.length ? `<details class="concluidos"><summary>Concluídos (${concluidos.length})</summary>${concluidos.slice(-8).reverse().map((a) => cardAgente(c, { ...a, nivel: 0 })).join('')}</details>` : ''}
    </section>`;
  }).join('')}</div>`;
  box.scrollTop = rolagem;
  const tema = dados.tema;
  for (const cv of box.querySelectorAll('canvas[data-av]')) {
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    const spec = cv.dataset.av === 'lider' ? specLider(cv.dataset.semente)
      : specPorEstilo((tema.trabalhadores && tema.trabalhadores.estilo) || 'pessoa', cv.dataset.semente, ((tema.herois || {})[cv.dataset.semente] || {}).cores || {});
    g.drawImage(quadro(spec, 'pe', 'baixo', 0), 0, 0);
  }
}
$('#pagina-painel').addEventListener('click', (e) => {
  const r = e.target.closest('[data-responder]');
  if (r) { selecionar(r.dataset.responder); setTimeout(() => $('#resposta').focus(), 50); return; }
  if (e.target.closest('details')) return;
  const g = e.target.closest('[data-ctx]');
  if (g) selecionar(g.dataset.ctx);
});

rota();
ciclo();
