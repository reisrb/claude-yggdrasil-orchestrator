// markdown.js — texto de agente para HTML seguro, usado na Conversa, no Terminal e nos Chats.
// Títulos, listas (com aninhamento e caixas de seleção), citações, tabelas, separadores, código inline
// e blocos de código com o nome da linguagem, cores e botão de copiar. Rótulos em caixa alta no meio do
// texto ("O QUE FAZ: ... POR QUE AGORA: ...") viram tópicos separados. Sem dependências: o Office roda
// sem internet. Tudo passa por esc() antes de virar HTML.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------ cores do código */

const APELIDOS = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', javascript: 'javascript', node: 'javascript',
  ts: 'javascript', tsx: 'javascript', typescript: 'javascript',
  java: 'java', kt: 'java', kotlin: 'java', groovy: 'java', gradle: 'java', scala: 'java', cs: 'java', csharp: 'java', go: 'java', c: 'java', cpp: 'java',
  json: 'json', jsonl: 'json',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash', powershell: 'bash', ps1: 'bash', bat: 'bash', cmd: 'bash',
  yml: 'yaml', yaml: 'yaml',
  properties: 'properties', ini: 'properties', conf: 'properties', env: 'properties', toml: 'properties', cfg: 'properties',
  xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml', pom: 'xml', xsd: 'xml', wsdl: 'xml', vue: 'xml',
  sql: 'sql', tsql: 'sql', mysql: 'sql', psql: 'sql', plsql: 'sql',
  py: 'python', python: 'python',
  diff: 'diff', patch: 'diff',
  dockerfile: 'dockerfile', docker: 'dockerfile',
  css: 'css', scss: 'css', less: 'css',
  md: 'texto', markdown: 'texto', txt: 'texto', text: 'texto', log: 'texto', csv: 'texto',
};

const kw = (lista, flags = '') => new RegExp(`\\b(?:${lista.split(' ').join('|')})\\b`, `y${flags}`);
const STR = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/y;
const NUM = /\b(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[lLfFdDn]?)\b/y;
const COM_C = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y;

const REGRAS = {
  java: [
    ['com', COM_C], ['str', /"""[\s\S]*?(?:"""|$)/y], ['str', STR], ['ann', /@[A-Za-z_][\w.]*/y],
    ['kw', kw('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws try var val fun void volatile while record yield sealed permits when object companion func')],
    ['lit', kw('null true false nil')], ['tipo', /\b[A-Z][A-Za-z0-9_]*\b/y], ['num', NUM],
  ],
  javascript: [
    ['com', COM_C], ['str', /`(?:[^`\\]|\\.)*`/y], ['str', STR],
    ['kw', kw('async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield type interface implements enum readonly as')],
    ['lit', kw('null undefined true false NaN Infinity')], ['tipo', /\b[A-Z][A-Za-z0-9_$]*\b/y], ['num', NUM],
  ],
  json: [['chave', /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y], ['str', STR], ['lit', kw('true false null')], ['num', /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y]],
  bash: [
    ['com', /(?<![\w$])#[^\n]*/y], ['str', STR], ['var', /\$\{[^}\n]*\}|\$(?:\w+|[@#?*!$-])/y],
    ['kw', kw('if then else elif fi for in do done case esac while until function return export local readonly set unset source alias exit sudo')],
    ['cmd', /(?<=^|[|;&(]\s*|\n\s*)(?:git|glab|gh|mvn|mvnw|\.\/mvnw|java|node|npm|npx|python3?|pip|docker|kubectl|aws|curl|cd|ls|cat|grep|sed|awk|find|echo|rm|mkdir|cp|mv|chmod|tail|head|jq|claude)\b/y],
    ['opt', /(?<=\s)--?[A-Za-z][\w-]*/y], ['num', /\b\d+\b/y],
  ],
  yaml: [['com', /(?<!\S)#[^\n]*/y], ['chave', /[\w.$-]+(?=\s*:(?:\s|$))/y], ['str', STR], ['lit', kw('true false null yes no on off')], ['num', /-?\b\d+(?:\.\d+)?\b/y], ['var', /\$\{[^}\n]*\}/y]],
  properties: [['com', /(?<=^|\n)\s*[#;!][^\n]*/y], ['chave', /(?<=^|\n)\s*[^=:\s#;!][^=:\n]*?(?=\s*[=:])/y], ['var', /\$\{[^}\n]*\}/y], ['lit', kw('true false')], ['num', /\b\d+\b/y]],
  xml: [['com', /<!--[\s\S]*?(?:-->|$)/y], ['meta', /<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![A-Za-z][^>]*>/y], ['tag', /<\/?[\w:.-]+|\/?>/y], ['attr', /[\w:.-]+(?==)/y], ['str', STR], ['var', /\$\{[^}\n]*\}/y]],
  sql: [
    ['com', /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y], ['str', /'(?:[^']|'')*'/y],
    ['kw', kw('select from where join inner left right full outer cross on and or not insert into values update set delete create table view alter drop index procedure function trigger exec execute as order by group having union all top distinct is in like between case when then else end begin commit rollback transaction declare with nolock merge using output returns return if go primary key foreign references default constraint', 'i')],
    ['lit', kw('null true false', 'i')], ['tipo', kw('int bigint smallint tinyint bit decimal numeric money float real date datetime datetime2 time varchar nvarchar char nchar text uniqueidentifier varbinary', 'i')], ['num', /\b\d+(?:\.\d+)?\b/y],
  ],
  python: [
    ['com', /#[^\n]*/y], ['str', /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/y], ['str', /[rbfu]{0,2}(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/y], ['ann', /@[\w.]+/y],
    ['kw', kw('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case')],
    ['lit', kw('None True False self')], ['tipo', /\b[A-Z][A-Za-z0-9_]*\b/y], ['num', NUM],
  ],
  dockerfile: [['com', /(?<=^|\n)\s*#[^\n]*/y], ['kw', /(?<=^|\n)\s*(?:FROM|RUN|COPY|ADD|ENV|ARG|WORKDIR|EXPOSE|ENTRYPOINT|CMD|USER|LABEL|VOLUME|HEALTHCHECK|SHELL|ONBUILD|STOPSIGNAL|AS)\b/iy], ['str', STR], ['var', /\$\{[^}\n]*\}|\$\w+/y]],
  css: [['com', /\/\*[\s\S]*?(?:\*\/|$)/y], ['str', STR], ['chave', /[\w-]+(?=\s*:)/y], ['tag', /[.#]?[A-Za-z_][\w-]*(?=[^{}\n]*\{)/y], ['num', /-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?\b/y], ['var', /--[\w-]+|var\(/y]],
};

/** Linguagem pelo nome ou extensão do arquivo (para o conteúdo que uma ferramenta grava). */
export function linguagemDoArquivo(caminho) {
  const nome = String(caminho || '').split(/[\\/]/).pop().toLowerCase();
  if (nome === 'dockerfile' || nome.startsWith('dockerfile.')) return 'dockerfile';
  if (nome === 'pom.xml') return 'xml';
  if (nome === 'jenkinsfile') return 'java';
  const ext = nome.includes('.') ? nome.split('.').pop() : '';
  return APELIDOS[ext] ? ext : '';
}

/** Código colorido: HTML com <span class="hl-…">, escapado. Linguagem desconhecida volta só escapada. */
export function realcar(codigo, linguagem) {
  const lang = APELIDOS[String(linguagem || '').toLowerCase()] || '';
  const texto = String(codigo ?? '');
  if (lang === 'diff') {
    return texto.split('\n').map((l) => {
      const cls = /^(\+\+\+|---)/.test(l) ? 'meta' : l.startsWith('+') ? 'mais' : l.startsWith('-') ? 'menos' : l.startsWith('@@') ? 'meta' : '';
      return cls ? `<span class="hl-${cls}">${esc(l)}</span>` : esc(l);
    }).join('\n');
  }
  const regras = REGRAS[lang];
  if (!regras || texto.length > 60000) return esc(texto);
  let out = '', i = 0, solto = '';
  const IDENT = /[A-Za-z_$][\w$]*/y;
  while (i < texto.length) {
    let achou = null;
    for (const [cls, re] of regras) {
      re.lastIndex = i;
      const m = re.exec(texto);
      if (m && m[0].length) { achou = [cls, m[0]]; break; }
    }
    if (achou) {
      if (solto) { out += esc(solto); solto = ''; }
      out += `<span class="hl-${achou[0]}">${esc(achou[1])}</span>`;
      i += achou[1].length;
      continue;
    }
    IDENT.lastIndex = i;
    const id = IDENT.exec(texto);
    const pedaco = id ? id[0] : texto[i];
    solto += pedaco;
    i += pedaco.length;
  }
  return out + esc(solto);
}

/* ------------------------------------------------------------ blocos de código */

function blocoCodigo(codigo, linguagem) {
  const lang = String(linguagem || '').toLowerCase();
  const rotulo = lang && lang !== 'texto' ? lang : 'texto';
  return `<div class="md-codigo"><div class="md-codigo-topo"><span>${esc(rotulo)}</span><button type="button" class="md-copiar" title="Copiar o código">copiar</button></div><pre><code>${realcar(codigo.replace(/\n+$/, ''), lang)}</code></pre></div>`;
}

if (typeof document !== 'undefined' && !window.__mdCopiar) {
  window.__mdCopiar = true;
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest && ev.target.closest('.md-copiar');
    if (!b) return;
    const codigo = b.closest('.md-codigo').querySelector('code').textContent;
    try { await navigator.clipboard.writeText(codigo); b.textContent = 'copiado ✓'; } catch { b.textContent = 'não deu'; }
    setTimeout(() => { b.textContent = 'copiar'; }, 1400);
  });
}

/* ------------------------------------------------------------ texto corrido */

/** Uma linha: código inline, negrito, itálico, riscado, links e endereços soltos. */
export function inline(s) {
  const codigos = [];
  let t = String(s ?? '').replace(/`([^`\n]+)`/g, (_, c) => { codigos.push(c); return `\u0001${codigos.length - 1}\u0001`; });
  t = esc(t)
    .replace(/\u0002([^\u0002]+)\u0002/g, '<b class="md-rotulo">$1</b>')
    .replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  return t.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${esc(codigos[Number(i)])}</code>`);
}

// "... texto. POR QUE AGORA: ..." → quebra antes do rótulo e marca o rótulo (só caixa alta, 5+ letras)
const ROTULO = /(^|[.!?;:)]\s+)((?:[A-ZÀ-ÖØ-Þ]+\s){0,4}[A-ZÀ-ÖØ-Þ]{2,}):\s+/g;
function separarRotulos(linha) {
  return linha.replace(ROTULO, (m, antes, rot) => (rot.replace(/\s/g, '').length >= 5 ? `${antes}\n\u0002${rot}:\u0002 ` : m)).split('\n');
}

function itensDeLista(linhas, i) {
  const itens = [];
  const base = linhas[i].match(/^\s*/)[0].replace(/\t/g, '    ').length;
  while (i < linhas.length) {
    const l = linhas[i];
    const m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (m) {
      const recuo = Math.max(0, m[1].replace(/\t/g, '    ').length - base);
      let texto = m[3];
      const caixa = texto.match(/^\[([ xX])\]\s+(.*)$/);
      if (caixa) texto = `${caixa[1] === ' ' ? '☐' : '☑'} ${caixa[2]}`;
      itens.push({ nivel: Math.floor(recuo / 2), ordenada: /\d/.test(m[2]), inicio: /\d/.test(m[2]) ? parseInt(m[2], 10) : 1, texto });
      i++;
    } else if (l.trim() && /^\s{2,}\S/.test(l) && itens.length) {
      itens[itens.length - 1].texto += `\n${l.trim()}`; // continuação do item
      i++;
    } else break;
  }
  return { itens, i };
}

function lista(itens) {
  let html = '';
  const pilha = [];
  for (const it of itens) {
    while (pilha.length && pilha[pilha.length - 1].nivel > it.nivel) html += `</li></${pilha.pop().tag}>`;
    const tagItem = it.ordenada ? 'ol' : 'ul';
    if (pilha.length && pilha[pilha.length - 1].nivel === it.nivel && pilha[pilha.length - 1].tag !== tagItem) html += `</li></${pilha.pop().tag}>`; // muda de tipo no mesmo nível
    const topo = pilha[pilha.length - 1];
    if (!topo || topo.nivel < it.nivel) {
      const tag = it.ordenada ? 'ol' : 'ul';
      html += `<${tag} class="md-lista"${it.ordenada && it.inicio !== 1 ? ` start="${it.inicio}"` : ''}>`;
      pilha.push({ nivel: it.nivel, tag });
    } else html += '</li>';
    html += `<li>${it.texto.split('\n').map(inline).join('<br>')}`;
  }
  while (pilha.length) html += `</li></${pilha.pop().tag}>`;
  return html;
}

const celulas = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());

/** Markdown de bloco: o que o agente escreveu, com tópicos, listas, tabelas e código. */
export function md(texto) {
  const linhas = String(texto ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let par = [];
  const fecharPar = () => { if (par.length) { out.push(`<p>${par.map(inline).join('<br>')}</p>`); par = []; } };
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    let m;
    if ((m = l.match(/^\s*(`{3,}|~{3,})\s*([\w#+.-]*)/))) {
      fecharPar();
      const cerca = m[1];
      const corpo = [];
      i++;
      while (i < linhas.length && !linhas[i].trim().startsWith(cerca)) corpo.push(linhas[i++]);
      i++;
      out.push(blocoCodigo(corpo.join('\n'), m[2]));
      continue;
    }
    if (!l.trim()) { fecharPar(); i++; continue; }
    if ((m = l.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/))) { fecharPar(); out.push(`<div class="md-h md-h${Math.min(m[1].length, 4)}">${inline(m[2])}</div>`); i++; continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { fecharPar(); out.push('<hr class="md-hr">'); i++; continue; }
    if (/^\s*>/.test(l)) {
      fecharPar();
      const q = [];
      while (i < linhas.length && /^\s*>/.test(linhas[i])) q.push(linhas[i++].replace(/^\s*> ?/, ''));
      out.push(`<blockquote class="md-cit">${md(q.join('\n'))}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < linhas.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(linhas[i + 1])) {
      fecharPar();
      const cab = celulas(l);
      const alinh = celulas(linhas[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
      i += 2;
      const corpo = [];
      while (i < linhas.length && /^\s*\|.*\|\s*$/.test(linhas[i])) corpo.push(celulas(linhas[i++]));
      const td = (tag, c, k) => `<${tag}${alinh[k] ? ` style="text-align:${alinh[k]}"` : ''}>${inline(c)}</${tag}>`;
      out.push(`<div class="md-tabela"><table><thead><tr>${cab.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${corpo.map((r) => `<tr>${r.map((c, k) => td('td', c, k)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+\S/.test(l)) {
      fecharPar();
      const r = itensDeLista(linhas, i);
      out.push(lista(r.itens));
      i = r.i;
      continue;
    }
    for (const pedaco of separarRotulos(l)) {
      if (!pedaco.trim()) continue;
      if (pedaco.startsWith('\u0002') && par.length) fecharPar(); // cada rótulo abre um tópico
      par.push(pedaco);
    }
    i++;
  }
  fecharPar();
  return out.join('');
}
