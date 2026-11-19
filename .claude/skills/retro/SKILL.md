---
name: retro
description: Consolida o aprendizado de um ciclo — lê o diário do repo e os relatórios dos workers e REESCREVE as lições por skill em aprendizado/skills/<skill>.md com poda (no máximo ~12 lições, sem repetição, com contagem de ocorrências) e separa lacunas das skills do time para levar ao time. Use quando o usuário disser "/retro", "faz a retrospectiva", "consolida o aprendizado" ou no fim de um ciclo.
---

# /retro [repo]

1. Leia a última entrada de `aprendizado/repos/<repo>.md` e as seções "Log de execução" do `tarefas.md` do ciclo, que trazem os atritos relatados pelos workers.
2. Para cada skill usada no ciclo, abra `aprendizado/skills/<skill>.md` (pode não existir) e **reescreva** o arquivo, sem acrescentar no fim:
   ```
   # Lições — <skill>
   _Atualizado em AAAA-MM-DD · ciclos: N_

   ## Faça
   - <lição curta e acionável> (visto Nx)
   ## Evite
   - <armadilha> (visto Nx)
   ## Lacunas da skill (levar ao time)
   - <onde a skill do time é ambígua ou está incompleta>, com sugestão de texto
   ```
   - Junte as lições repetidas e aumente o contador.
   - Remova as que não se aplicam mais.
   - Mantenha no máximo cerca de 12 lições: o worker lê o arquivo inteiro a cada passo.
   - Só entram lições que generalizam, nada específico de um repo só.
3. Registre `node .claude/office/estado.js retro --repo <repo> --skill <skill>` para cada skill revisada (no Office, os heróis vão ao poço de Mimir).
4. Mostre ao usuário o diff resumido das lições e a lista de lacunas para levar ao time.
