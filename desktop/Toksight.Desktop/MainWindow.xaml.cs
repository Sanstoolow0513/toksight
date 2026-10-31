using Microsoft.UI;
using Microsoft.UI.Input;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System.Text.Json;
using Toksight.Desktop.Services;
using Toksight.Desktop.Views;
using Windows.Graphics;

namespace Toksight.Desktop;

public sealed partial class MainWindow : Window
{
    private readonly DesktopPreferences preferences = DesktopPreferences.Load();
    private DesktopRuntime? runtime;
    private DesktopApi? api;
    private IDesktopPage? page;
    private readonly CancellationTokenSource lifetime = new();
    private readonly DispatcherTimer clock = new() { Interval = TimeSpan.FromSeconds(30) };
    private string currentPage = "today", preferenceKey = "", currentDay = "", currentZone = "";
    private bool closing, busy, starting, backendStopped;
    private int navigation;
    public MainWindow()
    {
        InitializeComponent();
        Title = "toksight";
        AppWindow.Resize(new SizeInt32(1380, 900));
        if (AppWindow.Presenter is OverlappedPresenter presenter) presenter.PreferredMinimumWidth = 760;
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBar);
        AppWindow.TitleBar.PreferredHeightOption = TitleBarHeightOption.Tall;
        TitleBar.Loaded += (_, _) => UpdateTitleRegions();
        TitleBar.SizeChanged += (_, _) => UpdateTitleRegions();
        AppWindow.Closing += Closing;
        Root.Loaded += async (_, _) => await StartAsync();
        preferences.Changed += PreferencesChanged;
        ApplyPreferences();
        clock.Tick += async (_, _) =>
        {
            if (preferences.TimeZonePreference == "auto") TimeZoneInfo.ClearCachedData();
            var zone = preferences.TimeZone;
            var zoneChanged = currentZone.Length > 0 && currentZone != zone;
            currentZone = zone; ZoneLabel.Text = zone;
            var day = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd");
            try { day = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(preferences.TimeZone)).ToString("yyyy-MM-dd"); } catch (TimeZoneNotFoundException) { }
            if (zoneChanged && api is not null && !busy) await NavigateAsync(currentPage);
            else if (day != currentDay && currentDay.Length > 0 && page is not null && !page.IsLoading && !busy) await ReloadPageAsync();
            currentDay = day;
        };
        clock.Start();
        Root.SizeChanged += (_, e) => RailColumn.Width = new GridLength(e.NewSize.Width < 1050 ? 166 : 206);
        Root.ActualThemeChanged += (_, _) =>
        {
            UpdateCaptionColors();
            if (preferences.Theme == "system" && api is not null) DispatcherQueue.TryEnqueue(async () => await NavigateAsync(currentPage));
        };
    }
    private void UpdateTitleRegions()
    {
        if (Root.XamlRoot is null) return;
        var scale = Root.XamlRoot.RasterizationScale;
        var bounds = TitleActions.TransformToVisual(Root).TransformBounds(new Windows.Foundation.Rect(0, 0, TitleActions.ActualWidth, TitleActions.ActualHeight));
        InputNonClientPointerSource.GetForWindowId(AppWindow.Id).SetRegionRects(NonClientRegionKind.Passthrough,
            [new RectInt32((int)(bounds.X * scale), (int)(bounds.Y * scale), (int)Math.Ceiling(bounds.Width * scale), (int)Math.Ceiling(bounds.Height * scale))]);
        TitleBar.Padding = new Thickness(20, 0, Math.Max(140, AppWindow.TitleBar.RightInset / scale + 12), 0);
        UpdateCaptionColors();
    }
    private void UpdateCaptionColors()
    {
        AppWindow.TitleBar.ButtonBackgroundColor = Colors.Transparent;
        AppWindow.TitleBar.ButtonInactiveBackgroundColor = Colors.Transparent;
        AppWindow.TitleBar.ButtonForegroundColor = Root.ActualTheme == ElementTheme.Dark ? Colors.White : Colors.Black;
    }
    private void ApplyPreferences()
    {
        Root.RequestedTheme = preferences.Theme switch { "light" => ElementTheme.Light, "dark" => ElementTheme.Dark, _ => ElementTheme.Default };
        InsightsLabel.Text = preferences.T("数据洞察", "INSIGHTS");
        WorkspaceLabel.Text = preferences.T("工作台管理", "WORKSPACE");
        TodayLabel.Text = preferences.T("今天", "Today"); CalendarLabel.Text = preferences.T("日历", "Calendar");
        PricesLabel.Text = preferences.T("价格库", "Prices"); SettingsLabel.Text = preferences.T("设置", "Settings");
        LocalNote.Text = preferences.T("在本机读取 Agent 用量。刷新不会修改 Agent 文件。", "Agent usage stays local. Refresh never changes agent files.");
        ZoneLabel.Text = preferences.TimeZone;
        StartupText.Text = preferences.T("正在打开本机用量数据库…", "Opening the local usage database…");
        RetryButton.Content = preferences.T("重试", "Retry");
        AutomationProperties.SetName(RefreshButton, preferences.T("刷新本机用量", "Refresh local usage"));
        AutomationProperties.SetName(ExportButton, preferences.T("导出报表图片", "Export report image"));
        ToolTipService.SetToolTip(RefreshButton, preferences.T("刷新本机用量", "Refresh local usage"));
        ToolTipService.SetToolTip(ExportButton, preferences.T("导出 PNG", "Export PNG"));
        preferenceKey = $"{preferences.Theme}|{preferences.Language}|{preferences.TimeZonePreference}";
    }
    private void PreferencesChanged()
    {
        var changed = preferenceKey != $"{preferences.Theme}|{preferences.Language}|{preferences.TimeZonePreference}";
        ApplyPreferences();
        if (changed && api is not null) DispatcherQueue.TryEnqueue(async () => await NavigateAsync(currentPage));
    }
    private async Task StartAsync()
    {
        if (starting || closing) return;
        starting = true; StartupPanel.Visibility = Visibility.Visible; StartupRing.IsActive = true; RetryButton.Visibility = Visibility.Collapsed;
        EnableActions(false);
        try
        {
            if (runtime is not null) await runtime.DisposeAsync();
            api?.Dispose();
            runtime = new DesktopRuntime();
            backendStopped = false;
            runtime.UnexpectedExit += () => DispatcherQueue.TryEnqueue(() =>
            {
                if (closing) return;
                backendStopped = true;
                if (starting) return;
                page?.OnLeaving(); EnableActions(false);
                StartupPanel.Visibility = Visibility.Visible; StartupRing.IsActive = false; RetryButton.Visibility = Visibility.Visible;
                StartupText.Text = preferences.T("本机数据服务已退出。点击重试以重新启动。", "The local data service stopped. Retry to restart it.");
            });
            var address = await runtime.StartAsync(Environment.GetCommandLineArgs().Contains("--offline"), lifetime.Token);
            api = new DesktopApi(address, runtime.Token, preferences);
            if (closing) return;
            if (!J.Bool(await api.GetAsync("/api/prices/status", lifetime.Token), "completed")) currentPage = "prices";
            StartupPanel.Visibility = Visibility.Collapsed;
            await NavigateAsync(currentPage);
            if (backendStopped || !runtime.IsRunning) throw new InvalidOperationException(preferences.T("本机数据服务已退出，请重试。", "The local data service stopped. Please retry."));
            var args = Environment.GetCommandLineArgs();
            var smoke = Array.IndexOf(args, "--smoke-test");
            if (smoke >= 0 && smoke + 1 < args.Length) await SmokeAsync(args[smoke + 1]);
        }
        catch (OperationCanceledException) when (closing) { }
        catch (Exception ex)
        {
            StartupPanel.Visibility = Visibility.Visible;
            page?.OnLeaving(); EnableActions(false);
            StartupText.Text = ex.Message;
            StartupRing.IsActive = false; RetryButton.Visibility = Visibility.Visible;
            var args = Environment.GetCommandLineArgs(); var smoke = Array.IndexOf(args, "--smoke-test");
            if (smoke >= 0 && smoke + 1 < args.Length) { await File.WriteAllTextAsync(args[smoke + 1], JsonSerializer.Serialize(new { ok = false, error = ex.ToString() })); Close(); }
        }
        finally { starting = false; }
    }
    private async Task NavigateAsync(string destination)
    {
        if (api is null || closing) return;
        page?.OnLeaving();
        var version = ++navigation;
        currentPage = destination;
        page = destination switch
        {
            "calendar" => new CalendarPage(api, preferences),
            "prices" => new PricesPage(api, preferences),
            "settings" => new SettingsPage(api, preferences),
            _ => new TodayPage(api, preferences),
        };
        PageHost.Content = page;
        foreach (var (button, key) in new[] { (TodayButton, "today"), (CalendarButton, "calendar"), (PricesButton, "prices"), (SettingsButton, "settings") })
        {
            button.Foreground = DesktopPalette.Brush(key == destination ? "SignalBrush" : "InkBrush");
            button.Background = key == destination ? DesktopPalette.Brush("SurfaceBrush") : new SolidColorBrush(Colors.Transparent);
        }
        EnableActions(false);
        try { await page.ReloadAsync(); }
        catch (Exception ex) { ShowMessage(ex.Message, true); }
        finally { if (version == navigation) EnableActions(true); }
    }
    private async Task ReloadPageAsync()
    {
        if (page is null) return;
        try { await page.ReloadAsync(); }
        catch (Exception ex) { ShowMessage(ex.Message, true); }
    }
    private void EnableActions(bool enabled)
    {
        RefreshButton.Visibility = currentPage is "today" or "calendar" ? Visibility.Visible : Visibility.Collapsed;
        ExportButton.Visibility = RefreshButton.Visibility;
        RefreshButton.IsEnabled = enabled && !busy;
        ExportButton.IsEnabled = enabled && !busy && currentPage is "today" or "calendar";
        Rail.IsHitTestVisible = api is not null;
    }
    private void ShowMessage(string message, bool error = false)
    {
        Notice.Severity = error ? InfoBarSeverity.Error : InfoBarSeverity.Informational;
        Notice.Message = message; Notice.IsOpen = true;
    }
    private async void RefreshClick(object sender, RoutedEventArgs e)
    {
        if (api is null || busy) return;
        busy = true; EnableActions(false);
        try
        {
            ShowMessage(preferences.T("正在扫描本机用量…", "Scanning local usage…"));
            var result = await api.PostAsync("/api/refresh", cancellationToken: lifetime.Token);
            await ReloadPageAsync();
            ShowMessage(preferences.T("刷新完成，记录数：", "Refresh complete. Records: ") + J.Num(result, "entries").ToString("N0"));
        }
        catch (Exception ex) { if (!closing) ShowMessage(ex.Message, true); }
        finally { busy = false; EnableActions(true); }
    }
    private async void ExportClick(object sender, RoutedEventArgs e)
    {
        if (page?.ExportElement is not FrameworkElement element || page.IsLoading || busy) return;
        busy = true; EnableActions(false);
        try
        {
            var path = await DesktopFiles.PickSaveAsync($"toksight-{currentPage}-{DateTime.Now:yyyy-MM-dd}.png", ".png");
            if (path is null) return;
            await DesktopFiles.ExportPngAsync(element, path);
            ShowMessage(preferences.T("报表图片已保存。", "Report image saved."));
        }
        catch (Exception ex) { ShowMessage(ex.Message, true); }
        finally { busy = false; EnableActions(true); }
    }
    private void ThemeClick(object sender, RoutedEventArgs e)
    {
        try { preferences.Theme = preferences.Theme switch { "system" => "light", "light" => "dark", _ => "system" }; preferences.Save(); }
        catch (Exception ex) { ShowMessage(ex.Message, true); }
    }
    private void LanguageClick(object sender, RoutedEventArgs e)
    {
        try { preferences.Language = preferences.Language == "en" ? "zh-CN" : "en"; preferences.Save(); }
        catch (Exception ex) { ShowMessage(ex.Message, true); }
    }
    private async void TodayClick(object sender, RoutedEventArgs e) => await NavigateAsync("today");
    private async void CalendarClick(object sender, RoutedEventArgs e) => await NavigateAsync("calendar");
    private async void PricesClick(object sender, RoutedEventArgs e) => await NavigateAsync("prices");
    private async void SettingsClick(object sender, RoutedEventArgs e) => await NavigateAsync("settings");
    private async void RetryClick(object sender, RoutedEventArgs e) => await StartAsync();
    private async void Closing(AppWindow sender, AppWindowClosingEventArgs args)
    {
        if (closing) return;
        args.Cancel = true; closing = true; lifetime.Cancel(); clock.Stop(); page?.OnLeaving();
        preferences.Changed -= PreferencesChanged; api?.Dispose();
        if (runtime is not null) await runtime.DisposeAsync();
        Close();
    }
    // Exercises actual XAML controls + the packaged Node service on an isolated fixture home.
    private async Task SmokeAsync(string output)
    {
        var initialPage = currentPage;
        var visited = new List<string>();
        foreach (var variant in new[] { "light", "dark" })
        {
            preferences.Theme = variant;
            preferences.Language = variant == "dark" ? "en" : "zh-CN";
            ApplyPreferences();
            AppWindow.Resize(variant == "dark" ? new SizeInt32(940, 800) : new SizeInt32(1380, 900));
            foreach (var destination in new[] { "today", "calendar", "prices", "settings" })
            {
                await NavigateAsync(destination);
                Root.UpdateLayout();
                // Let loaded templates, virtualization and composition commit before capturing.
                // This wait belongs only to the integration test, never the navigation path.
                await Task.Delay(500, lifetime.Token);
                Root.UpdateLayout();
                foreach (var error in Descendants(PageHost).OfType<InfoBar>().Where(x => x.IsOpen && x.Severity == InfoBarSeverity.Error))
                    throw new InvalidOperationException(destination + ": " + error.Message);
                var bars = Descendants(PageHost).OfType<Button>().Where(button => AutomationProperties.GetName(button).EndsWith("tokens", StringComparison.Ordinal));
                foreach (var bar in bars)
                    if (bar.Content is FrameworkElement content && content.ActualWidth <= 0) throw new InvalidOperationException("Chart bar has no width");
                if (destination == "settings")
                    foreach (var combo in Descendants(PageHost).OfType<ComboBox>())
                    {
                        var bounds = combo.TransformToVisual(Root).TransformBounds(new Windows.Foundation.Rect(0, 0, combo.ActualWidth, combo.ActualHeight));
                        if (bounds.Right > Root.ActualWidth + 1 || bounds.Left < RailColumn.ActualWidth) throw new InvalidOperationException("Settings control exceeds the viewport");
                    }
                var name = (variant == "light" ? "" : "dark-") + destination;
                var screenshot = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(output))!, name + ".png");
                File.WriteAllBytes(screenshot, []);
                await DesktopFiles.ExportPngAsync(Root, screenshot);
                if (variant == "light") visited.Add(destination);
            }
        }
        await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { ok = true, pages = visited, native = true, variants = new[] { "light-wide-zh", "dark-narrow-en" }, initialPage, timezone = preferences.TimeZone }));
        Close();
    }
    private static IEnumerable<DependencyObject> Descendants(DependencyObject root)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        {
            var child = VisualTreeHelper.GetChild(root, i);
            yield return child;
            foreach (var descendant in Descendants(child)) yield return descendant;
        }
    }
}
