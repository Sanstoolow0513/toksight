using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Toksight.Desktop.Services;

// The child's stdin is a lifetime lease: losing the host closes it and stops the service.
// Credentials never appear on the command line, in the URL, or in persisted preferences.
public sealed class DesktopRuntime : IAsyncDisposable
{
    private Process? process;
    private readonly Queue<string> diagnostics = new();
    private bool stopping;
    public string Token { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    public bool IsRunning => process is not null && !process.HasExited;
    public event Action? UnexpectedExit;
    public async Task<Uri> StartAsync(bool offline, CancellationToken cancellationToken)
    {
        var root = Path.Combine(AppContext.BaseDirectory, "backend");
        var node = Path.Combine(root, "node.exe");
        var entry = Path.Combine(root, "desktop", "service.mjs");
        if (!File.Exists(node) || !File.Exists(entry)) throw new FileNotFoundException("Desktop runtime is missing. Run npm run desktop:build from the repository.");
        var start = new ProcessStartInfo(node)
        {
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
        };
        start.ArgumentList.Add(entry);
        // Desktop owns the runtime flags; do not inherit terminal-specific Node injection.
        start.Environment.Remove("NODE_OPTIONS");
        start.Environment.Remove("NODE_PATH");
        process = new Process { StartInfo = start, EnableRaisingEvents = true };
        process.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            lock (diagnostics) { diagnostics.Enqueue(e.Data); while (diagnostics.Count > 20) diagnostics.Dequeue(); }
        };
        process.Exited += (_, _) => { if (!stopping) UnexpectedExit?.Invoke(); };
        process.Start();
        process.BeginErrorReadLine();
        var options = new
        {
            token = Token, offline,
            configDir = Environment.GetEnvironmentVariable("TOKSIGHT_CONFIG_DIR"),
            home = Environment.GetEnvironmentVariable("TOKSIGHT_DESKTOP_HOME"),
        };
        await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(options, new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull }));
        await process.StandardInput.FlushAsync(cancellationToken);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(3));
        try
        {
            var line = await process.StandardOutput.ReadLineAsync(timeout.Token);
            var message = line is null ? null : JsonNode.Parse(line);
            if (J.Str(message, "type") != "ready" || !Uri.TryCreate(J.Str(message, "url"), UriKind.Absolute, out var address)
                || address.Scheme != "http" || address.Host != "127.0.0.1" || address.Port < 1)
                throw new InvalidOperationException("Local data service did not start. " + DiagnosticText());
            return address;
        }
        catch { await DisposeAsync(); throw; }
    }
    private string DiagnosticText() { lock (diagnostics) return string.Join(Environment.NewLine, diagnostics); }
    public async ValueTask DisposeAsync()
    {
        if (stopping) return;
        stopping = true;
        var child = process;
        if (child is null) return;
        try
        {
            if (!child.HasExited)
            {
                await child.StandardInput.WriteLineAsync("{\"type\":\"shutdown\"}");
                child.StandardInput.Close();
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(7));
                try { await child.WaitForExitAsync(timeout.Token); }
                catch (OperationCanceledException) { if (!child.HasExited) child.Kill(entireProcessTree: true); }
            }
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
        finally { child.Dispose(); process = null; }
    }
}
