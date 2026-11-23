@echo off
rem Le o "nome" do orquestrador.json (tres pastas acima) e deixa em NOME, sem espacos nem aspas (ex.: Odin).
set "NOME="
for /f "usebackq tokens=1,* delims=:" %%a in (`findstr /r /c:"\"nome\" *:" "%~dp0..\..\..\orquestrador.json"`) do if not defined NOME set "NOME=%%b"
if not defined NOME set "NOME=Orquestrador"
set "NOME=%NOME:"=%"
set "NOME=%NOME:,=%"
set "NOME=%NOME: =%"
exit /b 0
