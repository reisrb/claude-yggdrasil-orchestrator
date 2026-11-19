'use strict';
/*
 * simulador.js — substitui o Claude no modo `server.js --simular`.
 *
 * Gera eventos, conversa e atividade falsos pelo MESMO caminho do modo real
 * (loja → eventos.jsonl → projeção → página), para validar o escritório e a
 * interação (responder, retomar, parar) sem gastar token.
 */

const REPOS = ['pagamentos-api', 'cadastro-legado', 'portal-clientes', 'motor-regras', 'notificacoes', 'relatorios-batch'];

const FLUXOS = {
  'sim-modernizacao': {
    id: 'sim-modernizacao',
    nome: 'Simulação: modernização de um repo',
    missao: 'Modernizar um repositório (simulado)',
    descricao: 'Fluxo fictício de 4 passos, só para a simulação do escritório.',
    passos: [
      { id: 'inventario', nome: 'Inventário', skill: 'inventario-repo', papel: 'Batedor', depende: [] },
      { id: 'analise', nome: 'Análise de impacto', skill: 'analise-impacto', papel: 'Estrategista', depende: ['inventario'] },
      { id: 'mudanca', nome: 'Aplicar mudança', skill: 'aplicar-mudanca', papel: 'Forjador', depende: ['analise'] },
      { id: 'testes', nome: 'Testes de regressão', skill: 'testes-regressao', papel: 'Sentinela', depende: ['mudanca'] },
    ],
  },
};

const ROTEIROS = {
  'inventario-repo': [['lendo', 'README.md', 2200], ['buscando', '**/*.xml', 1800], ['lendo', 'pom.xml', 2400], ['rodando', 'git log --oneline -20', 1800], ['lendo', 'Jenkinsfile', 2000]],
  'analise-impacto': [['buscando', 'usos da API antiga', 2200], ['lendo', 'ServicoLegado', 2400], ['pensando', '', 1800], ['digitando', 'analise.md', 2800]],
  'aplicar-mudanca': [['digitando', 'pom.xml', 2600], ['rodando', 'mvn -q compile', 3000], ['digitando', 'Configuracao.java', 2400], ['rodando', 'mvn -q test', 2800]],
  'testes-regressao': [['rodando', 'mvn -q verify', 3200], ['lendo', 'surefire-reports', 2000], ['digitando', 'evidencias.md', 2400]],
  'demo-relatorio': [['lendo', 'inventario.md', 2000], ['digitando', 'relatorio.md', 3200], ['digitando', 'relatorio.md', 2400]],
};
const ROTEIRO_PADRAO = [['lendo', 'arquivos do passo', 2200], ['digitando', 'saida.md', 2600], ['rodando', 'checagem', 2000]];

const RESUMOS = {
  'inventario-repo': 'runtime 8, framework 1.5 (pom.xml), build Maven, CI em Jenkinsfile, roda on-prem',
  'analise-impacto': '14 pontos de impacto em 6 classes; 2 libs sem versão compatível',
  'aplicar-mudanca': 'versões atualizadas e 9 ajustes de API; compila',
  'testes-regressao': '212 testes, 0 falhas; evidências salvas',
  'demo-relatorio': 'relatório escrito em specs/<repo>/<ciclo>/relatorio.md',
};

const APRENDIZADO_SIM = {
  skills: {
    'inventario-repo': { atualizado: '2026-11-18', ciclos: 4, licoes: [
      { tipo: 'faca', texto: 'Ler o parent do pom antes das dependências: é ele que fixa as versões', vezes: 3 },
      { tipo: 'faca', texto: 'Registrar o caminho do Jenkinsfile como evidência de CI', vezes: 2 },
      { tipo: 'evite', texto: 'Rodar a suíte inteira de testes só para descobrir a versão', vezes: 2 },
    ] },
    'analise-impacto': { atualizado: '2026-11-18', ciclos: 2, licoes: [
      { tipo: 'faca', texto: 'Separar impacto de API pública e de uso interno', vezes: 2 },
      { tipo: 'lacuna', texto: 'A skill não diz o que fazer com módulos sem testes', vezes: 2 },
      { tipo: 'evite', texto: 'Listar todas as ocorrências: agrupe por classe', vezes: 1 },
    ] },
    'aplicar-mudanca': { atualizado: '2026-11-17', ciclos: 1, licoes: [
      { tipo: 'faca', texto: 'Compilar depois de cada ajuste, não no fim', vezes: 1 },
      { tipo: 'lacuna', texto: 'Falta o passo de atualizar o Dockerfile junto com a versão', vezes: 1 },
    ] },
  },
  repos: {
    'pagamentos-api': [
      { titulo: '2026-11-17 · modernização', texto: 'Inventário e análise concluídos; mudança aprovada com observação de priorizar módulos com testes.' },
      { titulo: '2026-11-18 · modernização', texto: 'Testes de regressão passaram; push e MR ficaram com o usuário.' },
    ],
    'cadastro-legado': [{ titulo: '2026-11-18 · demo', texto: 'Pausou por limite de uso; retomado e concluído depois de um erro de build.' }],
  },
};

class Parado extends Error {}

function criarSimulador({ loja, atividade }) {
  const execs = new Map();
  let seq = 0;

  const ev = (id, e) => loja.registrar({ contexto: id, ...e });
  const fala = (id, texto) => { ev(id, { tipo: 'mensagem', texto }); loja.anotarConversa(id, { quem: 'agente', texto }); };

  function estado(id) {
    if (!execs.has(id)) execs.set(id, { parado: false, espera: null });
    return execs.get(id);
  }

  async function dormir(id, ms) {
    const ex = estado(id);
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      if (ex.parado) throw new Parado();
      await new Promise((r) => setTimeout(r, Math.min(250, fim - Date.now())));
    }
    if (ex.parado) throw new Parado();
  }

  function aguardar(id, tipo) {
    const ex = estado(id);
    return new Promise((resolve, reject) => { ex.espera = { tipo, resolve, reject }; });
  }

  async function perguntar(id, { tipoPergunta, texto, explicacao, opcoes = [], chave }) {
    atividade(id, 'lider', 'perguntando', '');
    ev(id, { tipo: 'pergunta.abrir', tipoPergunta, chave, texto, explicacao, opcoes });
    loja.anotarConversa(id, { quem: 'agente', tipo: 'pergunta', texto: explicacao ? `${texto}\n\n${explicacao}` : texto });
    const r = await aguardar(id, 'resposta');
    atividade(id, 'lider', 'pensando', '');
    return r;
  }

  async function pausar(id, status, motivo, falaAntes) {
    if (falaAntes) fala(id, falaAntes);
    ev(id, { tipo: 'contexto.status', status, motivo });
    atividade(id, 'lider', status === 'PAUSADO_LIMITE' ? 'dormindo' : 'erro', '');
    await aguardar(id, 'retomar');
    atividade(id, 'lider', 'pensando', '');
    fala(id, status === 'PAUSADO_LIMITE' ? 'Limite liberado. Retomando de onde parei.' : 'Retomando: vou refazer o passo que falhou.');
  }

  async function trabalhar(id, { skill, papel, passo, roteiro, resumo, durante, pai }) {
    const workerId = `sim-w${++seq}`;
    ev(id, { tipo: 'worker.inicio', workerId, papel, skill, passo, pai, descricao: `executando ${skill}` });
    if (skill === 'analise-impacto' && !pai) {
      // um subagente que lança outros: os filhos ficam no grupo dele
      const filhos = ['leitor-modulos', 'mapeador-apis'].map((s, k) => trabalhar(id, {
        skill: s, papel: k ? 'Cartógrafo' : 'Leitor', passo, pai: workerId,
        roteiro: k ? [['buscando', '@RequestMapping', 2600], ['lendo', 'ApiCliente.java', 2400], ['digitando', 'apis.md', 2200]]
          : [['lendo', 'modulo-core/pom.xml', 2400], ['lendo', 'modulo-web/pom.xml', 2200], ['digitando', 'modulos.md', 2400]],
        resumo: k ? '11 endpoints mapeados' : '3 módulos, 2 com parent antigo',
      }));
      atividade(id, workerId, 'delegando', 'leitor-modulos, mapeador-apis');
      await Promise.all(filhos);
    }
    const passos = roteiro || ROTEIROS[skill] || ROTEIRO_PADRAO;
    for (let i = 0; i < passos.length; i++) {
      const [tipo, alvo, ms] = passos[i];
      atividade(id, workerId, tipo, alvo);
      if (i === 1) ev(id, { tipo: 'worker.resumo', workerId, resumo: `${tipo} ${alvo}` });
      await dormir(id, ms);
      if (durante) {
        const r = await durante(i, workerId);
        if (r === 'refazer') return trabalhar(id, { skill, papel, passo, roteiro, resumo });
      }
    }
    ev(id, { tipo: 'worker.fim', workerId, status: 'DONE', resumo: resumo || RESUMOS[skill] || 'feito' });
    atividade(id, workerId, null);
    return workerId;
  }

  async function roteiro(id, ctx, fluxo, cenas) {
    const tem = (c) => cenas.includes(c);
    atividade(id, 'lider', 'pensando', '');
    await dormir(id, 2200);
    fala(id, `Assumi o contexto ${ctx.repo}. Vou seguir o fluxo "${fluxo.nome}", começando por ${fluxo.passos[0].nome}.`);

    for (let i = 0; i < fluxo.passos.length; i++) {
      const p = fluxo.passos[i];
      const prox = fluxo.passos[i + 1];
      ev(id, { tipo: 'passo', passo: p.id, status: 'ACTIVE', skill: p.skill });
      atividade(id, 'lider', 'delegando', p.skill);
      await dormir(id, 1400);
      atividade(id, 'lider', 'pensando', '');

      let durante = null;
      if (i === 0 && tem('limite')) {
        durante = async (n) => { if (n === 1) await pausar(id, 'PAUSADO_LIMITE', 'limite de uso atingido (simulado)', 'Bati no limite de uso. Fico parado até você clicar em Retomar.'); };
      } else if (i === 1 && tem('guarda')) {
        durante = async (n) => {
          if (n === 1) {
            ev(id, { tipo: 'guarda.bloqueio', alvo: 'git push origin feature/modernizacao', motivo: 'push é manual: quem envia para o remoto é você' });
            fala(id, 'O Heimdall barrou um `git push` que eu tentei. Combinado: push é com você.');
          }
        };
      } else if (i === 1 && tem('erro')) {
        let falhou = false;
        durante = async (n, workerId) => {
          if (n === 1 && !falhou) {
            falhou = true;
            ev(id, { tipo: 'worker.fim', workerId, status: 'ERROR', resumo: 'build falhou: 3 testes quebrados (simulado)' });
            atividade(id, workerId, null);
            await pausar(id, 'ERRO', 'build falhou: 3 testes quebrados (simulado)', 'O build falhou com 3 testes quebrados. Clique em Retomar quando quiser que eu tente de novo.');
            return 'refazer';
          }
          return null;
        };
      }
      await trabalhar(id, { skill: p.skill, papel: p.papel, passo: p.id, durante });
      ev(id, { tipo: 'passo', passo: p.id, status: 'DONE', resumo: RESUMOS[p.skill] });

      if (prox) {
        await dormir(id, 1200);
        const pedir = () => perguntar(id, {
          tipoPergunta: 'checkpoint', chave: `passo:${prox.id}`,
          texto: `${p.nome} concluído: ${RESUMOS[p.skill] || 'ok'}. Posso seguir para ${prox.nome}?`,
          explicacao: `O próximo passo usa a skill "${prox.skill}" (${prox.papel}). Ela ${prox.id === 'mudanca' ? 'altera arquivos dentro de repos/' + ctx.repo : 'só lê o repositório e escreve no ciclo da spec'}. Para desfazer, basta descartar a branch de trabalho.`,
          opcoes: ['Aprovar', 'Rejeitar', 'Explica melhor'],
        });
        let r = await pedir();
        while (/explica/i.test(r)) {
          fala(id, `Claro. ${prox.nome} existe para ${prox.id === 'mudanca' ? 'aplicar as mudanças levantadas na análise, uma de cada vez, compilando a cada uma' : 'transformar o que foi levantado em algo verificável'}. Nada sai do seu computador: push, MR e merge continuam com você.`);
          r = await pedir();
        }
        if (/rejeit|n[ãa]o\b/i.test(r)) {
          const ajuste = await perguntar(id, { tipoPergunta: 'duvida', texto: 'Entendi. O que devo ajustar antes de seguir?', opcoes: [] });
          fala(id, `Ajustei conforme você pediu: "${ajuste}". Seguindo.`);
        }
      }
    }

    if (tem('escolha')) {
      const r = await perguntar(id, {
        tipoPergunta: 'escolha',
        texto: 'Antes de fechar: encontrei dois caminhos para o alvo de versão. Qual seguimos?',
        explicacao: 'A: mudança mínima, menor risco. B: completa, já resolve o débito de bibliotecas.',
        opcoes: ['Caminho A — mínimo', 'Caminho B — completo'],
      });
      fala(id, `Seguindo com: ${r}.`);
    }

    // verificação (balcão do verificador)
    const vId = `sim-v${++seq}`;
    ev(id, { tipo: 'worker.inicio', workerId: vId, papel: 'verificador', skill: 'verificador', descricao: 'conferindo critérios de aceite' });
    atividade(id, vId, 'lendo', 'critérios de aceite');
    await dormir(id, 3200);
    ev(id, { tipo: 'worker.fim', workerId: vId, status: 'DONE', resumo: 'CA1 ✓ CA2 ✓ CA3 ✓' });
    atividade(id, vId, null);
    ev(id, { tipo: 'metricas', custoUsd: 0, duracaoMs: Date.now() - Date.parse(ctx.criadoEm || new Date().toISOString()) });
    fala(id, `Ciclo concluído em ${ctx.repo}. Critérios de aceite conferidos pelo verificador. O que falta (push e MR) fica com você.`);
    ev(id, { tipo: 'contexto.status', status: 'CONCLUIDO' });
    atividade(id, 'lider', null);
  }

  return {
    REPOS,
    FLUXOS,
    iniciar(ctx, fluxo, cenas = ['guarda']) {
      estado(ctx.id).parado = false;
      roteiro(ctx.id, ctx, fluxo, cenas).catch((err) => {
        if (!(err instanceof Parado)) {
          ev(ctx.id, { tipo: 'contexto.status', status: 'ERRO', motivo: `simulador: ${err.message}` });
        }
      }).finally(() => execs.delete(ctx.id));
    },
    esperando(id, tipo) {
      const ex = execs.get(id);
      return !!(ex && ex.espera && ex.espera.tipo === tipo);
    },
    responder(id, texto) {
      const ex = execs.get(id);
      if (!ex || !ex.espera || ex.espera.tipo !== 'resposta') return false;
      const { resolve } = ex.espera; ex.espera = null; resolve(texto);
      return true;
    },
    mensagem(id, texto) {
      const ex = execs.get(id);
      if (ex && ex.espera && ex.espera.tipo === 'resposta') { const { resolve } = ex.espera; ex.espera = null; resolve(texto); return; }
      fala(id, `Anotado: "${texto.slice(0, 120)}". Levo isso em conta no passo atual.`);
    },
    retomar(id) {
      const ex = execs.get(id);
      if (!ex || !ex.espera || ex.espera.tipo !== 'retomar') return false;
      const { resolve } = ex.espera; ex.espera = null; resolve();
      return true;
    },
    parar(id) {
      const ex = execs.get(id);
      if (!ex) return false;
      ex.parado = true;
      if (ex.espera) { const { reject } = ex.espera; ex.espera = null; reject(new Parado()); }
      return true;
    },
    ativo(id) { return execs.has(id); },
  };
}

module.exports = { criarSimulador, REPOS, FLUXOS, APRENDIZADO_SIM };
