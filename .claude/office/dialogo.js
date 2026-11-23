// dialogo.js — popup centralizado do Office, no lugar do confirm/alert do navegador.
//   const ok = await confirmar({ titulo, texto, ok: 'Excluir', perigo: true });
//   await avisar({ titulo, texto });
// Esc ou clique fora cancela; o foco começa em "Cancelar" quando a ação é perigosa.

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
