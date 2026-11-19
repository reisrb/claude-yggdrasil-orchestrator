---
name: inventario-repo
description: Levantamento somente leitura de um repositório — linguagem e versão, framework e versão, ferramenta de build, dependências principais, CI/CD, empacotamento e indícios de onde roda — sempre com evidência arquivo:linha. Escreve inventario.md na pasta do ciclo. Use como primeiro passo de qualquer fluxo ou quando pedirem "inventário do repo", "qual a stack desse repo".
---

# inventario-repo

**Somente leitura.** Não altere nada em `repos/<repo>`.

## O que levantar (sempre com `arquivo:linha`)
| Item | Onde olhar |
|---|---|
| Linguagem e versão | `pom.xml` (`maven.compiler.*`, `java.version`), `build.gradle*`, `package.json` (`engines`), `go.mod`, `pyproject.toml`/`setup.cfg`, `.tool-versions`, `.nvmrc`, `Dockerfile` (imagem base) |
| Framework e versão | parent/BOM no build, dependências principais |
| Build | Maven/Gradle/npm/…; wrapper presente? comando de build e de teste |
| Dependências relevantes | as 10 mais importantes e versões fixadas; módulos internos |
| CI/CD | `Jenkinsfile`, `.gitlab-ci.yml`, `.github/workflows/`, `azure-pipelines.yml` |
| Empacotamento e execução | `Dockerfile`, `docker-compose*`, manifests k8s/helm, scripts de deploy |
| Onde roda | indícios por evidência (configs de ambiente, hosts, pipeline). Sem evidência, escreva "sem evidência" |
| Testes | onde estão, framework e, se for barato, um `--dry-run` ou listagem (não rode a suíte inteira sem pedir) |

## Saída
`specs/<repo>/<ciclo>/inventario.md`, com uma tabela por seção. Fecha com **Pontos de atenção**: versões fora de suporte, ausência de testes e qualquer coisa que o plano precisa considerar. O resumo devolvido ao orquestrador tem 3 linhas no máximo.
