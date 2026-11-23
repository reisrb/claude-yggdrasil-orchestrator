@echo off
rem ============================================================================================
rem  Office do orquestrador como app do Windows (sem administrador).
rem    instalar.cmd                       compila o <Nome>Office.exe (Nome = "nome" do orquestrador.json)
rem    instalar.cmd /iniciar-com-windows  compila, liga o inicio automatico e abre o app
rem    instalar.cmd /remover-inicio       desliga o inicio automatico (e so isso)
rem  O app cria sozinho o atalho no menu Iniciar na primeira abertura.
rem  Inicio automatico = registro do usuario (HKCU\...\Run), visivel em Gerenciador de Tarefas >
rem  Aplicativos de inicializacao, onde da para desativar. Encerrar: icone da bandeja > Sair, ou
rem  Gerenciador de Tarefas > Processos > <Nome> Office > Finalizar tarefa (os servidores caem juntos).
rem ============================================================================================
setlocal EnableExtensions
cd /d "%~dp0"
call "%~dp0nome.cmd"
set "EXE=%NOME%Office.exe"
set "RUNKEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
if /i "%~1"=="/remover-inicio" goto :remover
tasklist /fi "imagename eq %EXE%" 2>nul | find /i "%EXE%" >nul && goto :aberto
call "%~dp0build.cmd" || (echo Falha ao compilar. & exit /b 1)
echo Compilado: %~dp0%EXE%
if /i not "%~1"=="/iniciar-com-windows" goto :fim
reg add "%RUNKEY%" /v %NOME%Office /t REG_SZ /d "\"%~dp0%EXE%\"" /f >nul && echo Ligado: o %NOME% Office abre quando voce entrar no Windows.
start "" "%~dp0%EXE%"
echo Aberto: veja o losango na bandeja e o atalho "%NOME% Office" no menu Iniciar.
:fim
echo Abrir agora: %EXE%   ^|   desligar o inicio: instalar.cmd /remover-inicio
exit /b 0
:aberto
echo O %NOME% Office esta aberto: saia pelo icone da bandeja (Sair) e rode de novo para recompilar.
exit /b 1
:remover
reg delete "%RUNKEY%" /v %NOME%Office /f >nul 2>nul && echo Inicio automatico desligado. || echo Inicio automatico ja estava desligado.
exit /b 0
