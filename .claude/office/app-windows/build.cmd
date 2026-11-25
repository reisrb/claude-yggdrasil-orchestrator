@echo off
rem Compila o <Nome>Office.exe com o C# que ja vem no Windows (.NET Framework 4.x). Sem dependencias.
rem O nome vem do "nome" do orquestrador.json (no Odin: OdinOffice.exe); o Marca.cs e gerado aqui.
setlocal
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" (echo csc.exe nao encontrado. & exit /b 1)
cd /d "%~dp0"
call "%~dp0nome.cmd"
> Marca.cs echo // gerado pelo build.cmd a partir do "nome" do orquestrador.json: nao editar
>>Marca.cs echo [assembly: System.Reflection.AssemblyTitle("%NOME% Office")]
>>Marca.cs echo [assembly: System.Reflection.AssemblyProduct("%NOME% Office")]
>>Marca.cs echo [assembly: System.Reflection.AssemblyDescription("Office do orquestrador: servidor local (WSL ou Windows) com icone na bandeja")]
>>Marca.cs echo [assembly: System.Reflection.AssemblyVersion("1.1.0.0")]
>>Marca.cs echo static class Marca { public const string Nome = "%NOME%"; }
"%CSC%" /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ /warn:4 /out:%NOME%Office.exe /r:System.Windows.Forms.dll /r:System.Drawing.dll OfficeApp.cs Marca.cs
if errorlevel 1 exit /b 1
endlocal & set "NOMEEXE=%NOME%Office.exe"
exit /b 0
