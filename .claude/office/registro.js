// registro.js — os dois popups do 📝 Registrar, na Conversa e nos Chats.
//   1. Pedido: o que o botão faz (a anotação de orquestrador.json → registro) e se a pessoa concorda.
//   2. Rascunho: o que a cópia da sessão vai gravar, formatado e com rolagem: Aprovar, Ajustar, Descartar ou Decidir depois.
// A cópia roda em paralelo no servidor (nada para); o rascunho abre sozinho quando fica pronto na conversa que está na tela.
import { dialogo, confirmar } from './dialogo.js';
import { md } from './markdown.js';

export function criarRegistro({ api, toast, esc, rotulo, depois }) {
  let cfg = { configurado: false, resumo: '', onde: [] };
  const abertos = new Set(); // contextos com o popup do rascunho na tela
  const vistos = new Map(); // contexto -> versão do rascunho já mostrada (não reabre sozinho)
  const avisados = new Map(); // contexto -> versão já avisada por toast (estava em outra tela)
  const quando = (ts) => new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const fim = () => { if (depois) depois(); };

  /** Popup 1: o que vai acontecer e onde grava; com o ok, a cópia começa a preparar o rascunho. */
  async function pedir(c) {
    const r = c.registro;
    if (r && r.fase === 'pronto') return verRascunho(c, true);
    if (r) return emAndamento(c);
    const desde = c.ultimoRegistro ? `desde o último registro (${quando(c.ultimoRegistro.ts)})` : 'desde o início desta conversa';
    const html = `<p class="dlg-lead">${esc(cfg.resumo)}</p>
      <h4>Onde grava</h4><ul>${cfg.onde.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
      <h4>Como funciona</h4><ol>
        <li>Uma <b>cópia desta sessão</b> prepara o rascunho do que foi feito ${esc(desde)}, <b>em paralelo</b>: o que está rodando não para e não recebe nada.</li>
        <li>O rascunho abre aqui, formatado, para você ler e <b>aprovar</b>, pedir <b>ajuste</b> ou <b>descartar</b>.</li>
        <li>Só com a sua aprovação a cópia grava. Até lá, nada sai daqui.</li>
      </ol>
      ${cfg.configurado ? '' : '<p class="dlg-nota">Para gravar em outro lugar (por exemplo, numa skill sua de tarefas), configure <code>registro</code> no <code>orquestrador.json</code>: veja o README.</p>'}`;
    const v = await dialogo({
      titulo: `📝 Registrar · ${rotulo(c)}`, icone: '📝', html,
      botoes: [{ rotulo: 'Cancelar', valor: 'nao' }, { rotulo: 'Preparar o rascunho', valor: 'sim', classe: 'primario' }],
    });
    if (v !== 'sim') return;
    try {
      const resp = await api('/registrar', { contextoId: c.id });
      toast(resp.jaExistia ? '📝 Já há um registro em andamento nesta conversa.' : '📝 Preparando o rascunho numa cópia desta sessão, em paralelo. Ele abre aqui quando ficar pronto.');
    } catch (e) { toast(e.message, true); } finally { fim(); }
  }

  /** Clique no botão enquanto a cópia prepara ou grava: mostra a fase e deixa descartar o preparo. */
  async function emAndamento(c) {
    if (c.registro.fase === 'gravando') return toast('📝 Gravando o registro aprovado: a cópia mostra na conversa o que gravou.');
    const v = await dialogo({
      titulo: `📝 Registrar · ${rotulo(c)}`, icone: '📝',
      html: '<p class="dlg-lead">Uma cópia desta sessão está preparando o rascunho, em paralelo. Ele abre aqui quando ficar pronto.</p>',
      botoes: [{ rotulo: 'Descartar o registro', valor: 'descartar', classe: 'perigo' }, { rotulo: 'Continuar esperando', valor: 'ok', classe: 'primario' }],
    });
    if (v === 'descartar') await descartar(c);
  }

  async function descartar(c) {
    try { await api('/registro-descartar', { contextoId: c.id }); toast('📝 Registro descartado: nada foi gravado.'); } catch (e) { toast(e.message, true); } finally { fim(); }
  }

  /** Popup 2: o rascunho formatado, com rolagem, e a decisão. */
  async function verRascunho(c, peloBotao = false) {
    const r = c.registro;
    if (!r || r.fase !== 'pronto' || abertos.has(c.id)) return;
    abertos.add(c.id);
    vistos.set(c.id, r.versao);
    try {
      const v = await dialogo({
        titulo: `📝 Rascunho do registro · ${rotulo(c)}`, icone: '📝', largo: true,
        html: `<p class="dlg-lead">É isto que a cópia vai gravar${r.versao > 1 ? ` (versão ${r.versao}, com o seu ajuste)` : ''}. Leia e decida: nada foi gravado ainda.</p>
          <div class="dlg-rolagem md" tabindex="0">${md(r.rascunho || '')}</div>`,
        botoes: [
          { rotulo: 'Descartar', valor: 'descartar', classe: 'perigo' },
          { rotulo: 'Decidir depois', valor: 'depois' },
          { rotulo: 'Ajustar…', valor: 'ajustar' },
          { rotulo: 'Aprovar e gravar', valor: 'aprovar', classe: 'primario' },
        ],
      });
      if (v === 'aprovar') {
        await api('/registro-aprovar', { contextoId: c.id, versao: r.versao });
        toast('📝 Aprovado: a cópia está gravando, em paralelo. O que ela gravou aparece na conversa.');
      } else if (v === 'ajustar') {
        const a = await dialogo({
          titulo: 'O que ajustar no rascunho?', icone: '✎',
          html: '<p class="dlg-lead">A cópia refaz o rascunho com o seu pedido e mostra de novo antes de gravar.</p>',
          campo: { rotulo: 'Seu ajuste', placeholder: 'ex.: tire a parte da autoavaliação; cite o MR !123; junte as duas decisões numa linha' },
          botoes: [{ rotulo: 'Voltar ao rascunho', valor: 'voltar' }, { rotulo: 'Refazer o rascunho', valor: 'refazer', classe: 'primario', precisaTexto: true }],
        });
        if (a && a.valor === 'refazer' && a.texto) {
          await api('/registro-ajustar', { contextoId: c.id, texto: a.texto });
          toast('📝 Refazendo o rascunho com o seu ajuste. Ele abre de novo quando ficar pronto.');
        } else {
          abertos.delete(c.id);
          return verRascunho(c, peloBotao); // voltou sem ajustar: o rascunho reabre
        }
      } else if (v === 'descartar') {
        if (await confirmar({ titulo: 'Descartar o rascunho?', texto: 'Nada é gravado e a cópia da sessão é apagada. Para registrar depois, clique em 📝 Registrar de novo.', ok: 'Descartar', perigo: true })) await descartar(c);
      } else if (!peloBotao) {
        toast('📝 O rascunho fica esperando: abra em 📝 Ver rascunho quando quiser.');
      }
    } catch (e) { toast(e.message, true); } finally { abertos.delete(c.id); fim(); }
  }

  return {
    configurar(novo) { if (novo) cfg = { configurado: !!novo.configurado, resumo: novo.resumo || '', onde: novo.onde || [] }; },
    pedir,
    /** Rótulo e dica do botão 📝 conforme a fase do registro do contexto. */
    botao(c) {
      const r = c && c.registro;
      if (!r) return { texto: '📝 Registrar', classe: '' };
      if (r.fase === 'pronto') return { texto: '📝 Ver rascunho', classe: 'registro-pronto', dica: 'O rascunho do registro está pronto: leia e aprove' };
      return { texto: r.fase === 'gravando' ? '📝 Gravando…' : '📝 Preparando…', classe: 'registro-andando', dica: r.fase === 'gravando' ? 'A cópia está gravando o registro aprovado' : 'Uma cópia desta sessão prepara o rascunho, em paralelo' };
    },
    /** Rascunho novo: abre sozinho na conversa que está na tela (uma vez por versão); das outras, avisa uma vez. */
    observar(contextos, naTela) {
      for (const c of contextos || []) {
        const r = c.registro;
        if (!r || r.fase !== 'pronto') { if (!r) { vistos.delete(c.id); avisados.delete(c.id); } continue; }
        if (vistos.get(c.id) === r.versao) continue;
        if (c.id === naTela) { verRascunho(c); continue; }
        if (avisados.get(c.id) !== r.versao) { avisados.set(c.id, r.versao); toast(`📝 O rascunho do registro de ${rotulo(c)} está pronto: abra a conversa para aprovar.`); }
      }
    },
  };
}
