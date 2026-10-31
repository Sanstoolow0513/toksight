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
        ReportPanel.Children.Add(ReportUi.Text($"{ReportUi.S(data["view"], "today")} · {p.T("截至", "As of")} {ReportUi.Stamp(data["generatedAt"], p.TimeZone)} · {p.TimeZone}", 15));
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
        var trendPanel = ReportUi.Panel(p.T("近 30 天趋势", "Last 30 days"), out var trendBody);
        var metric = new ComboBox { ItemsSource = new[] { "Tokens", p.T("参考费用", "Reference cost") }, SelectedIndex = 0, MinWidth = 130 };
        trendBody.Children.Add(metric); var host = new ContentControl { HorizontalContentAlignment = HorizontalAlignment.Stretch }; trendBody.Children.Add(host);
        void DrawTrend() => host.Content = ReportUi.Chart(ReportUi.A(trend["selection"], "rows"), metric.SelectedIndex == 1, "tokens", row => ReportUi.S(row, "date"), p, 100);
        metric.SelectionChanged += (_, _) => DrawTrend(); DrawTrend();
        trendBody.Children.Add(ReportUi.Text($"{ReportUi.S(trend["view"], "since")} — {ReportUi.S(trend["view"], "until")}", 13, true));
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
        var panel = ReportUi.Panel(p.T("订阅额度", "Subscription quotas"), out var body);
        var refresh = new Button { Content = p.T("刷新 Kimi 额度", "Refresh Kimi quota"), IsEnabled = ReportUi.S(data, "offline") != "true" && !_quotaBusy };
        var message = ReportUi.Text("", 13, true);
        refresh.Click += async (_, _) =>
        {
            if (_quotaBusy) return; _quotaBusy = true; refresh.IsEnabled = false; message.Text = p.T("正在查询…", "Checking…");
            try { var updated = await _api.PostAsync("/api/quota/refresh", null, _request?.Token ?? default); _quotaBusy = false; RenderQuota(updated); }
            catch (OperationCanceledException) { }
            catch (Exception ex) { message.Text = ex.Message; }
            finally { _quotaBusy = false; refresh.IsEnabled = ReportUi.S(data, "offline") != "true"; }
        };
        body.Children.Add(refresh); body.Children.Add(message);
        foreach (var quota in ReportUi.A(data, "quotas"))
        {
            body.Children.Add(ReportUi.Text(ReportUi.S(quota, "label") + "  " + ReportUi.S(quota, "plan"), 15));
            foreach (var window in ReportUi.A(quota, "windows"))
            {
                var used = window["usedPercent"];
                var name = ReportUi.S(window, "label");
                body.Children.Add(ReportUi.Text($"{name} · {(used is null ? "—" : $"{ReportUi.N(used):0.#}%")}", 13));
                body.Children.Add(new ProgressBar { Minimum = 0, Maximum = 100, Value = Math.Clamp(ReportUi.N(used), 0, 100), Foreground = ReportUi.B(ReportUi.N(used) >= 80 ? "SignalBrush" : "InkBrush") });
                body.Children.Add(ReportUi.Text(p.T("重置时间：", "Resets: ") + ReportUi.Stamp(window["resetsAt"], p.TimeZone), 13, true));
            }
            if (quota["error"] is { } error) body.Children.Add(ReportUi.Text(ReportUi.S(error, "message"), 13, true));
            else body.Children.Add(ReportUi.Text((ReportUi.S(quota, "source") == "local" ? p.T("本地记录 · ", "Local record · ") : p.T("API 查询 · ", "API query · ")) + ReportUi.Stamp(quota["observedAt"] ?? quota["fetchedAt"], p.TimeZone), 13, true));
        }
        QuotaPanel.Children.Add(panel);
    }
    private async void Retry_Click(object sender, RoutedEventArgs e) => await ReloadAsync();
    public void OnLeaving() { ++_version; _request?.Cancel(); IsLoading = false; }
}
