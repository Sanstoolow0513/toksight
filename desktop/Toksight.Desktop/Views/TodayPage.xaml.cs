using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Toksight.Desktop.Services;

namespace Toksight.Desktop.Views;

public sealed partial class TodayPage : UserControl, IDesktopPage
{
    private readonly DesktopApi _api;
    private readonly DesktopPreferences _preferences;
    private CancellationTokenSource? _request;
    private int _version;
    private bool _quotaBusy;
    private bool _hasReport;
    public bool IsLoading { get; private set; }
    public FrameworkElement? ExportElement
    {
        get
        {
            if (!_hasReport || IsLoading || ErrorBar.IsOpen) return null;
            ReportUi.FinishAnimations(ReportPanel); return ReportPanel;
        }
    }

    public TodayPage(DesktopApi api, DesktopPreferences preferences)
    {
        InitializeComponent(); _api = api; _preferences = preferences;
        RetryButton.Content = preferences.T("重试", "Retry");
    }
    public async Task ReloadAsync()
    {
        _request?.Cancel(); _request?.Dispose(); _request = new CancellationTokenSource();
        var token = _request.Token; var version = ++_version;
        IsLoading = true; LoadingBar.Visibility = Visibility.Visible; ErrorBar.IsOpen = false;
        try
        {
            var todayTask = _api.GetAsync(_api.ReportQuery("today"), token);
            var trendTask = _api.GetAsync(_api.ReportQuery("30d"), token);
            await Task.WhenAll(todayTask, trendTask);
            var data = await todayTask; var trend = await trendTask;
            if (version != _version || token.IsCancellationRequested) return;
            Render(data, trend); _hasReport = true;
            await LoadQuotaAsync(token);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { if (version == _version) { ErrorBar.Message = ex.Message; ErrorBar.IsOpen = true; } }
        finally { if (version == _version) { IsLoading = false; LoadingBar.Visibility = Visibility.Collapsed; } }
    }
    private void Render(JsonNode data, JsonNode trend)
    {
        var p = _preferences; ReportPanel.Children.Clear();
        ReportPanel.Children.Add(ReportUi.Kpis(data, p, true));
        var hourly = ReportUi.Hourly(data, p); var breakdown = ReportUi.Breakdown(data, p);
        var analysis = ReportUi.Columns(hourly, breakdown); analysis.ColumnDefinitions[0].Width = new GridLength(2, GridUnitType.Star);
        analysis.SizeChanged += (_, e) =>
        {
            var compact = e.NewSize.Width < 720;
            if (analysis.RowDefinitions.Count == (compact ? 2 : 0)) return;
            analysis.RowDefinitions.Clear(); analysis.ColumnDefinitions.Clear(); analysis.ColumnDefinitions.Add(new ColumnDefinition());
            if (compact) { analysis.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); analysis.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); analysis.RowSpacing = 16; Grid.SetColumn(breakdown, 0); Grid.SetRow(breakdown, 1); }
            else { analysis.ColumnDefinitions[0].Width = new GridLength(2, GridUnitType.Star); analysis.ColumnDefinitions.Add(new ColumnDefinition()); Grid.SetColumn(breakdown, 1); Grid.SetRow(breakdown, 0); }
        };
        ReportPanel.Children.Add(analysis);
        if (ReportUi.N(data["totals"], "requests") == 0) ReportPanel.Children.Add(ReportUi.Text(p.T("今天还没有会话记录。可以刷新以重新扫描本机 Agent。", "No sessions today. Refresh to scan local agents again."), 14, true));
        ReportPanel.Children.Add(ReportUi.Agents(data, p));
        ReportPanel.Children.Add(ReportUi.Sessions(data, p));
        var trendPanel = ReportUi.Panel("", out var trendBody);
        var metric = 0;
        var host = new ContentControl { HorizontalContentAlignment = HorizontalAlignment.Stretch };
        void DrawTrend() => host.Content = ReportUi.Chart(ReportUi.A(trend["selection"], "rows"), metric == 1, "tokens", row => ReportUi.S(row, "date"), p, 88);
        var segmented = ReportUi.Segmented(["Tokens", p.T("费用", "Cost")], 0, index => { metric = index; DrawTrend(); });
        trendBody.Children.Add(ReportUi.Header(p.T("近 30 天趋势", "Last 30 days"), "Activity", null, segmented));
        trendBody.Children.Add(host); DrawTrend();
        ReportPanel.Children.Add(trendPanel);
        foreach (var warning in ReportUi.A(data, "warnings")) ReportPanel.Children.Add(ReportUi.Text(warning.ToString(), 13, true));
        ReportPanel.Children.Add(ReportUi.Text($"toksight {ReportUi.S(data, "version")} · {p.T("刷新于", "Refreshed")} {ReportUi.Stamp(data["snapshot"]?["refreshedAt"], p.TimeZone)}\n{p.T("本机处理 · 费用仅供参考", "Processed locally · Costs are estimates")}", 13, true));
    }
    private async Task LoadQuotaAsync(CancellationToken token)
    {
        try { var data = await _api.GetAsync("/api/quota", token); if (!token.IsCancellationRequested) RenderQuota(data); }
        catch (OperationCanceledException) { }
        catch (Exception ex) { if (!token.IsCancellationRequested) { QuotaPanel.Children.Clear(); QuotaPanel.Children.Add(ReportUi.Text(_preferences.T("额度加载失败：", "Could not load quotas: ") + ex.Message)); } }
    }
    private void RenderQuota(JsonNode data)
    {
        var p = _preferences; QuotaPanel.Children.Clear();
        var panel = ReportUi.Panel("", out var body);
        var refresh = ReportUi.Ghost(p.T("刷新 Kimi 额度", "Refresh Kimi quota"), "Refresh");
        refresh.IsEnabled = ReportUi.S(data, "offline") != "true" && !_quotaBusy;
        var message = ReportUi.Text("", 13, true);
        refresh.Click += async (_, _) =>
        {
            if (_quotaBusy) return; _quotaBusy = true; refresh.IsEnabled = false; message.Text = p.T("正在查询…", "Checking…");
            try { var updated = await _api.PostAsync("/api/quota/refresh", null, _request?.Token ?? default); _quotaBusy = false; RenderQuota(updated); }
            catch (OperationCanceledException) { }
            catch (Exception ex) { message.Text = ex.Message; }
            finally { _quotaBusy = false; refresh.IsEnabled = ReportUi.S(data, "offline") != "true"; }
        };
        body.Children.Add(ReportUi.Header(p.T("订阅额度", "Subscription quotas"), "Zap", null, refresh));
        body.Children.Add(message);
        var clients = new Grid { ColumnSpacing = 24, RowSpacing = 14 };
        var clientPanels = new List<StackPanel>();
        foreach (var quota in ReportUi.A(data, "quotas"))
        {
            var client = new StackPanel { Spacing = 8 };
            client.Children.Add(ReportUi.Header(ReportUi.S(quota, "label"), "", null, ReportUi.Text(ReportUi.S(quota, "plan"), 13, true)));
            foreach (var window in ReportUi.A(quota, "windows"))
            {
                var used = window["usedPercent"];
                var name = ReportUi.S(window, "label");
                var line = new Grid { ColumnSpacing = 12, RowSpacing = 3 };
                line.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(52) }); line.ColumnDefinitions.Add(new ColumnDefinition()); line.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                line.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); line.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                line.Children.Add(ReportUi.Text(name, 13, true));
                var meter = new ProgressBar { Minimum = 0, Maximum = 100, Value = Math.Clamp(ReportUi.N(used), 0, 100), Height = 8, VerticalAlignment = VerticalAlignment.Center, Foreground = ReportUi.B(ReportUi.N(used) >= 80 ? "SignalBrush" : "InkBrush"), Background = ReportUi.B("Surface3Brush") };
                Grid.SetColumn(meter, 1); line.Children.Add(meter);
                var value = ReportUi.Text(used is null ? "—" : $"{ReportUi.N(used):0.#}%", 14); Grid.SetColumn(value, 2); line.Children.Add(value);
                var reset = ReportUi.Text(p.T("重置时间：", "Resets: ") + ReportUi.Stamp(window["resetsAt"], p.TimeZone), 13, true);
                Grid.SetColumn(reset, 1); Grid.SetColumnSpan(reset, 2); Grid.SetRow(reset, 1); line.Children.Add(reset); client.Children.Add(line);
            }
            if (quota["error"] is { } error) client.Children.Add(ReportUi.Text(ReportUi.S(error, "message"), 13, true));
            else client.Children.Add(ReportUi.Text((ReportUi.S(quota, "source") == "local" ? p.T("本地记录 · ", "Local record · ") : p.T("API 查询 · ", "API query · ")) + ReportUi.Stamp(quota["observedAt"] ?? quota["fetchedAt"], p.TimeZone), 13, true));
            clientPanels.Add(client); clients.Children.Add(client);
        }
        void Arrange(double width)
        {
            var columns = width >= 650 ? 2 : 1; clients.ColumnDefinitions.Clear(); clients.RowDefinitions.Clear();
            for (var i = 0; i < columns; i++) clients.ColumnDefinitions.Add(new ColumnDefinition());
            for (var i = 0; i < clientPanels.Count; i++) { if (i % columns == 0) clients.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); Grid.SetColumn(clientPanels[i], i % columns); Grid.SetRow(clientPanels[i], i / columns); }
        }
        var wasWide = true; Arrange(900); clients.SizeChanged += (_, e) => { var wide = e.NewSize.Width >= 650; if (wide == wasWide) return; wasWide = wide; Arrange(e.NewSize.Width); };
        body.Children.Add(clients);
        QuotaPanel.Children.Add(panel);
    }
    private async void Retry_Click(object sender, RoutedEventArgs e) => await ReloadAsync();
    public void OnLeaving() { ++_version; _request?.Cancel(); IsLoading = false; }
}
