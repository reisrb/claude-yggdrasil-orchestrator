// imagens.js — anexar imagem numa caixa de texto do Office: colar (Ctrl+V), arrastar ou escolher pelo botão 🖼.
// A imagem sobe para o servidor (POST /imagem) e vira, no texto, a marca `[imagem: <caminho>]`. Assim todos os
// botões de envio seguem iguais; a conversa mostra a miniatura (markdown.js) e a líder abre o arquivo com o Read.

const TIPOS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX = 8 * 1024 * 1024;
const ESPERA = '[enviando imagem…]';

const lerBase64 = (arq) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('não consegui ler a imagem'));
  r.readAsDataURL(arq);
});

export function ligarImagens(area, { api, toast, botao }) {
  const avisar = () => area.dispatchEvent(new Event('input', { bubbles: true }));
  function inserir(marca) {
    const ini = area.selectionStart ?? area.value.length;
    const fim = area.selectionEnd ?? ini;
    const antes = area.value.slice(0, ini);
    area.setRangeText(`${antes && !antes.endsWith('\n') ? '\n' : ''}${marca}\n`, ini, fim, 'end');
    avisar();
  }
  function trocar(de, para) { area.value = area.value.replace(de, para).replace(/\n{3,}/g, '\n\n'); avisar(); }

  async function anexar(arquivos) {
    for (const f of arquivos) {
      if (!TIPOS.includes(f.type)) { toast(`Só png, jpg, gif ou webp (${f.name || 'arquivo'}).`, true); continue; }
      if (f.size > MAX) { toast('A imagem passa de 8 MB.', true); continue; }
      inserir(ESPERA);
      try {
        const r = await api('/imagem', { tipo: f.type, dados: await lerBase64(f) });
        trocar(ESPERA, `[imagem: ${r.caminho}]`);
      } catch (e) { trocar(ESPERA, ''); toast(e.message, true); }
    }
  }

  area.addEventListener('paste', (e) => {
    const imgs = [...(e.clipboardData ? e.clipboardData.files : [])].filter((f) => f.type.startsWith('image/'));
    if (imgs.length) { e.preventDefault(); anexar(imgs); }
  });
  area.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  area.addEventListener('drop', (e) => {
    const imgs = [...(e.dataTransfer ? e.dataTransfer.files : [])].filter((f) => f.type.startsWith('image/'));
    if (imgs.length) { e.preventDefault(); anexar(imgs); }
  });
  if (botao) {
    const entrada = document.createElement('input');
    entrada.type = 'file'; entrada.accept = TIPOS.join(','); entrada.multiple = true; entrada.hidden = true;
    entrada.addEventListener('change', () => { anexar([...entrada.files]); entrada.value = ''; });
    botao.after(entrada);
    botao.addEventListener('click', () => entrada.click());
  }
}
