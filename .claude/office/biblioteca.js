// biblioteca.js — Biblioteca de skills (abre pelas estantes do escritório):
// lista as skills do time e do núcleo, mostra maturidade, uso em fluxos e lições,
// e liga/desliga cada uma (a pasta vai para .claude/skills-desativadas/).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COR_MAT = { inexplorada: '#8b93a7', aprendendo: '#4bb7e5', madura: '#2ecc71' };
const GRUPOS = [['time', 'Skills do time'], ['nucleo', 'Skills do núcleo (orquestrador)'], ['outra', 'Outras skills deste projeto']];

export function criarBiblioteca(raiz, { api, toast } = {}) {
  raiz.innerHTML = `
    <div class="bib-barra">
      <div><h2 class="bib-titulo">Biblioteca de skills</h2><small>ative ou desative skills deste orquestrador; desativada = o Claude não carrega</small></div>
      <input class="bib-busca" type="search" placeholder="buscar skill…" autocomplete="off">
    </div>
    <div class="bib-corpo"></div>`;
  const corpo = raiz.querySelector('.bib-corpo');
  const busca = raiz.querySelector('.bib-busca');
  let dados = null, aprend = null, ocupado = false;

  async function carregarAprendizado() {
    try { aprend = await (await fetch('/aprendizado', { cache: 'no-store' })).json(); } catch { aprend = null; }
    desenhar();
  }

  function desenhar() {
    if (!dados) return;
    const termo = busca.value.trim().toLowerCase();
    const fluxosDe = (nome) => dados.catalogo.fluxos.filter((f) => f.passos.some((p) => p.skill === nome)).map((f) => f.nome);
    const infoAp = (nome) => (aprend && aprend.skills.find((s) => s.nome === nome)) || null;
    const lista = dados.catalogo.skills.filter((s) => !termo || s.nome.toLowerCase().includes(termo) || (s.descricao || '').toLowerCase().includes(termo));
    corpo.innerHTML = GRUPOS.map(([origem, titulo]) => {
      const itens = lista.filter((s) => s.origem === origem).sort((a, b) => (b.ativa - a.ativa) || a.nome.localeCompare(b.nome));
      if (!itens.length) return origem === 'time' ? `<section><h3>${titulo}</h3><p class="bib-vazio">Nenhuma skill do time registrada. Instale o plugin ou a skill e registre em <code>time/skills-origem.json</code>.</p></section>` : '';
      return `<section><h3>${titulo} <span class="chip">${itens.filter((s) => s.ativa).length}/${itens.length} ativas</span></h3><div class="bib-grade">${itens.map((s) => {
        const ap = infoAp(s.nome);
        const fl = fluxosDe(s.nome);
        const aviso = !s.ativa && fl.length ? `<div class="bib-aviso">⚠ usada em: ${esc(fl.join(', '))}. Missões desses fluxos vão travar neste passo.</div>` : '';
        return `<article class="bib-card${s.ativa ? '' : ' off'}">
          <header><code>${esc(s.nome)}</code>
            ${s.externa ? `<span class="chip" title="${esc(s.fonte)} · liga e desliga pelo Claude Code (/plugin) ou pela instalação, não por aqui">${s.ativa ? esc(s.instalacao.split(',')[0].split(' (')[0]) : 'não instalada'}</span>` : `<label class="bib-chave" title="${s.essencial ? 'essencial: não pode ser desativada' : (s.ativa ? 'desativar' : 'ativar')}">
              <input type="checkbox" data-skill="${esc(s.pasta || s.nome)}" ${s.ativa ? 'checked' : ''} ${s.essencial ? 'disabled' : ''}><span></span>
            </label>`}</header>
          <p>${esc((s.descricao || 'sem descrição').slice(0, 260))}</p>
          <div class="bib-meta">
            ${ap ? `<span class="chip" style="color:${COR_MAT[ap.maturidade]}">${ap.maturidade}</span><span>${ap.execucoes} execução(ões)</span><span>${ap.licoes.length} lição(ões)</span>` : ''}
            ${fl.length ? `<span>fluxos: ${esc(fl.join(', '))}</span>` : '<span>fora de fluxo</span>'}
          </div>
          ${aviso}
          ${s.invocar ? `<small class="bib-caminho">▶ ${esc(s.invocar)}</small>` : ''}
          <small class="bib-caminho">${esc(s.caminho)}</small>
        </article>`;
      }).join('')}</div></section>`;
    }).join('');
  }

  corpo.addEventListener('change', async (e) => {
    const cb = e.target.closest('input[data-skill]');
    if (!cb || ocupado) return;
    ocupado = true;
    const ativa = cb.checked;
    try {
      await api('/skills', { nome: cb.dataset.skill, ativa });
      if (toast) toast(`${cb.dataset.skill} ${ativa ? 'ativada' : 'desativada'}. Vale para as próximas sessões do Claude.`);
      const s = dados.catalogo.skills.find((x) => (x.pasta || x.nome) === cb.dataset.skill);
      if (s) s.ativa = ativa;
      desenhar();
    } catch (err) { cb.checked = !ativa; if (toast) toast(err.message, true); } finally { ocupado = false; }
  });
  busca.addEventListener('input', desenhar);

  return {
    atualizar(d) { const primeira = !dados; dados = d; if (primeira) carregarAprendizado(); else desenhar(); },
    mostrar() { carregarAprendizado(); },
  };
}
