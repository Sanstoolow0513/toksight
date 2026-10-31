using Microsoft.UI.Xaml;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Text;
using Toksight.Desktop.Services;

namespace Toksight.Desktop;

public partial class App : Application
{
    public static MainWindow MainWindow { get; private set; } = null!;
    private Mutex? instance;
    public App()
    {
        InitializeComponent();
        UnhandledException += (_, e) =>
        {
            try
            {
                Directory.CreateDirectory(DesktopPreferences.DataDirectory);
                File.WriteAllText(Path.Combine(DesktopPreferences.DataDirectory, "last-error.txt"), e.Exception.ToString());
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
            // Do not hide programming errors and continue with a corrupt UI state.
        };
    }
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var user = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
        var config = Environment.GetEnvironmentVariable("TOKSIGHT_CONFIG_DIR") ?? "default";
        var profile = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(config)))[..16];
        instance = new Mutex(false, @"Local\toksight.desktop." + user + "." + profile);
        bool acquired;
        try { acquired = instance.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
        if (!acquired)
        {
            foreach (var process in Process.GetProcessesByName(Process.GetCurrentProcess().ProcessName))
            {
                if (process.Id == Environment.ProcessId || process.MainWindowHandle == IntPtr.Zero) continue;
                ShowWindow(process.MainWindowHandle, 9);
                SetForegroundWindow(process.MainWindowHandle);
                break;
            }
            Exit();
            return;
        }
        MainWindow = new MainWindow();
        MainWindow.Closed += (_, _) => { instance.ReleaseMutex(); instance.Dispose(); };
        MainWindow.Activate();
    }
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
}
