// dialogo.js — popup centralizado do Office, no lugar do confirm/alert do navegador.
//   const ok = await confirmar({ titulo, texto, ok: 'Excluir', perigo: true });
//   await avisar({ titulo, texto });
// Esc ou clique fora cancela; o foco começa em "Cancelar" quando a ação é perigosa.
// Teclado, sem mouse: ← → (ou ↑ ↓) andam entre os botões, Enter ou espaço aciona o botão em foco, Tab também circula.

/** Setas entre os botões do popup. Dentro de caixa de texto ou campo, as setas ficam com o campo. */
function setas(e, botoes) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return false;
  const ativo = document.activeElement;
  if (ativo && ativo.matches('textarea, input, select, [contenteditable]')) return false;
  const lista = botoes.filter((b) => !b.disabled);
  if (!lista.length) return false;
  e.preventDefault(); e.stopPropagation();
  const passo = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
  const i = lista.indexOf(ativo);
  lista[i < 0 ? (passo > 0 ? 0 : lista.length - 1) : (i + passo + lista.length) % lista.length].focus();
  return true;
}

function abrir({ titulo, texto, botoes, perigo, foco }) {
  return new Promise((resolve) => {
    const fundo = document.createElement('div');
    fundo.className = 'dlg-fundo';
    fundo.innerHTML = `<div class="dlg${perigo ? ' perigo' : ''}" role="alertdialog" aria-modal="true" aria-labelledby="dlg-titulo" aria-describedby="dlg-texto">
        <div class="dlg-icone" aria-hidden="true">${perigo ? '!' : 'i'}</div>
        <h3 id="dlg-titulo"></h3>
        <p id="dlg-texto"></p>
        <div class="dlg-botoes"></div>
      </div>`;
    fundo.querySelector('#dlg-titulo').textContent = titulo || '';
    const p = fundo.querySelector('#dlg-texto');
    p.textContent = texto || '';
    p.hidden = !texto;
    const caixa = fundo.querySelector('.dlg-botoes');
    for (const b of botoes) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `btn ${b.classe || ''}`.trim();
      el.textContent = b.rotulo;
      el.dataset.valor = String(b.valor);
      caixa.appendChild(el);
    }
    const anterior = document.activeElement;
    const lista = [...caixa.querySelectorAll('button')];
    let fechado = false;
    const fechar = (valor) => {
      if (fechado) return;
      fechado = true;
      document.removeEventListener('keydown', tecla, true);
      fundo.classList.add('saindo');
      setTimeout(() => fundo.remove(), 140);
      if (anterior && typeof anterior.focus === 'function') anterior.focus();
      resolve(valor);
    };
    const tecla = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(false); return; }
      if (setas(e, lista)) return;
      if (e.key === 'Tab') { // o foco fica dentro do popup
        e.preventDefault();
        const i = lista.indexOf(document.activeElement);
        lista[(i + (e.shiftKey ? -1 : 1) + lista.length) % lista.length].focus();
      }
    };
    fundo.addEventListener('click', (e) => {
      if (e.target === fundo) return fechar(false);
      const b = e.target.closest('[data-valor]');
      if (b) fechar(b.dataset.valor === 'true');
    });
    document.addEventListener('keydown', tecla, true);
    document.body.appendChild(fundo);
    requestAnimationFrame(() => (lista[foco] || lista[lista.length - 1]).focus());
  });
}

/** Pergunta sim/não. Resolve true só se a pessoa confirmar. */
export function confirmar({ titulo = 'Confirmar?', texto = '', ok = 'Confirmar', cancelar = 'Cancelar', perigo = false } = {}) {
  return abrir({
    titulo, texto, perigo,
    botoes: [{ rotulo: cancelar, valor: false }, { rotulo: ok, valor: true, classe: perigo ? 'perigo-cheio' : 'primario' }],
    foco: perigo ? 0 : 1,
  });
}

/** Aviso com um botão só. */
export function avisar({ titulo = 'Aviso', texto = '', ok = 'Entendi' } = {}) {
  return abrir({ titulo, texto, perigo: false, botoes: [{ rotulo: ok, valor: true, classe: 'primario' }], foco: 0 });
}

/**
 * Popup com corpo em HTML (o chamador escapa o que vier de fora), rolagem e botões com valor próprio.
 * Resolve com o valor do botão clicado, ou null no Esc / clique fora.
 *   const v = await dialogo({ titulo, html, largo: true, botoes: [{ rotulo: 'Aprovar', valor: 'ok', classe: 'primario' }] });
 * Com `campo` ({ rotulo, placeholder }), mostra uma caixa de texto e resolve com { valor, texto }.
 */
export function dialogo({ titulo = '', icone = 'i', html = '', botoes = [], largo = false, foco, campo = null, coletarCampos = false } = {}) {
  return new Promise((resolve) => {
    const fundo = document.createElement('div');
    fundo.className = 'dlg-fundo';
    fundo.innerHTML = `<div class="dlg rico${largo ? ' largo' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlg-titulo">
        <div class="dlg-cabeca"><span class="dlg-icone" aria-hidden="true"></span><h3 id="dlg-titulo"></h3></div>
        <div class="dlg-corpo">${html}</div>
        ${campo ? '<label class="dlg-campo"><span></span><textarea rows="3" maxlength="4000"></textarea></label>' : ''}
        <div class="dlg-botoes"></div>
      </div>`;
    fundo.querySelector('#dlg-titulo').textContent = titulo;
    fundo.querySelector('.dlg-icone').textContent = icone;
    const area = fundo.querySelector('.dlg-campo textarea');
    if (campo) { fundo.querySelector('.dlg-campo span').textContent = campo.rotulo || ''; area.placeholder = campo.placeholder || ''; area.value = campo.valor || ''; }
    const caixa = fundo.querySelector('.dlg-botoes');
    for (const b of botoes) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `btn ${b.classe || ''}`.trim();
      el.textContent = b.rotulo;
      el.dataset.valor = String(b.valor);
      if (b.precisaTexto) el.dataset.precisaTexto = '1';
      caixa.appendChild(el);
    }
    const anterior = document.activeElement;
    const focaveis = () => [...fundo.querySelectorAll('button, textarea, input, a[href]')].filter((x) => !x.disabled);
    const coletar = () => { const o = {}; for (const el of fundo.querySelectorAll('[name]')) { if (el.type === 'radio' || el.type === 'checkbox') { if (el.checked) o[el.name] = el.value; } else o[el.name] = String(el.value || '').trim(); } return o; };
    let fechado = false;
    const fechar = (valor) => {
      if (fechado) return;
      fechado = true;
      document.removeEventListener('keydown', tecla, true);
      fundo.classList.add('saindo');
      setTimeout(() => fundo.remove(), 140);
      if (anterior && typeof anterior.focus === 'function') anterior.focus();
      resolve(valor !== null && (campo || coletarCampos) ? { valor, texto: area ? area.value.trim() : '', campos: coletar() } : valor);
    };
    const tecla = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(null); return; }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && area) { e.preventDefault(); const p = caixa.querySelector('[data-precisa-texto]'); if (p && area.value.trim()) fechar(p.dataset.valor); return; }
      if (setas(e, [...caixa.querySelectorAll('button')])) return;
      if (e.key === 'Tab') { // o foco fica dentro do popup
        e.preventDefault();
        const lista = focaveis();
        const i = lista.indexOf(document.activeElement);
        lista[(i + (e.shiftKey ? -1 : 1) + lista.length) % lista.length].focus();
      }
    };
    const atualizar = () => { for (const b of caixa.querySelectorAll('[data-precisa-texto]')) b.disabled = !area.value.trim(); };
    if (area) { area.addEventListener('input', atualizar); atualizar(); }
    fundo.addEventListener('click', (e) => {
      if (e.target === fundo) return fechar(null);
      const b = e.target.closest('.dlg-botoes [data-valor]');
      if (b && !b.disabled) fechar(b.dataset.valor);
    });
    document.addEventListener('keydown', tecla, true);
    document.body.appendChild(fundo);
    const lista = [...caixa.querySelectorAll('button')];
    requestAnimationFrame(() => (area || lista[foco ?? lista.length - 1] || lista[0]).focus());
  });
}
