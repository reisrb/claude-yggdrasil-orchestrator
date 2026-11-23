// OfficeApp.cs — o Office do orquestrador como app do Windows, independente do terminal.
//
// - Ícone na bandeja (Abrir o Office, Reiniciar o servidor, Simulação, Ver o log, Iniciar com o Windows, Sair).
// - Sobe o servidor do Office dentro do WSL, escondido: wsl.exe --cd <raiz> --exec bash -lic "node .claude/office/server.js"
//   (bash -lic carrega o mesmo ambiente do terminal: node, claude, ferramentas e variáveis do ~/.bashrc).
// - Se o Office já estiver no ar (aberto por uma sessão do terminal), só vigia; quando aquele servidor cair, assume.
// - Simulação: um segundo servidor (--simular), na porta do Office + 10 e com dados próprios (.simulacao), sem Claude
//   e sem tocar nas missões de verdade. Iniciar (normal ou lotada), abrir no navegador e parar, pelo menu.
// - Aparece no Gerenciador de Tarefas: em Processos (encerrar) e em Aplicativos de inicialização (desativar).
//   Encerrar o app derruba os servidores: a entrada (stdin) do wsl.exe fecha e cada servidor recebe o aviso.
// - Atalho no menu Iniciar, criado na primeira abertura: fechou o app, abre de novo por lá.
//
// O nome (Marca.Nome) vem do "nome" do orquestrador.json, gravado pelo build.cmd em Marca.cs: no Odin, "OdinOffice.exe".
// Compila com o C# que já vem no Windows (.NET Framework 4.x, C# 5): build.cmd. Sem dependências.
// Uso: <Nome>Office.exe [--porta N] [--simular]   (as opções vão para o server.js; --simular é para teste)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Programa
{
    [STAThread]
    static void Main(string[] args)
    {
        string raiz = Office.RaizOrquestrador();
        int porta = Office.LerPorta(raiz, args);
        bool novo;
        using (var unico = new Mutex(true, "Local\\" + Marca.Nome + "Office-" + porta, out novo))
        {
            if (!novo) { Office.AbrirNavegador(porta); return; } // já aberto: só abre o navegador
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Office(raiz, porta, args));
        }
    }
}

/// <summary>Um servidor do Office dentro do WSL, preso a este app pela entrada (stdin) do wsl.exe.</summary>
class ServidorWsl
{
    readonly string raiz, log;
    readonly object trava = new object();
    Process wsl;

    public ServidorWsl(string raiz, string log)
    {
        this.raiz = raiz;
        this.log = log;
        try { if (File.Exists(log) && new FileInfo(log).Length > 2000000) File.Delete(log); } catch { }
    }

    public string Log { get { return log; } }
    public bool Vivo { get { return wsl != null && !wsl.HasExited; } }

    public bool Subir(string opcoes, string rotulo)
    {
        try
        {
            // o servidor roda em segundo plano dentro do bash; o "cat" espera a entrada fechar
            // (o app saiu, foi encerrado ou mandou parar) e então derruba o servidor
            string comando = "node .claude/office/server.js " + opcoes + " & p=$!; cat >/dev/null; kill $p 2>/dev/null; wait $p";
            // --exec: sem o shell padrão no meio (senão ele expandiria o $! e o $p antes do bash -lic)
            var psi = new ProcessStartInfo(CaminhoWsl(), "--cd \"" + raiz + "\" --exec bash -lic \"" + comando + "\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardInput = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            wsl = Process.Start(psi);
            wsl.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { Registrar(e.Data); };
            wsl.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { Registrar(e.Data); };
            wsl.BeginOutputReadLine();
            wsl.BeginErrorReadLine();
            Registrar("== " + DateTime.Now.ToString("dd/MM HH:mm:ss") + " " + rotulo);
            return true;
        }
        catch (Exception e)
        {
            Registrar("== falha ao iniciar o wsl.exe: " + e.Message);
            return false;
        }
    }

    public void Parar()
    {
        if (wsl == null) return;
        try
        {
            if (!wsl.HasExited)
            {
                wsl.StandardInput.Close();              // o "cat" termina e o servidor recebe o kill
                if (!wsl.WaitForExit(6000)) wsl.Kill();
            }
        }
        catch { }
        wsl = null;
    }

    public void Registrar(string linha)
    {
        if (linha == null) return;
        lock (trava) { try { File.AppendAllText(log, linha + Environment.NewLine); } catch { } }
    }

    static string CaminhoWsl()
    {
        string sys = Environment.GetFolderPath(Environment.SpecialFolder.System);
        if (Environment.Is64BitOperatingSystem && !Environment.Is64BitProcess)
            sys = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Sysnative");
        string caminho = Path.Combine(sys, "wsl.exe");
        return File.Exists(caminho) ? caminho : "wsl.exe";
    }
}

class Office : ApplicationContext
{
    const string CHAVE_RUN = @"Software\Microsoft\Windows\CurrentVersion\Run";
    static readonly string NOME_APP = Marca.Nome + " Office";   // na bandeja, no atalho e nas mensagens
    static readonly string NOME_RUN = Marca.Nome + "Office";    // valor no registro (Aplicativos de inicialização)

    readonly string extras;
    readonly int porta, portaSim;
    readonly ServidorWsl principal, simulacao;
    readonly NotifyIcon icone;
    readonly ToolStripMenuItem itemStatus, itemInicio, menuSim, itemSimStatus, itemSimIniciar, itemSimLotada, itemSimAbrir, itemSimParar;
    readonly System.Windows.Forms.Timer relogio, relogioSim;
    readonly Dictionary<int, Icon> icones = new Dictionary<int, Icon>();
    int tentativas;
    int semResposta;                  // verificações seguidas sem resposta
    bool primeira = true;
    DateTime proximaTentativa = DateTime.MinValue;
    DateTime simDesde;
    bool saindo;
    string estado = "";

    public Office(string raiz, int porta, string[] args)
    {
        this.porta = porta;
        portaSim = porta + 10;
        extras = string.Join(" ", args); // --porta N, --simular
        string pasta = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), NOME_RUN);
        Directory.CreateDirectory(pasta);
        principal = new ServidorWsl(raiz, Path.Combine(pasta, args.Length == 0 ? "server.log" : "server-" + porta + ".log"));
        simulacao = new ServidorWsl(raiz, Path.Combine(pasta, "simulacao-" + portaSim + ".log"));
        if (args.Length == 0) GarantirAtalhoMenuIniciar();

        var menu = new ContextMenuStrip();
        itemStatus = new ToolStripMenuItem("Office: verificando…");
        itemStatus.Enabled = false;
        menu.Items.Add(itemStatus);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Abrir o Office", null, delegate { AbrirNavegador(this.porta); });
        menu.Items.Add("Reiniciar o servidor", null, delegate { Reiniciar(); });

        // simulação: servidor separado, sem Claude, com dados próprios
        menuSim = new ToolStripMenuItem("Simulação");
        itemSimStatus = new ToolStripMenuItem("parada");
        itemSimStatus.Enabled = false;
        itemSimIniciar = new ToolStripMenuItem("Iniciar simulação", null, delegate { IniciarSimulacao(""); });
        itemSimLotada = new ToolStripMenuItem("Iniciar simulação lotada (5 projetos × 10 agentes)", null, delegate { IniciarSimulacao("--cenario lotado"); });
        itemSimAbrir = new ToolStripMenuItem("Abrir no navegador", null, delegate { AbrirNavegador(portaSim); });
        itemSimParar = new ToolStripMenuItem("Parar simulação", null, delegate { PararSimulacao(); });
        menuSim.DropDownItems.Add(itemSimStatus);
        menuSim.DropDownItems.Add(new ToolStripSeparator());
        menuSim.DropDownItems.Add(itemSimIniciar);
        menuSim.DropDownItems.Add(itemSimLotada);
        menuSim.DropDownItems.Add(itemSimAbrir);
        menuSim.DropDownItems.Add(itemSimParar);
        menu.Items.Add(menuSim);

        menu.Items.Add("Ver o log", null, delegate { AbrirLog(principal.Log); });
        itemInicio = new ToolStripMenuItem("Iniciar com o Windows", null, delegate { AlternarInicio(); });
        menu.Items.Add(itemInicio);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Sair (para os servidores)", null, delegate { Sair(); });
        menu.Opening += delegate { itemInicio.Checked = IniciaComWindows(); AtualizarMenuSim(); };

        icone = new NotifyIcon();
        icone.ContextMenuStrip = menu;
        icone.Text = NOME_APP;
        icone.Icon = Desenhar(Color.Gray);
        icone.Visible = true;
        icone.DoubleClick += delegate { AbrirNavegador(this.porta); };

        relogio = new System.Windows.Forms.Timer();
        relogio.Interval = 5000;
        relogio.Tick += delegate { Vigiar(); };
        relogio.Start();

        // enquanto a simulação sobe: confere a cada segundo e abre o navegador quando ela responder
        relogioSim = new System.Windows.Forms.Timer();
        relogioSim.Interval = 1000;
        relogioSim.Tick += delegate { EsperarSimulacao(); };

        Vigiar();
    }

    /* ------------------------------------------------------------------ servidor principal */

    void Vigiar()
    {
        if (saindo) return;
        bool nosso = principal.Vivo;
        if (Responde(porta))
        {
            tentativas = 0;
            semResposta = 0;
            primeira = false;
            Mostrar(nosso ? "no ar" : "no ar (aberto por outra sessão; assumo se ela fechar)", Color.Gold);
            return;
        }
        if (nosso) { Mostrar("subindo…", Color.SkyBlue); return; }
        // só assume depois de 3 verificações seguidas sem resposta (15 s): um instante lento
        // do servidor de outra sessão não pode virar um segundo servidor (na abertura, sobe direto)
        if (!primeira && ++semResposta < 3) { Mostrar("sem resposta, conferindo…", Color.SkyBlue); return; }
        primeira = false;
        if (DateTime.Now < proximaTentativa) { Mostrar("fora do ar: tento de novo em instantes (ver o log)", Color.IndianRed); return; }
        tentativas++;
        proximaTentativa = DateTime.Now.AddSeconds(Math.Min(120, 15 * tentativas));
        bool ok = principal.Subir(extras, "servidor iniciado pelo " + NOME_APP + " (tentativa " + tentativas + ")");
        Mostrar(ok ? "subindo…" : "erro ao subir (ver o log)", ok ? Color.SkyBlue : Color.IndianRed);
    }

    void Reiniciar()
    {
        if (!principal.Vivo && Responde(porta))
        {
            MessageBox.Show("O Office está no ar, mas foi aberto por outra sessão (um terminal com o Claude Code).\n\n"
                + "Encerre por lá ou feche aquela sessão: o " + NOME_APP + " assume sozinho em alguns segundos.",
                NOME_APP, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        principal.Parar();
        tentativas = 0;
        semResposta = 0;
        primeira = true;
        proximaTentativa = DateTime.MinValue;
        Vigiar();
    }

    /* ------------------------------------------------------------------ simulação */

    void IniciarSimulacao(string cenario)
    {
        if (simulacao.Vivo || Responde(portaSim)) { AbrirNavegador(portaSim); return; }
        bool ok = simulacao.Subir("--simular --porta " + portaSim + (cenario.Length > 0 ? " " + cenario : ""),
            "simulação iniciada pelo " + NOME_APP + (cenario.Length > 0 ? " (" + cenario + ")" : ""));
        if (!ok) { MessageBox.Show("Não consegui iniciar a simulação. Veja o log em:\n" + simulacao.Log, NOME_APP, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
        simDesde = DateTime.Now;
        relogioSim.Start();
    }

    void EsperarSimulacao()
    {
        if (Responde(portaSim)) { relogioSim.Stop(); AbrirNavegador(portaSim); return; }
        if (!simulacao.Vivo || (DateTime.Now - simDesde).TotalSeconds > 60)
        {
            relogioSim.Stop();
            MessageBox.Show("A simulação não respondeu. Veja o log em:\n" + simulacao.Log, NOME_APP, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    void PararSimulacao()
    {
        relogioSim.Stop();
        simulacao.Parar();
    }

    void AtualizarMenuSim()
    {
        bool viva = simulacao.Vivo;
        bool responde = viva && Responde(portaSim);
        itemSimStatus.Text = responde ? "no ar em http://localhost:" + portaSim : viva ? "subindo…" : "parada";
        menuSim.Text = responde ? "Simulação (no ar)" : "Simulação";
        itemSimIniciar.Enabled = !viva;
        itemSimLotada.Enabled = !viva;
        itemSimAbrir.Enabled = responde;
        itemSimParar.Enabled = viva;
    }

    void Sair()
    {
        saindo = true;
        relogio.Stop();
        relogioSim.Stop();
        simulacao.Parar();
        principal.Parar();
        icone.Visible = false;
        ExitThread();
    }

    /* ------------------------------------------------------------------ apoio */

    static bool Responde(int porta)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + porta + "/state");
            req.Timeout = 1200;
            req.Proxy = null;
            using (var resp = (HttpWebResponse)req.GetResponse()) return (int)resp.StatusCode == 200;
        }
        catch { return false; }
    }

    void Mostrar(string texto, Color cor)
    {
        if (texto == estado) return;
        estado = texto;
        itemStatus.Text = "Office: " + texto;
        string dica = NOME_APP + " · " + texto;
        icone.Text = dica.Length > 63 ? dica.Substring(0, 62) + "…" : dica;
        icone.Icon = Desenhar(cor);
    }

    Icon Desenhar(Color cor)
    {
        Icon pronto;
        if (icones.TryGetValue(cor.ToArgb(), out pronto)) return pronto;
        var bmp = new Bitmap(16, 16);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            var losango = new[] { new Point(8, 1), new Point(15, 8), new Point(8, 15), new Point(1, 8) };
            using (var b = new SolidBrush(cor)) g.FillPolygon(b, losango);
            using (var p = new Pen(Color.FromArgb(70, 50, 10))) g.DrawPolygon(p, losango);
        }
        pronto = Icon.FromHandle(bmp.GetHicon());
        icones[cor.ToArgb()] = pronto;
        return pronto;
    }

    /// <summary>Atalho no menu Iniciar (pasta Programas do usuário), se ainda não existir. Pelo WScript.Shell do Windows.</summary>
    static void GarantirAtalhoMenuIniciar()
    {
        object shell = null, atalho = null;
        try
        {
            string lnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), NOME_APP + ".lnk");
            if (File.Exists(lnk)) return;
            Type tipo = Type.GetTypeFromProgID("WScript.Shell");
            shell = Activator.CreateInstance(tipo);
            atalho = tipo.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
            Type ta = atalho.GetType();
            ta.InvokeMember("TargetPath", BindingFlags.SetProperty, null, atalho, new object[] { Application.ExecutablePath });
            ta.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, atalho, new object[] { Path.GetDirectoryName(Application.ExecutablePath) });
            ta.InvokeMember("Description", BindingFlags.SetProperty, null, atalho, new object[] { NOME_APP + ": o escritório dos agentes (servidor local no WSL)" });
            ta.InvokeMember("Save", BindingFlags.InvokeMethod, null, atalho, null);
        }
        catch { /* sem atalho não é motivo para não abrir */ }
        finally
        {
            if (atalho != null) Marshal.ReleaseComObject(atalho);
            if (shell != null) Marshal.ReleaseComObject(shell);
        }
    }

    static void AbrirLog(string log)
    {
        try { if (!File.Exists(log)) File.WriteAllText(log, ""); Process.Start("notepad.exe", "\"" + log + "\""); } catch { }
    }

    static bool IniciaComWindows()
    {
        using (var k = Registry.CurrentUser.OpenSubKey(CHAVE_RUN)) return k != null && k.GetValue(NOME_RUN) != null;
    }

    static void AlternarInicio()
    {
        using (var k = Registry.CurrentUser.CreateSubKey(CHAVE_RUN))
        {
            if (k.GetValue(NOME_RUN) != null) k.DeleteValue(NOME_RUN, false);
            else k.SetValue(NOME_RUN, "\"" + Application.ExecutablePath + "\"");
        }
    }

    public static void AbrirNavegador(int porta)
    {
        try { Process.Start("http://localhost:" + porta); } catch { }
    }

    /// <summary>A pasta do orquestrador: o exe fica em <raiz>\.claude\office\app-windows\.</summary>
    public static string RaizOrquestrador()
    {
        string aqui = Path.GetDirectoryName(Application.ExecutablePath);
        string raiz = Path.GetFullPath(Path.Combine(aqui, "..", "..", ".."));
        return File.Exists(Path.Combine(raiz, "orquestrador.json")) ? raiz : aqui;
    }

    /// <summary>Porta do --porta, senão a de orquestrador.json, senão 4321.</summary>
    public static int LerPorta(string raiz, string[] args)
    {
        int p;
        for (int i = 0; i + 1 < args.Length; i++)
            if (args[i] == "--porta" && int.TryParse(args[i + 1], out p)) return p;
        try
        {
            var m = Regex.Match(File.ReadAllText(Path.Combine(raiz, "orquestrador.json")), "\"porta\"\\s*:\\s*(\\d+)");
            if (m.Success && int.TryParse(m.Groups[1].Value, out p)) return p;
        }
        catch { }
        return 4321;
    }
}
