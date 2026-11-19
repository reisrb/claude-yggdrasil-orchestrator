# Yggdrasil — molde de orquestradores

Este repositório é o **molde genérico**, sem contexto de negócio. Cada time ganha uma instância própria: o núcleo daqui mais uma camada `time/`.

- **Criar o orquestrador de um time:** `/novo-orquestrador`.
- **Evoluir o núcleo** (SDD): primeiro `specs/_nucleo/spec.md` e `tarefas.md`, depois o código, e então `node scripts/atualizar-nucleo.js <instância> --dry-run` para levar às instâncias.
- **Ver o Office sem Claude:** `node .claude/office/server.js --simular --tema nordico` (ou `neutro`).
- **Testes rápidos:** `node .claude/office/estado.js autoteste`, `node .claude/office/prontidao.js --autoteste`, `node .claude/hooks/guarda.js --autoteste`.
- **Regra do molde:** nada de termos de negócio no núcleo (CA7.3). Nomes de times, sistemas e tickets ficam só em `time/` das instâncias.

@nucleo.md
