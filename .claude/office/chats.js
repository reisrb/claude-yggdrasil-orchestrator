// chats.js — Chats livres com o orquestrador: uma aba por conversa, renomear, salvar e fechar,
// reabrir os salvos, excluir e exportar em Markdown. Cada chat é um contexto do fluxo virtual
// "chat" (sem fluxo nem repositório): a mesma sessão do Claude é retomada a cada mensagem.

import { confirmar } from './dialogo.js';
import { criarTerminal } from './terminal.js';
import { md } from './markdown.js';

const CHAT = 'chat';

export function criarChats(raiz, { api, toast, esc, hora, ha, guardado, refrescar }) {
  raiz.innerHTML = `
    <div class="ch-barra">
      <div class="ch-abas" role="tablist" aria-label="Chats abertos"></div>
      <button type="button" class="btn mini ch-bt-salvos" data-ch="salvos" title="Chats salvos">🗂 Salvos <span class="ch-n"></span></button>
    </div>
    <div class="ch-area">
      <section class="ch-conversa">
        <header class="ch-topo">
          <div class="ch-titulo"></div>
          <div class="ch-acoes">
            <button type="button" class="btn mini" data-ch="renomear" title="Renomear (ou dois cliques na aba)">✎ Renomear</button>
            <button type="button" class="btn mini" data-ch="exportar" title="Baixar a conversa em Markdown">⇩ Exportar .md</button>
            <button type="button" class="btn mini" data-ch="terminal" title="Alterna entre a conversa e o terminal deste chat (ferramentas, comandos e saídas)">Terminal</button>
            <button type="button" class="btn mini" data-ch="salvar" title="Fecha a aba e guarda em Salvos">Salvar e fechar</button>
            <button type="button" class="btn mini perigo" data-ch="excluir" title="Tira o chat da lista">Excluir</button>
          </div>
        </header>
        <div class="ch-msgs" aria-live="polite"></div>
        <div class="ch-term" hidden></div>
        <form class="ch-composer">
          <textarea rows="3" maxlength="8000" placeholder="Escreva…"></textarea>
          <div class="ch-pe"><small class="ch-dica">Ctrl+Enter envia</small>
            <span class="composer-botoes">
              <button class="btn" type="button" data-corrigir hidden title="Interrompe a resposta atual e manda o seu texto no lugar (como o Esc no terminal). Sem texto, só interrompe e espera você escrever.">Corrigir</button>
              <button class="btn primario" type="submit">Enviar</button>
            </span></div>
        </form>
      </section>
      <aside class="ch-salvos" hidden>
        <h3>Chats salvos</h3>
        <ul></ul>
      </aside>
    </div>`;

  const abas = raiz.querySelector('.ch-abas');
  const msgsBox = raiz.querySelector('.ch-msgs');
  const tituloBox = raiz.querySelector('.ch-titulo');
  const acoes = raiz.querySelector('.ch-acoes');
  const form = raiz.querySelector('.ch-composer');
  const area = form.querySelector('textarea');
  const enviarBt = form.querySelector('button[type=submit]');
  const corrigirBt = form.querySelector('[data-corrigir]');
  const salvosBox = raiz.querySelector('.ch-salvos');
  const termBox = raiz.querySelector('.ch-term');
  const term = criarTerminal(termBox, {});
  let modoTerm = guardado.ler('orq.chat.terminal', false); // mostra o terminal no lugar da conversa
  let iniciado = false;

  let dados = null;
  let ativo = guardado.ler('orq.chat.ativo', null); // id do chat na tela, ou 'novo'
  let assinatura = '';
  let assinaturaAbas = '';
  let enviando = false;
  let editando = false;
  const rascunhos = new Map(); // texto não enviado por aba
  const recemCriados = new Set(); // chats criados que o /state ainda não trouxe (não podem sumir da tela)

  const nomeOrq = () => (dados && dados.config && dados.config.nome) || 'orquestrador';
  const chats = () => (dados ? dados.state.contextos.filter((c) => c.fluxoId === CHAT) : []);
  const abertos = () => chats().filter((c) => !['PARADO', 'CONCLUIDO'].includes(c.status)).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  const salvos = () => chats().filter((c) => ['PARADO', 'CONCLUIDO'].includes(c.status)).sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm));
  const doId = (id) => chats().find((c) => c.id === id) || null;
  const existe = (id) => !!doId(id) || recemCriados.has(id);
  const nomeDe = (c) => c.titulo || c.repo.replace(/^chat-/, '').replace(/-\d{6}$/, '').replace(/-/g, ' ') || 'chat';

  /** Conversa × terminal do chat ativo: o terminal lê o transcript real da sessão. */
  function aplicarModo() {
    const id = ativo && ativo !== 'novo' && existe(ativo) ? ativo : null;
    const mostrar = modoTerm && !!id;
    msgsBox.hidden = mostrar;
    termBox.hidden = !mostrar;
    const bt = acoes.querySelector('[data-ch="terminal"]');
    bt.textContent = modoTerm ? '💬 Conversa' : '⌨ Terminal';
    bt.classList.toggle('ativo', modoTerm);
    if (mostrar) term.conectar(id); else term.desconectar();
  }

  /** Mantém o endereço apontando para o chat na tela (sem disparar troca de rota). */
  function marcarEndereco() {
    const alvo = ativo && ativo !== 'novo' ? `#/chats?id=${encodeURIComponent(ativo)}` : '#/chats';
    if (location.hash.startsWith('#/chats') && location.hash !== alvo) history.replaceState(null, '', alvo);
  }

  function definirAtivo(id) {
    if (ativo && ativo !== id) rascunhos.set(ativo, area.value);
    ativo = id;
    guardado.gravar('orq.chat.ativo', id);
    marcarEndereco();
    aplicarModo();
    area.value = rascunhos.get(id) || '';
    assinatura = ''; assinaturaAbas = '';
    desenhar();
    carregarMensagens();
    setTimeout(() => area.focus(), 0);
  }

  /* -------------------------------------------------------------- desenho */
  function ponto(c) {
    if (c.status === 'TRABALHANDO') return `<span class="ch-dot pensando" title="${esc(nomeOrq())} está respondendo"></span>`;
    if (c.status === 'ERRO') return '<span class="ch-dot erro" title="erro no turno"></span>';
    if (c.status === 'PAUSADO_LIMITE') return '<span class="ch-dot pausa" title="pausado pelo limite de uso"></span>';
    if (c.status === 'PRECISA_DE_VOCE' && !(c.pergunta && c.pergunta.silencioso) && c.id !== ativo) return '<span class="ch-dot vez" title="respondeu"></span>';
    return '';
  }

  function desenharAbas() {
    const lista = abertos();
    const extra = ativo && ativo !== 'novo' && !lista.some((c) => c.id === ativo) ? doId(ativo) : null; // salvo em leitura
    const criando = ativo && recemCriados.has(ativo) && !doId(ativo);
    const assin = JSON.stringify([ativo, lista.map((c) => [c.id, c.status, c.titulo, c.pergunta && c.pergunta.id]), extra && extra.id, criando]);
    if (assin === assinaturaAbas) return;
    assinaturaAbas = assin;
    abas.innerHTML = [
      ...lista.map((c) => `<button type="button" role="tab" class="ch-aba${c.id === ativo ? ' sel' : ''}" data-id="${esc(c.id)}" aria-selected="${c.id === ativo}" title="${esc(nomeDe(c))} · dois cliques para renomear">
        ${ponto(c)}<span class="ch-nome">${esc(nomeDe(c))}</span><span class="ch-x" data-fechar="${esc(c.id)}" title="Salvar e fechar">×</span></button>`),
      extra ? `<button type="button" role="tab" class="ch-aba sel salvo" data-id="${esc(extra.id)}" title="Chat salvo: escrever reabre"><span class="ch-nome">🗂 ${esc(nomeDe(extra))}</span></button>` : '',
      criando ? '<button type="button" role="tab" class="ch-aba sel"><span class="ch-dot pensando"></span><span class="ch-nome">abrindo…</span></button>' : '',
      !criando && (ativo === 'novo' || (!lista.length && !extra)) ? '<button type="button" role="tab" class="ch-aba sel novo-ch"><span class="ch-nome">Novo chat</span></button>' : '',
      '<button type="button" class="ch-aba mais" data-novo title="Novo chat">＋</button>',
    ].join('');
  }

  function desenharSalvos() {
    const lista = salvos();
    raiz.querySelector('.ch-n').textContent = lista.length ? `(${lista.length})` : '';
    if (salvosBox.hidden) return;
    salvosBox.querySelector('ul').innerHTML = lista.map((c) => `<li class="${c.id === ativo ? 'sel' : ''}" data-ver="${esc(c.id)}">
        <div class="ch-s-nome">${esc(nomeDe(c))}</div>
        <small>${esc(ha(c.atualizadoEm))} · ${c.metricas.turnos} turno(s) · US$ ${c.metricas.custoUsd.toFixed(3)}</small>
        <div class="ch-s-acoes"><button type="button" class="btn mini" data-reabrir="${esc(c.id)}">Reabrir</button>
          <button type="button" class="btn mini perigo" data-excluir="${esc(c.id)}">Excluir</button></div>
      </li>`).join('') || '<li class="vazio">Nenhum chat salvo. O × da aba salva e fecha.</li>';
  }

  function desenharTopo() {
    if (editando) return;
    const c = ativo && ativo !== 'novo' ? doId(ativo) : null;
    acoes.hidden = !c;
    if (!c && ativo && recemCriados.has(ativo)) { tituloBox.innerHTML = `<b>Abrindo o chat…</b> <small>${esc(nomeOrq())} já recebeu sua mensagem</small>`; return; }
    if (!c) { tituloBox.innerHTML = '<b>Novo chat</b> <small>escreva a primeira mensagem; o título sai dela e dá para renomear depois</small>'; return; }
    const estado = { TRABALHANDO: 'respondendo…', PRECISA_DE_VOCE: 'sua vez', PARADO: 'salvo (escrever reabre)', ERRO: 'erro', PAUSADO_LIMITE: 'pausado (limite)' }[c.status] || c.status;
    tituloBox.innerHTML = `<b class="ch-nome-topo" title="dois cliques para renomear">${esc(nomeDe(c))}</b> <span class="chip st-${c.status}">${esc(estado)}</span>
      <small>${c.metricas.turnos} turno(s) · US$ ${c.metricas.custoUsd.toFixed(3)}${c.motivo && c.status === 'ERRO' ? ` · ${esc(c.motivo)}` : ''}</small>`;
    acoes.querySelector('[data-ch="salvar"]').hidden = c.status === 'PARADO';
  }

  function desenhar() {
    if (!dados) return;
    for (const id of recemCriados) if (doId(id)) recemCriados.delete(id); // o servidor já trouxe
    if (ativo && ativo !== 'novo' && !existe(ativo)) ativo = null; // excluído
    if (!ativo) { const a = abertos(); ativo = a.length ? a[a.length - 1].id : 'novo'; marcarEndereco(); }
    desenharAbas();
    desenharSalvos();
    desenharTopo();
    const c = ativo !== 'novo' ? doId(ativo) : null;
    const ocupado = enviando || (c && c.status === 'TRABALHANDO') || (!c && recemCriados.has(ativo));
    enviarBt.disabled = !!ocupado;
    corrigirBt.hidden = !(c && c.status === 'TRABALHANDO');
    corrigirBt.disabled = enviando;
    area.placeholder = !c ? 'Sobre o que você quer conversar? (a primeira mensagem abre o chat)'
      : c.status === 'TRABALHANDO' ? `${nomeOrq()} está respondendo… escreveu algo errado? Escreva a correção e clique em Corrigir`
        : c.status === 'PARADO' ? 'Chat salvo: escrever aqui reabre a conversa'
          : `Escreva para ${nomeOrq()}…`;
    raiz.querySelector('.ch-dica').textContent = `Ctrl+Enter envia · ${nomeOrq()} responde aqui, com as skills e as regras do projeto`;
  }

  async function carregarMensagens() {
    const id = ativo && ativo !== 'novo' ? ativo : null;
    const c = id ? doId(id) : null;
    if (!c && !(id && recemCriados.has(id))) {
      msgsBox.innerHTML = `<div class="ch-vazio"><p><b>Chat livre com ${esc(nomeOrq())}.</b></p><p>Pergunte sobre o projeto, as skills do time ou peça uma análise. Ele roda na pasta do orquestrador, com as mesmas regras e guardas: push, MR e merge continuam com você.</p></div>`;
      assinatura = 'novo';
      return;
    }
    let msgs = [];
    try { msgs = (await api(`/contextos/${encodeURIComponent(id)}/conversa`)).mensagens || []; } catch { return; }
    if (id !== ativo) return; // trocou de aba enquanto carregava
    const status = c ? c.status : 'TRABALHANDO';
    const assin = `${id}|${msgs.length}|${status}`;
    if (assin === assinatura) return;
    assinatura = assin;
    const noFim = msgsBox.scrollHeight - msgsBox.scrollTop - msgsBox.clientHeight < 80;
    msgsBox.innerHTML = msgs.map((m) => {
      const quem = m.quem === 'voce' ? 'Você' : m.quem === 'agente' ? esc(nomeOrq()) : '';
      return `<div class="ch-msg ${esc(m.quem)}">${quem ? `<div class="ch-quem">${quem} <span>${esc(hora(m.ts))}</span></div>` : ''}<div class="ch-texto">${md(m.texto)}</div></div>`;
    }).join('') + (status === 'TRABALHANDO' ? `<div class="ch-msg agente digitando"><div class="ch-quem">${esc(nomeOrq())}</div><div class="ch-texto"><span class="ch-pontos"><i></i><i></i><i></i></span></div></div>` : '');
    if (noFim || enviando) msgsBox.scrollTop = msgsBox.scrollHeight;
  }

  /* -------------------------------------------------------------- ações */
  /** Corrigir: interrompe a resposta em andamento e manda o texto como correção (sem texto, só interrompe). */
  async function corrigir() {
    const id = ativo;
    const c = id && id !== 'novo' ? doId(id) : null;
    if (!c || enviando) return;
    const msg = area.value.trim();
    enviando = true; corrigirBt.disabled = true;
    if (msg) {
      msgsBox.insertAdjacentHTML('beforeend', `<div class="ch-msg voce"><div class="ch-quem">Você <span>corrigindo…</span></div><div class="ch-texto">${md(msg)}</div></div>`);
      msgsBox.scrollTop = msgsBox.scrollHeight;
      area.value = '';
    }
    try {
      await api('/corrigir', { contextoId: id, texto: msg || undefined });
      rascunhos.delete(id);
      toast(msg ? `${nomeOrq()} parou e vai seguir com a sua correção.` : `${nomeOrq()} parou. Escreva a correção e envie.`);
    } catch (e) {
      if (msg) area.value = msg;
      toast(e.message, true);
    } finally {
      enviando = false; assinatura = ''; assinaturaAbas = '';
      desenhar(); carregarMensagens();
      if (refrescar) refrescar();
      if (!msg) area.focus();
    }
  }
  corrigirBt.addEventListener('click', corrigir);

  async function enviar() {
    const msg = area.value.trim();
    if (!msg || enviando) return;
    enviando = true; enviarBt.disabled = true;
    msgsBox.insertAdjacentHTML('beforeend', `<div class="ch-msg voce"><div class="ch-quem">Você <span>enviando…</span></div><div class="ch-texto">${md(msg)}</div></div>`);
    msgsBox.scrollTop = msgsBox.scrollHeight;
    area.value = '';
    try {
      if (!ativo || ativo === 'novo') {
        const r = await api('/chat', { texto: msg });
        rascunhos.delete('novo');
        recemCriados.add(r.contextoId);
        ativo = r.contextoId; guardado.gravar('orq.chat.ativo', ativo);
        marcarEndereco();
        aplicarModo();
      } else {
        const r = await api('/mensagem', { contextoId: ativo, texto: msg });
        if (r.enfileirada) toast(`${nomeOrq()} ainda está respondendo: sua mensagem vai assim que terminar.`);
      }
      rascunhos.delete(ativo);
    } catch (e) {
      area.value = msg;
      toast(e.message, true);
    } finally {
      enviando = false; assinatura = ''; assinaturaAbas = '';
      desenhar(); carregarMensagens();
      if (refrescar) refrescar(); // pede o estado na hora (o chat novo e o "respondendo…")
    }
  }

  function renomear(id) {
    const c = doId(id);
    if (!c) return;
    editando = true;
    const atual = nomeDe(c);
    tituloBox.innerHTML = `<input class="ch-renomear" type="text" maxlength="60" value="${esc(atual)}" aria-label="Novo título"> <small>Enter salva · Esc cancela</small>`;
    const inp = tituloBox.querySelector('input');
    inp.focus(); inp.select();
    let feito = false;
    const fim = async (salvar) => {
      if (feito) return; feito = true; editando = false;
      const novo = inp.value.trim();
      if (salvar && novo && novo !== atual) {
        try { await api('/chat-renomear', { contextoId: id, titulo: novo }); c.titulo = novo; } catch (e) { toast(e.message, true); }
      }
      assinaturaAbas = ''; desenhar();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fim(true); } if (e.key === 'Escape') fim(false); });
    inp.addEventListener('blur', () => fim(true));
  }

  async function exportar(id) {
    const c = doId(id);
    if (!c) return;
    let msgs = [];
    try { msgs = (await api(`/contextos/${encodeURIComponent(c.id)}/conversa`)).mensagens || []; } catch (e) { toast(e.message, true); return; }
    const linhas = [`# ${nomeDe(c)}`, '', `Chat livre com ${nomeOrq()} · aberto em ${new Date(c.criadoEm).toLocaleString('pt-BR')} · ${c.metricas.turnos} turno(s) · US$ ${c.metricas.custoUsd.toFixed(3)}`, `Sessão: \`claude --resume ${c.sessionId}\``, ''];
    for (const m of msgs) {
      if (m.quem === 'sistema') { linhas.push(`> ${m.texto}`, ''); continue; }
      linhas.push(`**${m.quem === 'voce' ? 'Você' : nomeOrq()}** · ${new Date(m.ts).toLocaleString('pt-BR')}`, '', m.texto, '');
    }
    const blob = new Blob([linhas.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chat-${nomeDe(c).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chat'}-${c.criadoEm.slice(0, 10)}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function acao(rota, id, depois) {
    try { await api(rota, { contextoId: id }); if (depois) depois(); } catch (e) { toast(e.message, true); }
    guardado.gravar('orq.chat.ativo', ativo); marcarEndereco();
    assinaturaAbas = ''; assinatura = ''; desenhar(); carregarMensagens();
    if (refrescar) refrescar();
  }

  /* -------------------------------------------------------------- eventos */
  form.addEventListener('submit', (e) => { e.preventDefault(); enviar(); });
  area.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviar(); } });

  abas.addEventListener('click', (e) => {
    const x = e.target.closest('[data-fechar]');
    if (x) { e.stopPropagation(); const id = x.dataset.fechar; return acao('/chat-salvar', id, () => { if (ativo === id) { const a = abertos().filter((c) => c.id !== id); ativo = a.length ? a[a.length - 1].id : 'novo'; } toast('Chat salvo. Está em Salvos.'); }); }
    if (e.target.closest('[data-novo]')) return definirAtivo('novo');
    const aba = e.target.closest('.ch-aba[data-id]');
    if (aba) definirAtivo(aba.dataset.id);
  });
  abas.addEventListener('dblclick', (e) => { const aba = e.target.closest('.ch-aba[data-id]'); if (aba) { if (ativo !== aba.dataset.id) definirAtivo(aba.dataset.id); renomear(aba.dataset.id); } });
  tituloBox.addEventListener('dblclick', (e) => { if (e.target.closest('.ch-nome-topo') && ativo && ativo !== 'novo') renomear(ativo); });

  raiz.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ch]');
    if (b) {
      const qual = b.dataset.ch;
      if (qual === 'salvos') { salvosBox.hidden = !salvosBox.hidden; b.classList.toggle('ativo', !salvosBox.hidden); desenharSalvos(); return; }
      if (!ativo || ativo === 'novo') return;
      if (qual === 'renomear') return renomear(ativo);
      if (qual === 'exportar') return exportar(ativo);
      if (qual === 'terminal') { modoTerm = !modoTerm; guardado.gravar('orq.chat.terminal', modoTerm); aplicarModo(); if (modoTerm) term.irParaOFim(); return; }
      if (qual === 'salvar') return acao('/chat-salvar', ativo, () => { toast('Chat salvo. Está em Salvos.'); const a = abertos().filter((c) => c.id !== ativo); ativo = a.length ? a[a.length - 1].id : 'novo'; });
      if (qual === 'excluir') {
        const c = doId(ativo);
        if (!(await confirmar({ titulo: `Excluir "${c ? nomeDe(c) : 'este chat'}"?`, texto: 'Ele sai das abas e dos salvos. A conversa continua no histórico do Claude Code (claude --resume).', ok: 'Excluir', perigo: true }))) return;
        const id = ativo; return acao('/chat-excluir', id, () => { if (ativo === id) ativo = null; });
      }
    }
    const r = e.target.closest('[data-reabrir]');
    if (r) { const id = r.dataset.reabrir; return acao('/chat-reabrir', id, () => { ativo = id; guardado.gravar('orq.chat.ativo', id); }); }
    const ex = e.target.closest('[data-excluir]');
    if (ex) { const cx = doId(ex.dataset.excluir); if (!(await confirmar({ titulo: `Excluir "${cx ? nomeDe(cx) : 'este chat'}"?`, texto: 'Ele sai dos salvos. A conversa continua no histórico do Claude Code (claude --resume).', ok: 'Excluir', perigo: true }))) return; const id = ex.dataset.excluir; return acao('/chat-excluir', id, () => { if (ativo === id) ativo = null; }); }
    const ver = e.target.closest('[data-ver]');
    if (ver) definirAtivo(ver.dataset.ver);
  });

  return {
    atualizar(d) {
      const antes = ativo; dados = d; desenhar();
      if (!iniciado || ativo !== antes || (modoTerm && termBox.hidden && existe(ativo))) { iniciado = true; aplicarModo(); }
      carregarMensagens();
    },
    esconder() { term.desconectar(); },
    abrir(id) {
      if (!dados) { ativo = id; guardado.gravar('orq.chat.ativo', id); return; } // link direto antes do 1º estado: vale quando ele chegar
      if (id === 'novo' || doId(id)) definirAtivo(id);
    },
    ativoId: () => ativo,
  };
}
