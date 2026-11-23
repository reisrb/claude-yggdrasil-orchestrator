// terminal.js — a sessão vista "como no terminal": mensagens, cada ferramenta como bloco
// (comando + saída, leitura, diff de edição), subagentes aninhados no bloco de quem os lançou.
// Ao vivo por SSE (/contextos/:id/terminal), lendo o transcript real do Claude Code.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const md = (s) => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const hora = (iso) => { try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; } };

export function criarTerminal(raiz, { onTelaCheia } = {}) {
  raiz.classList.add('term');
  raiz.innerHTML = `
    <div class="term-barra">
      <span class="term-meta"></span>
      <label class="term-seguir"><input type="checkbox" checked> seguir</label>
      <button type="button" class="btn mini" data-t="abrir">abrir tudo</button>
      <button type="button" class="btn mini" data-t="fechar">recolher</button>
      <button type="button" class="btn mini" data-t="cheia" title="Tela cheia">⤢</button>
    </div>
    <div class="term-saida" tabindex="0"></div>`;
  const saida = raiz.querySelector('.term-saida');
  const meta = raiz.querySelector('.term-meta');
  const seguir = raiz.querySelector('.term-seguir input');
  let fonte = null, ctxAtual = null, blocos = new Map(), orfaos = new Map(), total = 0;
  let focoPendente = null; // agente pedido antes de o bloco dele chegar pelo SSE

  /** Leva o terminal ao bloco de um agente (id = tool_use_id do Agent): abre, rola até ele e pisca. */
  function focar(id) {
    const b = blocos.get(id);
    if (!b) { focoPendente = id; return false; }
    focoPendente = null;
    seguir.checked = false; // senão a rolagem automática volta para o fim
    b.classList.add('aberto');
    for (let p = b.parentElement; p && p !== saida; p = p.parentElement) if (p.classList && p.classList.contains('t-ferr')) p.classList.add('aberto');
    b.classList.remove('t-destaque'); void b.offsetWidth; b.classList.add('t-destaque');
    b.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return true;
  }

  function limpar() { saida.innerHTML = ''; blocos = new Map(); orfaos = new Map(); total = 0; }

  function containerDe(dentro) {
    if (!dentro) return saida;
    const b = blocos.get(dentro);
    if (b) return b.querySelector(':scope > .t-filhos');
    if (!orfaos.has(dentro)) {
      const g = document.createElement('div');
      g.className = 't-orfao';
      g.innerHTML = '<div class="t-sis">subagente</div><div class="t-filhos"></div>';
      saida.appendChild(g);
      orfaos.set(dentro, g);
    }
    return orfaos.get(dentro).querySelector('.t-filhos');
  }

  function corpoFerramenta(e) {
    let h = '';
    if (e.descricao) h += `<div class="t-desc">${esc(e.descricao)}</div>`;
    if (e.diff) {
      h += e.diff.map((d) => `<pre class="t-diff">${esc(d.antes).split('\n').map((l) => `<span class="menos">- ${l}</span>`).join('\n')}\n${esc(d.depois).split('\n').map((l) => `<span class="mais">+ ${l}</span>`).join('\n')}</pre>`).join('');
    }
    if (e.conteudo) h += `<pre class="t-pre">${esc(e.conteudo)}</pre>`;
    if (e.prompt) h += `<details class="t-prompt"><summary>prompt enviado</summary><pre class="t-pre">${esc(e.prompt)}</pre></details>`;
    return h;
  }

  function adicionar(e) {
    total++;
    const alvo = containerDe(e.dentro);
    if (e.t === 'resultado') {
      const b = blocos.get(e.id);
      if (!b) return;
      const pre = b.querySelector(':scope > .t-corpo > .t-out');
      const assinc = /async agent launched|launched successfully/i.test(e.texto || '');
      pre.textContent = assinc ? '(rodando em segundo plano)' : (e.texto || '(sem saída)');
      pre.hidden = false;
      const ico = b.querySelector(':scope > .t-cab .t-ico');
      ico.textContent = e.erro ? '✗' : assinc ? '↗' : '✓';
      ico.className = `t-ico ${e.erro ? 'erro' : assinc ? 'bg' : 'ok'}`;
      if (e.erro) b.classList.add('aberto');
      return;
    }
    const d = document.createElement('div');
    if (e.t === 'ferramenta') {
      const agente = e.nome === 'Agent' || e.nome === 'Task';
      d.className = `t-ferr${agente ? ' t-agente aberto-filhos' : ''}`;
      d.dataset.id = e.id;
      d.innerHTML = `<div class="t-cab" title="${esc(hora(e.ts))}"><span class="t-ico roda">◌</span><b>${esc(e.nome)}</b><span class="t-tit">${esc(e.titulo || '')}</span></div>
        <div class="t-corpo">${corpoFerramenta(e)}<pre class="t-out" hidden></pre></div>
        ${agente ? '<div class="t-filhos"></div>' : ''}`;
      blocos.set(e.id, d);
      if (focoPendente === e.id) setTimeout(() => focar(e.id), 0);
      const orf = orfaos.get(e.id);
      if (orf) { d.querySelector('.t-filhos').append(...orf.querySelector('.t-filhos').childNodes); orf.remove(); orfaos.delete(e.id); }
    } else if (e.t === 'texto') {
      d.className = 't-texto';
      d.innerHTML = `<span class="t-bola">●</span><div>${md(e.texto)}</div>`;
    } else if (e.t === 'voce') {
      d.className = 't-voce';
      d.innerHTML = `<span>›</span><div>${md(e.texto)}</div>`;
    } else if (e.t === 'tarefa') {
      d.className = 't-tarefa';
      d.innerHTML = `<details><summary>tarefa recebida pelo subagente</summary><pre class="t-pre">${esc(e.texto)}</pre></details>`;
    } else {
      d.className = 't-sis';
      d.textContent = e.texto || '';
    }
    alvo.appendChild(d);
  }

  function rolar() { if (seguir.checked) saida.scrollTop = saida.scrollHeight; }

  saida.addEventListener('click', (ev) => {
    const cab = ev.target.closest('.t-cab');
    if (cab) cab.parentElement.classList.toggle('aberto');
  });
  saida.addEventListener('scroll', () => {
    const noFim = saida.scrollHeight - saida.scrollTop - saida.clientHeight < 40;
    if (!noFim && seguir.checked && document.activeElement === saida) seguir.checked = false;
  });
  raiz.querySelector('.term-barra').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-t]');
    if (!b) return;
    if (b.dataset.t === 'abrir') saida.querySelectorAll('.t-ferr').forEach((x) => x.classList.add('aberto'));
    if (b.dataset.t === 'fechar') saida.querySelectorAll('.t-ferr').forEach((x) => x.classList.remove('aberto'));
    if (b.dataset.t === 'cheia') { raiz.classList.toggle('cheia'); if (onTelaCheia) onTelaCheia(raiz.classList.contains('cheia')); rolar(); }
  });

  function escreverMeta(m, custo) {
    if (!m) return;
    const partes = [];
    partes.push(m.simulado ? 'simulação' : m.origem === 'terminal' ? 'sessão do seu terminal (só leitura)' : m.noTerminal ? 'no terminal agora' : 'sessão do Office');
    if (m.sessionId) partes.push(`sessão ${m.sessionId.slice(0, 8)}`);
    if (custo != null) partes.push(`US$ ${Number(custo).toFixed(3)}`);
    if (!m.existe && !m.simulado) partes.push('transcript ainda não criado');
    meta.textContent = partes.join(' · ');
    meta.dataset.base = JSON.stringify(m);
  }

  return {
    conectar(ctxId) {
      if (ctxAtual === ctxId && fonte) return;
      this.desconectar();
      ctxAtual = ctxId;
      if (!ctxId) return;
      limpar();
      saida.innerHTML = '<div class="t-sis">conectando…</div>';
      if (new URLSearchParams(location.search).get('sse') === '0') {
        // plano B: polling (sem streaming)
        let desde = 0, primeira = true;
        const url = `/contextos/${encodeURIComponent(ctxId)}/terminal`;
        const puxar = async () => {
          try {
            const d = await (await fetch(`${url}?desde=${desde}`, { cache: 'no-store' })).json();
            if (primeira) { limpar(); primeira = false; }
            for (const e of d.entradas) adicionar(e);
            desde = d.total; escreverMeta(d.meta, d.custo);
            if (d.entradas.length) rolar();
          } catch { meta.textContent = 'reconectando…'; }
        };
        puxar();
        const timer = setInterval(puxar, 1500);
        fonte = { close: () => clearInterval(timer) };
        return;
      }
      fonte = new EventSource(`/contextos/${encodeURIComponent(ctxId)}/terminal`);
      fonte.addEventListener('inicio', (ev) => {
        const d = JSON.parse(ev.data);
        limpar();
        if (!d.entradas.length) saida.innerHTML = '<div class="t-sis">nada por aqui ainda: a saída aparece assim que o agente começar.</div>';
        for (const e of d.entradas) adicionar(e);
        escreverMeta(d.meta, d.custo);
        rolar();
      });
      fonte.addEventListener('mais', (ev) => {
        const d = JSON.parse(ev.data);
        if (total === 0 && d.entradas.length) saida.innerHTML = '';
        for (const e of d.entradas) adicionar(e);
        if (d.custo != null && meta.dataset.base) escreverMeta(JSON.parse(meta.dataset.base), d.custo);
        if (d.entradas.length) rolar();
      });
      fonte.onerror = () => { meta.textContent = 'reconectando…'; };
    },
    desconectar() { if (fonte) { fonte.close(); fonte = null; } ctxAtual = null; },
    irParaOFim() { seguir.checked = true; rolar(); },
    focarAgente(id) { return focar(id); },
    sairDaTelaCheia() { raiz.classList.remove('cheia'); },
  };
}
