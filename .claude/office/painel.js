// painel.js — caixa de atenção, conversa, missões, Atlas, notificações. Fala com server.js.
import { criarEscritorio } from './escritorio/motor.js';
import { quadro, specValquiria, specPessoa, specHeroi, hash } from './escritorio/sprites.js';
import { gruposDoContexto, specPorEstilo, nomeDoWorker, animPorAtividade, servicoDe, rotuloContexto } from './escritorio/cena.js';
import { md, inline } from './markdown.js';
import { criarFluxos } from './fluxos.js';
import { criarAprendizado } from './aprendizado.js';
import { criarBiblioteca } from './biblioteca.js';
import { criarTerminal } from './terminal.js';
import { criarChats } from './chats.js';
import { confirmar } from './dialogo.js';

const TOKEN = document.querySelector('meta[name="orq-token"]').content;
const $ = (s) => document.querySelector(s);
const guardado = {
  ler(k, padrao) { try { const v = localStorage.getItem(k); return v == null ? padrao : JSON.parse(v); } catch { return padrao; } },
  gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* armazenamento indisponível */ } },
};

const ROTULO = { TRABALHANDO: 'trabalhando', PRECISA_DE_VOCE: 'precisa de você', PAUSADO: 'pausado', PAUSADO_LIMITE: 'pausado (limite)', ERRO: 'erro', CONCLUIDO: 'concluído', PARADO: 'parado' };
const ORDEM = { PRECISA_DE_VOCE: 0, ERRO: 1, PAUSADO: 2, PAUSADO_LIMITE: 2, TRABALHANDO: 3, CONCLUIDO: 4, PARADO: 5 };

let dados = null;
let selecionado = new URLSearchParams(location.search).get('sel') || guardado.ler('orq.selecionado', null);
let som = guardado.ler('orq.som', true);
let pendentesAntes = null;
let assinaturaConversa = '';
let enviando = false;
let visao = 'escritorio';
let aba = new URLSearchParams(location.search).get('aba') || guardado.ler('orq.aba', 'conversa');
let telaCheia = false;
let convCheia = false; // conversa em tela cheia
let caixaAberta = false; // caixa de atenção aberta pelo botão do topo
let proximoCiclo = null;

/* ------------------------------------------------------------------- util */

async function api(rota, corpo) {
  const op = corpo ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Orq-Token': TOKEN }, body: JSON.stringify(corpo) } : { cache: 'no-store' };
  const r = await fetch(rota, op);
  const j = await r.json().catch(() => ({}));
  // a tela se atualiza sozinha, o servidor só ao reiniciar: botão novo com servidor antigo cai aqui
  if (r.status === 404 && j.erro === 'rota desconhecida') throw new Error('O servidor do Office ainda não tem este recurso: ele precisa reiniciar (pelo menu da bandeja, "Reiniciar o servidor", quando nenhum turno estiver rodando).');
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
  return j;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Chave e serviço lado a lado (o serviço mais apagado), para cabeçalhos e listas. */
const htmlContexto = (c) => `${esc(c.repo)}${servicoDe(c) ? ` <span class="ctx-servico">${esc(servicoDe(c))}</span>` : ''}`;
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
  onSelecionar: (id, extra) => {
    if (ehChatId(id)) return abrirChat(id);
    selecionar(id);
    if (extra && extra.agente) focarAgente(extra.agente);
    else if (extra && extra.lider) terminalCompleto();
  },
  onHotspot: (id) => hotspot(id),
  onDica: (texto, x, y) => {
    const d = $('#dica');
    if (!texto) { d.hidden = true; return; }
    d.textContent = texto; d.hidden = false;
    d.style.left = `${Math.min(x + 14, window.innerWidth - d.offsetWidth - 8)}px`;
    d.style.top = `${y + 16}px`;
  },
});

const ehChatId = (id) => !!(dados && dados.state.contextos.some((c) => c.id === id && c.fluxoId === 'chat'));
function abrirChat(id) { location.hash = `#/chats?id=${encodeURIComponent(id)}`; chats.abrir(id); }

/** Clicou na líder: abre o Terminal da missão completo (sem isolar agente), no fim. */
function terminalCompleto() {
  mostrarAba('terminal');
  terminal.conectar(selecionado);
  terminal.verTodos();
  terminal.irParaOFim();
}

/** Clicou num agente: abre o Terminal da missão isolado no bloco dele. */
function focarAgente(agenteId) {
  mostrarAba('terminal');
  terminal.conectar(selecionado);
  terminal.focarAgente(agenteId);
}

function hotspot(id) {
  if (id === 'chats') { location.hash = '#/chats'; return; }
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
  $('#resumo').innerHTML = `<b>${ativos.length}</b>/${state.maxContextos} contextos · <b>${trabalhando}</b> trabalhando · US$ ${custo.toFixed(2)}`;
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
  if (visao === 'chats') chats.atualizar(dados);
  renderizarLimites(dados.limites);
}

function avisarPendencias(state) {
  const agora = new Set(state.contextos.filter((c) => c.status === 'PRECISA_DE_VOCE').map((c) => `${c.id}|${c.pergunta && c.pergunta.id}`));
  if (pendentesAntes) {
    for (const chave of agora) {
      if (pendentesAntes.has(chave)) continue;
      const c = state.contextos.find((x) => chave.startsWith(`${x.id}|`));
      if (!c) continue;
      if (c.pergunta && c.pergunta.silencioso) continue; // ex.: chat reaberto
      const chatNaTela = c.fluxoId === 'chat' && visao === 'chats' && chats.ativoId() === c.id && document.visibilityState === 'visible';
      if (chatNaTela) continue; // você já está lendo a resposta
      if (som) tocarAviso();
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        try {
          const ehChat = c.fluxoId === 'chat';
          const n = new Notification(ehChat ? `${(dados.config && dados.config.nome) || 'O orquestrador'} respondeu: ${c.titulo || c.repo.replace(/^chat-/, '')}` : `${rotuloContexto(c)} precisa de você`, { body: c.pergunta ? c.pergunta.texto.slice(0, 180) : '', tag: c.id });
          n.onclick = () => { window.focus(); if (ehChat) { location.hash = `#/chats?id=${encodeURIComponent(c.id)}`; chats.abrir(c.id); } else selecionar(c.id); n.close(); };
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

let filtroCaixa = guardado.ler('orq.caixa.filtro', 'ativos'); // 'ativos' ou 'concluidos' (concluídos, parados e chats salvos)
function renderizarLista(state) {
  const peso = (c) => ORDEM[c.status] + (c.fluxoId === 'chat' ? 10 : 0); // chats vêm depois das missões
  const todos = [...state.contextos].sort((a, b) => (peso(a) - peso(b)) || String(a.pergunta && a.pergunta.desde || a.criadoEm).localeCompare(String(b.pergunta && b.pergunta.desde || b.criadoEm)));
  // encerrados (concluídos, parados e chats salvos) ficam num filtro só deles, do mais recente para o mais antigo
  const ativos = todos.filter((c) => !E_TERMINAL.has(c.status));
  const encerrados = todos.filter((c) => E_TERMINAL.has(c.status))
    .sort((a, b) => ((a.fluxoId === 'chat') - (b.fluxoId === 'chat')) || String(b.atualizadoEm).localeCompare(String(a.atualizadoEm)));
  const lista = filtroCaixa === 'concluidos' ? encerrados : ativos;
  $('#contagem').textContent = state.pendencias ? `${state.pendencias} esperando` : `${ativos.length}`;
  $('#contagem').className = `chip${state.pendencias ? ' st-PRECISA_DE_VOCE' : ''}`;
  const btnAt = $('#btn-atencao');
  btnAt.innerHTML = state.pendencias ? `⚠ <b>${state.pendencias}</b> esperando você ▾` : `Caixa de atenção · ${ativos.length} ▾`;
  btnAt.classList.toggle('pendente', state.pendencias > 0);
  const filtroHtml = [['ativos', `Ativos (${ativos.length})`], ['concluidos', `Concluídos (${encerrados.length})`]]
    .map(([f, rot]) => `<button type="button" role="tab" aria-selected="${filtroCaixa === f}" class="${filtroCaixa === f ? 'sel' : ''}" data-filtro="${f}"${f === 'concluidos' ? ' title="Concluídos, parados e chats salvos, do mais recente para o mais antigo"' : ''}>${rot}</button>`).join('');
  if ($('#caixa-filtro').innerHTML !== filtroHtml) $('#caixa-filtro').innerHTML = filtroHtml;
  const ul = $('#lista');
  if (!lista.length) {
    ul.innerHTML = filtroCaixa === 'concluidos' ? '<li class="nada">Nada concluído ainda.</li>'
      : `<li class="nada">Nenhum contexto ativo. Use <b>Nova missão</b> ou clique no quadro de missões.${encerrados.length ? ` Os encerrados estão em <b>Concluídos</b>.` : ''}</li>`;
    return;
  }
  const rolagem = ul.scrollTop;
  let secaoChat = false;
  ul.innerHTML = lista.map((c) => {
    const ativ = c.atividade && c.atividade.lider;
    const cab = c.fluxoId === 'chat' && !secaoChat ? (secaoChat = true, '<li class="sep-chats">💬 Chats</li>') : '';
    const ehChat = c.fluxoId === 'chat';
    const linha3 = c.pergunta ? `${ehChat ? '💬' : '❓'} ${esc(c.pergunta.texto)}`
      : c.motivo ? esc(c.motivo)
        : ativ ? `${esc(ativ.tipo)}${ativ.alvo ? ` · ${esc(ativ.alvo)}` : ''}`
          : esc(c.ultimaMensagem || '');
    return `${cab}<li class="item${c.id === selecionado ? ' sel' : ''}${c.status === 'PRECISA_DE_VOCE' && c.fluxoId !== 'chat' ? ' atencao' : ''}${c.fluxoId === 'chat' ? ' item-chat' : ''}" data-id="${esc(c.id)}">
      <canvas width="16" height="24" data-repo="${esc(c.repo)}"></canvas>
      <div>
        <div class="l1"><b>${ehChat ? esc(`💬 ${c.titulo || c.repo.replace(/^chat-/, '')}`) : htmlContexto(c)}</b><span class="chip st-${c.status}">${ehChat && c.status === 'PRECISA_DE_VOCE' ? 'sua vez' : ehChat && c.status === 'PARADO' ? 'salvo' : (ROTULO[c.status] || c.status)}</span></div>
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
$('#caixa-filtro').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filtro]');
  if (!b || b.dataset.filtro === filtroCaixa) return;
  e.stopPropagation(); // a caixa suspensa continua aberta ao trocar o filtro
  filtroCaixa = b.dataset.filtro;
  guardado.gravar('orq.caixa.filtro', filtroCaixa);
  if (dados) renderizarLista(dados.state);
});
$('#lista').addEventListener('click', (e) => {
  const li = e.target.closest('.item');
  if (!li) return;
  const c = dados && dados.state.contextos.find((x) => x.id === li.dataset.id);
  abrirCaixa(false);
  if (c && c.fluxoId === 'chat') { location.hash = `#/chats?id=${encodeURIComponent(c.id)}`; chats.abrir(c.id); return; } // chat abre na tela de Chats
  selecionar(li.dataset.id);
});

/* --------------------------------------------------------------- detalhe */

function selecionar(id) {
  selecionado = id;
  guardado.gravar('orq.selecionado', id);
  assinaturaConversa = '';
  escritorio.selecionar(id);
  if (!id) { terminal.desconectar(); terminal.sairDaTelaCheia(); definirTelaCheia(false); definirConvCheia(false); }
  else if (aba === 'terminal' || telaCheia) terminal.conectar(id);
  if (dados) { renderizarLista(dados.state); renderizarDetalhe(dados.state); }
  atualizarConversa();
}
$('#voltar').addEventListener('click', () => selecionar(null));

function renderizarDetalhe(state) {
  const c = contextoSel();
  posicionarCaixa();
  $('#vazio').hidden = !!c;
  $('#conversa').hidden = !c;
  if (!c) {
    encaixarPergunta(null);
    encaixarVivo(null);
    $('#eventos').innerHTML = [...state.eventosRecentes].reverse().slice(0, 25)
      .map((e) => `<li><span>${hora(e.ts)}</span>${esc(e.texto)}</li>`).join('') || '<li>nada ainda</li>';
    return;
  }
  $('#conv-repo').innerHTML = htmlContexto(c);
  $('#conv-repo').title = $('#conv-repo').textContent.replace(/\s+/g, ' ').trim();
  $('#conv-status').textContent = ROTULO[c.status] || c.status;
  $('#conv-status').className = `chip st-${c.status}`;
  $('#conv-sub').textContent = $('#conv-sub').title = `${nomeLider(c.repo)} · ${c.fluxoNome} · ${c.metricas.turnos} turno(s) · US$ ${c.metricas.custoUsd.toFixed(3)}${c.motivo ? ` · ${c.motivo}` : ''}`;
  const terminal = E_TERMINAL.has(c.status);
  const reativavel = terminal && c.fluxoId !== 'chat' && c.origem !== 'terminal' && !c.noTerminal;
  const botao = (acao) => document.querySelector(`.conv-acoes [data-acao="${acao}"]`);
  botao('retomar').hidden = !['PAUSADO', 'PAUSADO_LIMITE', 'ERRO'].includes(c.status);
  botao('pausar').hidden = c.status !== 'TRABALHANDO' || c.noTerminal || c.origem === 'terminal' || c.fluxoId === 'chat';
  botao('parar').hidden = terminal;
  botao('dispensar').hidden = !terminal;
  botao('reativar').hidden = !reativavel;
  botao('terminal').textContent = c.noTerminal ? 'Devolver ao Office' : 'Levar ao terminal';

  const p = c.pergunta;
  const card = $('#pergunta');
  card.hidden = !p;
  if (p) {
    $('#p-tipo').textContent = p.tipo;
    $('#p-tipo').className = 'chip st-PRECISA_DE_VOCE';
    $('#p-desde').textContent = ha(p.desde);
    desenharQuemPede(c, p);
    $('#p-texto').innerHTML = md(p.texto) + (p.explicacao ? `<div style="font-weight:400;color:#cfd3e6;margin-top:6px">${md(p.explicacao)}</div>` : '');
    const opcoes = p.opcoes && p.opcoes.length ? p.opcoes : p.tipo === 'checkpoint' ? ['Aprovar', 'Rejeitar', 'Explica melhor'] : [];
    const chave = JSON.stringify([p.id, opcoes]);
    if ($('#p-opcoes').dataset.chave !== chave) {
      $('#p-opcoes').dataset.chave = chave;
      $('#p-opcoes').innerHTML = opcoes.map((o) => `<button type="button" class="btn${/^aprovar/i.test(o) ? ' primario' : ''}" data-opcao="${esc(o)}">${esc(o)}</button>`).join('');
    }
  }
  encaixarPergunta(c);
  encaixarVivo(c);
  const encerrado = E_TERMINAL.has(c.status);
  const pode = !c.noTerminal && c.origem !== 'terminal' && (!encerrado || reativavel) && !enviando;
  $('#resposta').disabled = !pode;
  $('#enviar').disabled = !pode;
  $('#corrigir').hidden = !pode || !['TRABALHANDO', 'PAUSADO'].includes(c.status);
  $('#registrar').hidden = c.noTerminal || c.origem === 'terminal';
  $('#registrar').title = `A líder registra o que foi feito ${c.ultimoRegistro ? `desde o último registro (${new Date(c.ultimoRegistro.ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })})` : 'desde o início do contexto'} e mostra o que gravou`;
  $('#resposta').placeholder = c.noTerminal ? 'Este contexto está no terminal. Devolva ao Office para escrever por aqui.'
    : c.origem === 'terminal' ? 'Sessão aberta no seu terminal: escreva por lá (aqui você acompanha).'
      : encerrado && reativavel ? `Contexto ${c.status === 'PARADO' ? 'parado' : 'concluído'}: escreva aqui para reativar e continuar a mesma sessão…`
        : encerrado ? 'Contexto encerrado. Para continuar a conversa, leve a sessão ao terminal.'
        : c.status === 'PRECISA_DE_VOCE' ? 'Responda aqui, ou use as opções da pergunta em amarelo…'
          : c.status === 'TRABALHANDO' ? 'Enviar: entra no próximo turno. Corrigir: interrompe o turno agora e manda no lugar…'
            : c.status === 'PAUSADO' ? 'Pausado: Enviar põe na fila (vai depois de Retomar). Corrigir: corta e manda agora…'
            : 'Mensagem para o agente: retoma com a sua instrução…';
  if (aba === 'decisoes') renderizarDecisoes(c);
}

function renderizarDecisoes(c) {
  // só as decisões já tomadas; a pergunta aberta se responde na Conversa (aqui, só o aviso)
  const ds = [...(c.decisoes || [])].filter((d) => d.resposta).reverse();
  const pendente = !!c.pergunta;
  const chave = JSON.stringify([ds.map((d) => [d.id, d.resposta]), pendente]);
  const box = $('#decisoes');
  if (box.dataset.chave === chave) return;
  box.dataset.chave = chave;
  const aviso = pendente ? '<div class="dec-aviso">❓ Uma pergunta espera você. <button type="button" class="link" data-ir="conversa">responder na Conversa →</button></div>' : '';
  box.innerHTML = aviso + (ds.length ? ds.map((d) => `<div class="dec">
      <div class="dec-topo"><span class="chip">${esc(d.tipo)}${d.chave ? ` · ${esc(d.chave)}` : ''}</span><span>${hora(d.respondidaEm || d.desde)}</span></div>
      <div class="dec-p">${md(d.texto)}</div>
      <div class="dec-r">→ <b>${inline(d.resposta)}</b></div>
      ${d.explicacao || (d.opcoes && d.opcoes.length) ? `<details><summary>detalhes</summary>${d.explicacao ? `<div class="dec-exp">${md(d.explicacao)}</div>` : ''}${d.opcoes && d.opcoes.length ? `<div class="dec-op">opções: ${d.opcoes.map(esc).join(' · ')}</div>` : ''}</details>` : ''}
    </div>`).join('') : '<p class="vazio-dec">Nenhuma decisão tomada ainda neste contexto.</p>');
}
const E_TERMINAL = new Set(['CONCLUIDO', 'PARADO']);

/** No cartão de decisão: quem pede (a líder da missão), sobre qual etapa e quantos agentes esperam a resposta. */
function sobreQueEtapa(c, p) {
  const alvo = p.chave && String(p.chave).startsWith('passo:') ? String(p.chave).slice(6) : p.passo || c.passoAtual;
  const no = alvo && c.atlas.nodes.find((n) => n.id === alvo);
  if (p.chave === 'spec') return { rotulo: 'a spec do ciclo' };
  if (p.chave === 'plano') return { rotulo: 'o plano e as tarefas' };
  return no ? { rotulo: `a etapa ${no.label || no.id}`, skill: no.skill, papel: no.papel } : null;
}
function desenharQuemPede(c, p) {
  const box = $('#p-quem');
  if (c.fluxoId === 'chat') { box.hidden = true; return; }
  const etapa = sobreQueEtapa(c, p);
  const esperando = c.agents.filter((a) => a.status === 'WAITING_APPROVAL').length;
  const heroi = etapa && etapa.skill ? nomeDoWorker(dados.tema, etapa.skill) : null;
  const chave = JSON.stringify([c.id, p.id, esperando]);
  if (box.dataset.chave === chave) return;
  box.dataset.chave = chave;
  box.hidden = false;
  box.innerHTML = `<canvas width="16" height="24"></canvas>
    <div><div><b>${esc(nomeLider(c.repo))}</b>, líder de <b>${esc(c.repo)}</b>, pede sua decisão</div>
      <small>${etapa ? `sobre ${esc(etapa.rotulo)}${etapa.skill ? ` · <code>${esc(etapa.skill)}</code>${heroi ? ` (${esc(heroi)}${etapa.papel ? `, ${esc(etapa.papel)}` : ''})` : ''}` : ''}` : 'sobre o andamento da missão'}${esperando ? ` · ${esperando} agente(s) parado(s) esperando a resposta` : ''}</small></div>`;
  const g = box.querySelector('canvas').getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(quadro(specLider(c.repo), 'mao', 'baixo', 0), 0, 0);
}

async function atualizarConversa() {
  const c = contextoSel();
  if (!c) return;
  let msgs = [];
  try { msgs = (await api(`/contextos/${encodeURIComponent(c.id)}/conversa`)).mensagens; } catch { return; }
  const fila = c.fila || []; // mensagens esperando a líder terminar o turno
  const assin = `${c.id}|${msgs.length}|${fila.map((f) => f.id).join(',')}`;
  if (assin === assinaturaConversa) return;
  assinaturaConversa = assin;
  const box = $('#mensagens');
  const outra = box.dataset.ctx !== c.id; // trocou de missão: abre na última mensagem
  box.dataset.ctx = c.id;
  const noFim = outra || box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = msgs.map((m) => `<div class="msg ${esc(m.quem)}${m.tipo === 'pergunta' ? ' pergunta-msg' : ''}">${md(m.texto)}<span class="hora">${hora(m.ts)}</span></div>`).join('')
    || '<div class="msg sistema">Sem mensagens ainda.</div>';
  box.insertAdjacentHTML('beforeend', fila.map((f) => `<div class="msg voce na-fila">${md(f.texto)}<span class="hora fila-info"><span title="Na fila: vai assim que a líder terminar o turno">⏱ aguardando · ${hora(f.desde)}</span><button type="button" class="fila-agora" data-fila-enviar title="Interrompe o turno e manda agora o que está na fila">➤</button></span></div>`).join(''));
  encaixarPergunta(c); // o innerHTML acima tirou o cartão da mensagem: devolve
  encaixarVivo(c);
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
    if (r.enfileirada) toast('Na fila (⏱): vai quando a líder terminar o turno. Clique em ➤ para mandar agora.');
    if (r.reativado) toast('Contexto reativado: o líder continua a mesma sessão com a sua mensagem.');
  } catch (e) { toast(e.message, true); } finally { enviando = false; assinaturaConversa = ''; atualizarJa(); }
}
function enviar(texto) {
  const c = contextoSel();
  if (!c) return;
  return c.status === 'PRECISA_DE_VOCE' ? responder(texto) : mensagemLivre(texto);
}
/** Corrigir: interrompe o turno que está rodando e manda o texto como correção (sem texto, só interrompe). */
async function corrigir() {
  const c = contextoSel();
  if (!c || enviando) return;
  const msg = $('#resposta').value.trim();
  if (!(await confirmar({
    titulo: `Interromper ${rotuloContexto(c)} para corrigir?`,
    texto: `${msg ? 'O turno para agora e o agente recebe o seu texto como correção.' : 'O turno para agora; depois, escreva a correção e envie.'} O que ele estava fazendo pode ficar pela metade: antes de seguir, ele confere o que já foi feito e pergunta antes de desfazer algo.`,
    ok: 'Interromper', perigo: true,
  }))) return;
  enviando = true;
  if (msg) {
    $('#resposta').value = '';
    $('#mensagens').insertAdjacentHTML('beforeend', `<div class="msg voce">${md(msg)}<span class="hora">enviando…</span></div>`);
    $('#mensagens').scrollTop = $('#mensagens').scrollHeight;
  }
  try {
    await api('/corrigir', { contextoId: c.id, texto: msg || undefined });
    toast(msg ? 'Turno interrompido: a correção vai em seguida.' : 'Turno interrompido: escreva a correção e envie.');
  } catch (e) {
    if (msg) $('#resposta').value = msg;
    toast(e.message, true);
  } finally {
    enviando = false; assinaturaConversa = ''; atualizarJa();
    if (!msg) $('#resposta').focus();
  }
}
$('#corrigir').addEventListener('click', corrigir);

/** Registrar: a líder grava o que foi feito desde o último registro; com turno rodando, entra na fila (⏱). */
$('#registrar').addEventListener('click', async () => {
  const c = contextoSel();
  if (!c || enviando) return;
  try {
    const r = await api('/registrar', { contextoId: c.id });
    toast(r.enfileirada ? 'Registro na fila (⏱): a líder registra quando terminar o turno.' : 'Registrando: a líder grava o que foi feito e mostra o que gravou.');
  } catch (e) { toast(e.message, true); } finally { assinaturaConversa = ''; atualizarJa(); }
});

/** Seta ➤ numa mensagem da fila: corta o turno e entrega agora o que está na fila. */
$('#mensagens').addEventListener('click', async (e) => {
  if (!e.target.closest('[data-fila-enviar]')) return;
  const c = contextoSel();
  if (!c || enviando) return;
  if (c.fluxoId !== 'chat' && !(await confirmar({
    titulo: `Mandar agora para ${rotuloContexto(c)}?`,
    texto: 'O turno atual para e a líder recebe na hora o que está na fila. O que ela estava fazendo pode ficar pela metade: antes de seguir, ela confere o que já foi feito.',
    ok: 'Mandar agora', perigo: true,
  }))) return;
  try {
    const r = await api('/fila-enviar', { contextoId: c.id });
    toast(r.vazia ? 'A fila já tinha sido entregue.' : 'Turno interrompido: a mensagem da fila vai agora.');
  } catch (err) { toast(err.message, true); } finally { assinaturaConversa = ''; atualizarJa(); }
});
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

/* A pergunta aberta mora dentro do fluxo. Na Conversa, a mensagem da pergunta fica amarela e o cartão
   (quem pede, opções, outra alternativa) vira o rodapé dela, sem repetir o texto. No Terminal, o cartão,
   com o texto, fica no fim da saída. Em Decisões, ou sem a mensagem ainda, volta para a base da lateral.
   O elemento é sempre o mesmo, então os ouvintes dos botões continuam valendo. */
const cartao = $('#pergunta');
function encaixarPergunta(c) {
  const p = c && c.pergunta;
  cartao.hidden = !p;
  const box = $('#mensagens');
  box.querySelectorAll('.msg.aberta').forEach((m) => m.classList.remove('aberta'));
  cartao.classList.remove('embutido', 'no-terminal');
  const texto = cartao.querySelector('.p-texto');
  const detalhes = cartao.querySelector('#p-detalhes');
  texto.hidden = false;
  detalhes.hidden = false;
  if (p && aba === 'terminal') {
    detalhes.hidden = true;
    terminal.encaixar(cartao); // o terminal decide: dentro da fala da líder ou sozinho no fim
    return;
  }
  terminal.soltar();
  // o cartão vai na última fala da líder desde a pergunta: as opções ficam no fim, onde se lê
  let alvo = null;
  if (p && aba === 'conversa') {
    const msgs = [...box.querySelectorAll(':scope > .msg')].filter((m) => m !== vivo);
    const iPerg = msgs.map((m) => m.classList.contains('pergunta-msg')).lastIndexOf(true);
    if (iPerg >= 0) {
      alvo = msgs[iPerg];
      for (let k = msgs.length - 1; k > iPerg; k--) if (msgs[k].classList.contains('agente')) { alvo = msgs[k]; break; }
    }
  }
  if (alvo) {
    alvo.classList.add('aberta');
    cartao.classList.add('embutido');
    texto.hidden = true;
    if (cartao.parentElement !== alvo) alvo.insertBefore(cartao, alvo.querySelector(':scope > .hora'));
    return;
  }
  if (p && aba === 'decisoes') cartao.hidden = true; // em Decisões só o histórico: responde-se na Conversa
  const composer = $('#composer');
  if (cartao.nextElementSibling !== composer) composer.before(cartao);
}

/* Sinal de vida na Conversa: enquanto o turno roda, um balão no fim com a líder trabalhando e as últimas
   atividades dela e dos agentes (como no terminal), montadas do que os hooks já mandam ao Office. */
const vivo = document.createElement('div');
vivo.className = 'msg agente vivo';
vivo.innerHTML = '<div class="vivo-cab"><span class="vivo-pontos"><i></i><i></i><i></i></span><b></b> está trabalhando <small></small></div><div class="vivo-log"></div>';
const rastros = new Map(); // contexto -> { desde, itens }
function anotarRastro(c) {
  if (!c || c.status !== 'TRABALHANDO') { if (c) rastros.delete(c.id); return null; }
  let r = rastros.get(c.id);
  if (!r) { r = { desde: Date.now(), itens: [] }; rastros.set(c.id, r); }
  const ativ = c.atividade || {};
  const agora = [];
  if (ativ.lider) agora.push({ quem: nomeLider(c.repo), ...ativ.lider });
  for (const [id, w] of Object.entries(ativ.workers || {})) {
    const ag = (c.agents || []).find((a) => a.id === id);
    agora.push({ quem: ag && ag.skill ? nomeDoWorker(dados.tema, ag.skill) : 'agente', ...w });
  }
  for (const a of agora) {
    const chave = `${a.quem}|${a.tipo}|${a.alvo}`;
    if (a.tipo && !r.itens.some((x) => x.chave === chave)) r.itens.push({ ...a, chave });
  }
  r.itens = r.itens.slice(-5);
  return r;
}
const duracao = (ms) => { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}s`; };
const horaSeg = (iso) => { try { return new Date(iso).toLocaleTimeString('pt-BR'); } catch { return ''; } };
function encaixarVivo(c) {
  const r = anotarRastro(c);
  const box = $('#mensagens');
  if (!r || aba !== 'conversa') { vivo.remove(); return; }
  const noFim = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  // só o que mudou: refazer o balão inteiro reiniciaria a animação a cada atualização
  vivo.querySelector('.vivo-cab b').textContent = nomeLider(c.repo);
  vivo.querySelector('.vivo-cab small').textContent = `· ${duracao(Date.now() - r.desde)}`;
  const log = vivo.querySelector('.vivo-log');
  const chave = JSON.stringify(r.itens.map((x) => x.chave));
  if (log.dataset.chave !== chave) {
    log.dataset.chave = chave;
    log.innerHTML = r.itens.length ? r.itens.map((x) => `<div><span>${esc(horaSeg(x.ts))}</span> ${esc(x.quem)} · ${esc(x.tipo)}${x.alvo ? ` <code>${esc(x.alvo)}</code>` : ''}</div>`).join('') : '<div>pensando…</div>';
  }
  const primeiraNaFila = box.querySelector('.na-fila'); // o balão de quem trabalha fica antes da fila
  if (primeiraNaFila) { if (vivo.nextElementSibling !== primeiraNaFila) box.insertBefore(vivo, primeiraNaFila); }
  else if (box.lastElementChild !== vivo) box.appendChild(vivo);
  if (noFim) box.scrollTop = box.scrollHeight;
}
function definirTelaCheia(on) {
  if (on && convCheia) definirConvCheia(false);
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
  if ((aba === 'terminal' || telaCheia) && selecionado) { terminal.conectar(selecionado); terminal.irParaOFim(); } // sempre na última atualização
  else terminal.desconectar();
  const c = contextoSel();
  if (c && aba === 'decisoes') { $('#decisoes').dataset.chave = ''; renderizarDecisoes(c); }
  encaixarPergunta(c);
  encaixarVivo(c);
  if (aba === 'conversa') irParaFimDaConversa(); // voltar para a Conversa: na última mensagem
}
/** Rola a Conversa até a última mensagem (agora e depois do próximo desenho, quando ela acabou de aparecer). */
function irParaFimDaConversa() {
  const box = $('#mensagens');
  box.scrollTop = box.scrollHeight;
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}
$('#decisoes').addEventListener('click', (e) => { const b = e.target.closest('[data-ir]'); if (b) mostrarAba(b.dataset.ir); });
document.querySelector('.abas-det').addEventListener('click', (e) => {
  const b = e.target.closest('[data-aba]');
  if (!b) return;
  if (telaCheia && b.dataset.aba === 'terminal') { terminal.sairDaTelaCheia(); definirTelaCheia(false); }
  if (b.dataset.aba === 'terminal') terminal.verTodos(); // a aba mostra a sessão inteira; o clique no agente isola
  mostrarAba(b.dataset.aba);
});
mostrarAba(aba);
if (new URLSearchParams(location.search).get('cheia') === '1') { $('#terminal').classList.add('cheia'); setTimeout(() => definirTelaCheia(true), 0); }

/* ------------------------------------------- caixa de atenção, tela cheia, largura da lateral */

// Caixa de atenção: sem conversa aberta, fica na lateral (como sempre); com conversa aberta, sai da
// lateral e abre pelo botão do topo, numa lista suspensa. O mesmo elemento muda de lugar.
function posicionarCaixa() {
  const caixa = $('#caixa');
  const pop = $('#caixa-pop');
  const naLateral = !caixaAberta && !contextoSel();
  if (naLateral && caixa.parentElement !== $('#lateral')) $('#lateral').insertBefore(caixa, $('#detalhe'));
  if (!naLateral && caixa.parentElement !== pop) pop.appendChild(caixa);
  pop.hidden = !caixaAberta;
  $('#btn-atencao').setAttribute('aria-expanded', String(caixaAberta));
  $('#btn-atencao').classList.toggle('aberta', caixaAberta);
}
function abrirCaixa(on) {
  caixaAberta = on;
  posicionarCaixa();
  if (!on) return;
  const r = $('#btn-atencao').getBoundingClientRect();
  const pop = $('#caixa-pop');
  pop.style.top = `${Math.round(r.bottom + 6)}px`;
  pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)))}px`;
}
$('#btn-atencao').addEventListener('click', (e) => { e.stopPropagation(); abrirCaixa(!caixaAberta); });
document.addEventListener('click', (e) => {
  if (caixaAberta && !e.target.closest('#caixa-pop') && !e.target.closest('#btn-atencao')) abrirCaixa(false);
});

// Conversa em tela cheia: a lateral cobre a área principal, com a caixa de texto embaixo.
function definirConvCheia(on) {
  if (on === convCheia) return;
  if (on && telaCheia) { terminal.sairDaTelaCheia(); definirTelaCheia(false); }
  convCheia = on;
  document.documentElement.style.setProperty('--topo-h', `${$('#topo').offsetHeight}px`);
  document.body.classList.toggle('conv-cheia', on);
  $('#conv-cheia').textContent = on ? '⤡' : '⤢';
  $('#conv-cheia').title = on ? 'Sair da tela cheia (Esc)' : 'Conversa em tela cheia (Esc volta)';
  const box = $('#mensagens');
  box.scrollTop = box.scrollHeight;
  if (on) $('#resposta').focus({ preventScroll: true });
}
$('#conv-cheia').addEventListener('click', () => definirConvCheia(!convCheia));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !$('#modal').hidden || document.querySelector('.dlg-fundo')) return;
  if (caixaAberta) { abrirCaixa(false); return; }
  if (convCheia) definirConvCheia(false);
});

// Largura da lateral: arrastar a alça na borda esquerda; dois cliques voltam ao padrão. O Office lembra.
const LATERAL_PADRAO = 420;
let lateralPreferida = guardado.ler('orq.lateral.largura', LATERAL_PADRAO);
function aplicarLargura(px) {
  const max = Math.max(LATERAL_PADRAO, Math.min(window.innerWidth - 360, 1400));
  const w = Math.round(Math.min(Math.max(Number(px) || LATERAL_PADRAO, 340), max));
  document.documentElement.style.setProperty('--lateral-w', `${w}px`);
  return w;
}
aplicarLargura(lateralPreferida);
window.addEventListener('resize', () => aplicarLargura(lateralPreferida));
const alca = $('#lateral-alca');
alca.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  alca.setPointerCapture(e.pointerId);
  document.body.classList.add('arrastando');
  const mover = (ev) => { lateralPreferida = aplicarLargura(window.innerWidth - ev.clientX); };
  const soltar = () => {
    alca.removeEventListener('pointermove', mover); alca.removeEventListener('pointerup', soltar); alca.removeEventListener('pointercancel', soltar);
    document.body.classList.remove('arrastando');
    guardado.gravar('orq.lateral.largura', lateralPreferida);
  };
  alca.addEventListener('pointermove', mover); alca.addEventListener('pointerup', soltar); alca.addEventListener('pointercancel', soltar);
});
alca.addEventListener('dblclick', () => { lateralPreferida = aplicarLargura(LATERAL_PADRAO); guardado.gravar('orq.lateral.largura', LATERAL_PADRAO); });

document.querySelector('.conv-acoes').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-acao]');
  const c = contextoSel();
  if (!b || !c) return;
  const acao = b.dataset.acao;
  try {
    if (acao === 'atlas') { location.hash = `#/fluxos?ctx=${encodeURIComponent(c.id)}`; return; }
    if (acao === 'terminal') return abrirTerminal(c);
    if (acao === 'parar' && !(await confirmar({ titulo: `Parar ${rotuloContexto(c)}?`, texto: 'O turno atual é interrompido e o contexto fica parado. Dá para retomar a sessão depois pelo terminal (claude --resume).', ok: 'Parar', perigo: true }))) return;
    const r = await api(`/${acao}`, { contextoId: c.id });
    toast(acao === 'retomar' ? (r && r.acordou ? 'Acordados: a líder e os agentes continuam de onde estavam.' : 'Retomando…')
      : acao === 'pausar' ? 'Pausado: a líder e os agentes estão dormindo. Retomar continua do mesmo ponto.'
        : acao === 'parar' ? 'Contexto parado.' : acao === 'reativar' ? 'Contexto reativado: escreva o que quer continuar.' : 'Contexto dispensado.');
    if (acao === 'reativar') setTimeout(() => $('#resposta').focus(), 50);
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
    <div class="campo" id="m-campo-repo"><label for="m-repo">Repositório (em repos/)</label>
      <select id="m-repo">${catalogo.repos.map((r) => `<option value="${esc(r)}"${ocupados.has(r) ? ' disabled' : ''}>${esc(r)}${ocupados.has(r) ? ' (ocupado)' : ''}</option>`).join('') || '<option value="">nenhum repo em repos/</option>'}</select></div>
    <div class="campo" id="m-campo-card" hidden><label for="m-card">Chave do ticket (card ou épico)</label>
      <input id="m-card" type="text" placeholder="ex.: PROJ-123" autocomplete="off" style="background:#0e1019;border:1px solid var(--borda);border-radius:8px;padding:8px 10px"></div>
    <div class="campo"><label for="m-nota">Nota para o agente (opcional)</label><textarea id="m-nota" rows="3" maxlength="2000" placeholder="Contexto extra, cuidado especial, ticket…"></textarea></div>
    <div class="linha-acoes"><button type="button" class="btn" id="m-cancelar">Cancelar</button><button type="button" class="btn primario" id="m-convocar"${lotado ? ' disabled' : ''}>Convocar</button></div>`);
  const ajustarAlvo = () => {
    const sel = corpo.querySelector('.fluxo.sel');
    const f = sel && catalogo.fluxos.find((x) => x.id === sel.dataset.fluxo);
    const jira = !!(f && f.alvo === 'jira');
    corpo.querySelector('#m-campo-repo').hidden = jira;
    corpo.querySelector('#m-campo-card').hidden = !jira;
  };
  corpo.querySelector('.fluxos').addEventListener('click', (e) => {
    const b = e.target.closest('.fluxo'); if (!b) return;
    corpo.querySelectorAll('.fluxo').forEach((x) => x.classList.toggle('sel', x === b));
    ajustarAlvo();
  });
  ajustarAlvo();
  corpo.querySelector('#m-cancelar').addEventListener('click', fecharModal);
  corpo.querySelector('#m-convocar').addEventListener('click', async () => {
    const fluxoId = corpo.querySelector('.fluxo.sel') && corpo.querySelector('.fluxo.sel').dataset.fluxo;
    const repo = corpo.querySelector('#m-campo-card').hidden ? corpo.querySelector('#m-repo').value : corpo.querySelector('#m-card').value.trim().toUpperCase();
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
const chats = criarChats($('#pagina-chats'), {
  api, toast, esc, hora, ha, guardado, refrescar: () => atualizarJa(),
});
$('#btn-chat').addEventListener('click', () => { location.hash = '#/chats?novo=1'; chats.abrir('novo'); });

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
    box.title = 'Os limites chegam a cada chamada das missões do Office e pela statusline do Claude Code (ponte statusline-ponte.js). Sem missão rodando, abra uma sessão do Claude Code para atualizar.';
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
  box.title = `Sessão de 5 h: ${pc ?? '–'}% (renova ${c.renova ? new Date(c.renova).toLocaleString('pt-BR') : '–'}) · semana: ${pw ?? '–'}% (renova ${w.renova ? new Date(w.renova).toLocaleString('pt-BR') : '–'}) · atualizado ${new Date(l.atualizadoEm).toLocaleTimeString('pt-BR')}${l.fonte === 'missao' ? ' pela missão' : l.fonte === 'statusline' ? ' pela statusline' : ''}`;
}

function rota() {
  const [nome, q] = location.hash.replace(/^#\/?/, '').split('?');
  const alvo = nome === 'atlas' ? 'fluxos' : nome;
  visao = ['painel', 'fluxos', 'aprendizado', 'biblioteca', 'chats'].includes(alvo) ? alvo : 'escritorio';
  document.body.dataset.visao = visao;
  definirConvCheia(false);
  abrirCaixa(false);
  document.querySelectorAll('[data-visao]').forEach((a) => a.classList.toggle('ativa', a.dataset.visao === visao));
  $('#palco').hidden = visao !== 'escritorio';
  $('#pagina-painel').hidden = visao !== 'painel';
  $('#pagina-fluxos').hidden = visao !== 'fluxos';
  $('#pagina-aprendizado').hidden = visao !== 'aprendizado';
  $('#pagina-biblioteca').hidden = visao !== 'biblioteca';
  $('#pagina-chats').hidden = visao !== 'chats';
  if (visao === 'escritorio' && q) {
    // link direto: #/escritorio?andar=1 ou #/escritorio?vista=geral
    const u = new URLSearchParams(q);
    if (u.get('vista') === 'geral') escritorio.visaoGeral();
    else if (u.get('andar') != null) escritorio.irParaAndar(Number(u.get('andar')) || 0);
  }
  if (visao !== 'chats') chats.esconder(); // fecha o streaming do terminal do chat fora da tela
  if (visao === 'chats') {
    const u = new URLSearchParams(q || '');
    if (u.get('novo')) chats.abrir('novo'); else if (u.get('id')) chats.abrir(u.get('id'));
  }
  if (visao === 'fluxos') {
    const u = new URLSearchParams(q || '');
    fluxos.focar(u.get('ctx'));
    if (u.get('passo')) fluxos.abrirPasso(u.get('passo'), u.get('ctx')); // link direto: #/fluxos?ctx=catalogo&passo=<fluxo>:<etapa>
  }
  if (visao === 'aprendizado') aprendizado.mostrar(); else aprendizado.esconder();
  if (visao === 'biblioteca') biblioteca.mostrar();
  if (dados) renderizar();
}
window.addEventListener('hashchange', rota);

const ROT_AGENTE = { WORKING: 'trabalhando', WAITING_APPROVAL: 'aguardando', DONE: 'concluído', ERROR: 'erro', DORMINDO: 'dormindo' };

function cardAgente(c, a) {
  const at = c.atividade && c.atividade.workers && c.atividade.workers[a.id];
  const anim = at ? animPorAtividade(at.tipo) : null;
  return `<div class="ag st-ag-${a.status}" style="--nivel:${a.nivel || 0}" data-ctx="${esc(c.id)}" data-ag="${esc(a.id)}" title="clique para ver este agente no terminal">
    <canvas width="16" height="24" data-av="worker" data-semente="${esc(a.skill)}"></canvas>
    <div class="ag-info">
      <div class="ag-l1"><b>${esc(nomeDoWorker(dados.tema, a.skill))}</b><span class="chip ag-st">${ROT_AGENTE[a.status === 'WORKING' && ['PAUSADO', 'PAUSADO_LIMITE'].includes(c.status) ? 'DORMINDO' : a.status] || a.status}</span></div>
      <div class="ag-l2">${esc(a.role)} · <code>${esc(a.skill)}</code></div>
      <div class="ag-l3">${anim ? `${anim.icone} ${esc(at.tipo)}${at.alvo ? ` · ${esc(at.alvo)}` : ''}` : esc(a.summary || '')}</div>
    </div>
    <div class="tempo">${ha(a.inicio)}</div>
  </div>`;
}

function renderizarPainel(state) {
  const box = $('#pagina-painel');
  const lista = state.contextos.filter((c) => c.fluxoId !== 'chat').sort((a, b) => (ORDEM[a.status] - ORDEM[b.status]) || a.criadoEm.localeCompare(b.criadoEm));
  const chatsAbertos = state.contextos.filter((c) => c.fluxoId === 'chat' && !['PARADO', 'CONCLUIDO'].includes(c.status)).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  const ROT_CHAT = { TRABALHANDO: 'respondendo…', PRECISA_DE_VOCE: 'sua vez', ERRO: 'erro', PAUSADO: 'pausado', PAUSADO_LIMITE: 'pausado (limite)' };
  const secaoChats = chatsAbertos.length ? `<h3 class="painel-secao">💬 Chats <span class="chip">${chatsAbertos.length}</span></h3><div class="grupos chats-grupos">${chatsAbertos.map((c) => {
    const lid = c.atividade && c.atividade.lider;
    const animL = lid ? animPorAtividade(lid.tipo) : null;
    return `<section class="grupo chat-grupo" data-chat="${esc(c.id)}">
      <header class="grupo-topo">
        <canvas width="16" height="24" data-av="lider" data-semente="${esc(c.repo)}"></canvas>
        <div><div class="l1"><b>${esc(c.titulo || c.repo.replace(/^chat-/, ''))}</b> <span class="chip st-${c.status}">${ROT_CHAT[c.status] || c.status}</span></div>
          <small>${esc(nomeLider(c.repo))} · chat livre · ${c.metricas.turnos} turno(s) · US$ ${c.metricas.custoUsd.toFixed(2)}</small></div>
      </header>
      <div class="chat-ultima">${c.status === 'TRABALHANDO' && animL ? `${animL.icone} ${esc(lid.tipo)}${lid.alvo ? ` · ${esc(lid.alvo)}` : ''}` : esc((c.ultimaMensagem || '').slice(0, 140))}</div>
    </section>`;
  }).join('')}</div>` : '';
  if (!lista.length && !chatsAbertos.length) { box.innerHTML = '<p class="vazio-painel">Nenhum grupo de trabalho. Convoque uma missão.</p>'; return; }
  const rolagem = box.scrollTop;
  box.innerHTML = (lista.length ? '' : '<p class="vazio-painel">Nenhuma missão em andamento.</p>') + `<div class="grupos">${lista.map((c) => {
    const grupos = gruposDoContexto(c);
    const concluidos = c.agents.filter((a) => a.status === 'DONE' || a.status === 'ERROR');
    const lid = c.atividade && c.atividade.lider;
    const animL = lid ? animPorAtividade(lid.tipo) : null;
    const passo = c.passoAtual && (c.atlas.nodes.find((n) => n.id === c.passoAtual) || {}).label;
    return `<section class="grupo${c.id === selecionado ? ' sel' : ''}${c.status === 'PRECISA_DE_VOCE' ? ' atencao' : ''}" data-ctx="${esc(c.id)}">
      <header class="grupo-topo">
        <canvas width="16" height="24" data-av="lider" data-semente="${esc(c.repo)}"></canvas>
        <div><div class="l1"><b>${htmlContexto(c)}</b> <span class="chip st-${c.status}">${ROTULO[c.status] || c.status}</span></div>
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
  }).join('')}</div>${secaoChats}`;
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
  const ch = e.target.closest('[data-chat]');
  if (ch) { abrirChat(ch.dataset.chat); return; }
  const r = e.target.closest('[data-responder]');
  if (r) { selecionar(r.dataset.responder); setTimeout(() => $('#resposta').focus(), 50); return; }
  if (e.target.closest('details')) return;
  const ag = e.target.closest('[data-ag]');
  if (ag) { selecionar(ag.dataset.ctx); focarAgente(ag.dataset.ag); return; }
  // a líder ou qualquer lugar do cartão do grupo: abre a missão no terminal completo (como a baia no escritório)
  const g = e.target.closest('[data-ctx]');
  if (g) { selecionar(g.dataset.ctx); terminalCompleto(); }
});

rota();
ciclo();
