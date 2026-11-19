---
name: office
description: Sobe o Office (escritório virtual local com os contextos, a caixa de atenção e as respostas aos agentes) em background e mostra o link. Use quando o usuário disser "/office", "abre o office", "sobe o escritório", "quero ver os agentes" ou "/office simular" (protótipo sem Claude).
---

# /office [simular]

1. Veja se já está no ar: `curl -s -o /dev/null -w "%{http_code}" http://localhost:<porta>/state`. A porta está em `orquestrador.json` (padrão 4321).
2. Se não estiver, suba em background, sem bloquear a conversa:
   - normal: `node .claude/office/server.js`
   - simulação: `node .claude/office/server.js --simular`
3. Mostre o link `http://localhost:<porta>` e dê três dicas:
   - clicar no herói abre a conversa;
   - a roda do mouse dá zoom;
   - o quadro de missões convoca um contexto novo.
4. Para ver o estado no terminal sem gastar token: `!node .claude/office/estado.js status`.
