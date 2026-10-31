using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Toksight.Desktop.Services;
using Windows.System;

namespace Toksight.Desktop.Views;

public sealed partial class PricesPage : UserControl, IDesktopPage
{
    private readonly DesktopApi _api;
    private readonly DesktopPreferences _preferences;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMinutes(1) };
    private CancellationTokenSource? _read;
    private long _revision;
    private bool _active = true, _busy, _binding, _loading;
    private JsonNode? _status, _catalog;
    private ManagementPrice[] _models = [];
    public bool IsLoading => _loading || _busy;
    public FrameworkElement? ExportElement => null;
    private string T(string zh, string en) => _preferences.T(zh, en);

    public PricesPage(DesktopApi api, DesktopPreferences preferences)
    {
        _api = api; _preferences = preferences;
        InitializeComponent();
        Heading.Text = T("本机价格库", "Local price catalog");
        Search.PlaceholderText = T("搜索模型或厂商", "Search models or providers");
        UsedOnly.Header = T("只看用过的模型", "Used models only");
        UsedOnly.OnContent = T("已开启", "On"); UsedOnly.OffContent = T("已关闭", "Off");
        PreferencesButton.Content = T("价格设置", "Price settings");
        RetryButton.Content = T("重新读取", "Reload");
        UpdateButton.Content = T("更新单价", "Update prices"); ResetButton.Content = T("重置价格库", "Reset catalog");
        SetupHeading.Text = T("建立你的本机价格库", "Set up your local price catalog");
        SetupDescription.Text = T("下载 LiteLLM 第一方模型单价，用于估算缺少自报费用的请求。用量保留在本机；也可先使用本地数据，稍后再下载价格。", "Download first-party model rates from LiteLLM to estimate requests without reported costs. Usage stays on your computer. You can also continue locally and download prices later.");
        SetupAutoUpdate.Content = T("自动检查价格更新", "Automatically check for price updates");
        SetupOnlineButton.Content = T("下载价格并继续", "Download prices and continue");
        SetupLocalButton.Content = T("本地继续", "Continue locally");
        SetupOfflineNote.Text = T("当前是离线会话，不会下载公开单价。可以使用已有本地价格继续。", "This is an offline session. Public rates will not be downloaded; existing local prices remain available.");
        _timer.Tick += async (_, _) => { if (_active && !_busy && !IsLoading && J.Bool(_status, "completed")) await ReloadAsync(); };
    }

    public async Task ReloadAsync()
    {
        if (_busy) return;
        _active = true;
        _read?.Cancel(); _read?.Dispose(); _read = new CancellationTokenSource();
        var token = _read.Token; var revision = ++_revision;
        _loading = true; UpdateBusy();
        try
        {
            var statusTask = _api.GetAsync("/api/prices/status", token);
            var catalogTask = _api.GetAsync("/api/prices", token);
            await Task.WhenAll(statusTask, catalogTask);
            if (!_active || token.IsCancellationRequested || revision != _revision) return;
            _status = await statusTask; _catalog = await catalogTask;
            var selectedProvider = (ProviderFilter.SelectedItem as ManagementChoice)?.Id ?? "";
            _models = J.Items(_catalog, "models").Select(model => new ManagementPrice(model, _preferences)).ToArray();
            _binding = true;
            var providers = new[] { new ManagementChoice("", T("全部厂商", "All providers")) }
                .Concat(_models.Select(m => m.Provider).Distinct().OrderBy(p => p).Select(p => new ManagementChoice(p, p))).ToArray();
            ProviderFilter.ItemsSource = providers;
            ProviderFilter.SelectedItem = providers.FirstOrDefault(p => p.Id == selectedProvider) ?? providers[0];
            _binding = false;
            SetupPanel.Visibility = J.Bool(_status, "completed") ? Visibility.Collapsed : Visibility.Visible;
            SetupAutoUpdate.IsChecked = J.Bool(_status, "autoUpdate");
            var selectedSources = J.Items(_status, "selectedSources").Select(n => n.ToString()).ToHashSet();
            SetupSources.Children.Clear();
            SetupSources.Children.Add(ManagementUi.Text(T("公开价格来源（用户覆盖始终优先）", "Public price sources (user overrides take priority)"), 13, true));
            foreach (var source in J.Items(_status, "availableSources").Select(n => n.ToString()))
                SetupSources.Children.Add(new CheckBox { Tag = source, Content = source == "litellm" ? T("LiteLLM · 第一方模型", "LiteLLM · First-party models") : source, IsChecked = selectedSources.Contains(source) });
            ApplyFilters();
            var warnings = J.Items(_catalog, "warnings").Select(w => w.ToString()).ToArray();
            if (warnings.Length > 0) { Notice.Message = string.Join("\n", warnings); Notice.Severity = InfoBarSeverity.Warning; Notice.IsOpen = true; }
            _timer.Start();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { if (_active && revision == _revision) ManagementUi.Alert(Notice, ex.Message, true); }
        finally { if (revision == _revision) { _loading = false; UpdateBusy(); } }
    }

    public void OnLeaving()
    {
        _active = false; ++_revision; _read?.Cancel(); _timer.Stop(); _loading = false;
    }

    private void ApplyFilters()
    {
        if (_binding || Search == null) return;
        var query = Search.Text.Trim(); var provider = (ProviderFilter.SelectedItem as ManagementChoice)?.Id ?? "";
        var rows = _models.Where(m => (!UsedOnly.IsOn || m.Used) && (provider.Length == 0 || m.Provider == provider) &&
            (query.Length == 0 || m.SearchText.Contains(query, StringComparison.OrdinalIgnoreCase)))
            .OrderByDescending(m => m.Used).ThenBy(m => m.Provider).ThenBy(m => m.Name).ToArray();
        Catalog.ItemsSource = rows;
        Summary.Text = T("美元 / 百万 token", "USD / million tokens") + $" · {rows.Length:N0} / {_models.Length:N0} " + T("模型", "models") +
            " · " + T("最近观察", "Last observed") + " " + ManagementUi.Date(J.Str(_status, "observedAt"), _preferences);
        EmptyMessage.Text = T("没有匹配的模型。可调整筛选或更新价格库。", "No matching models. Adjust the filters or update the price catalog.");
        EmptyMessage.Visibility = rows.Length == 0 && J.Bool(_status, "completed") ? Visibility.Visible : Visibility.Collapsed;
    }

    private void UpdateBusy()
    {
        var busy = _busy || IsLoading;
        BusyIndicator.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
        var offline = J.Bool(_status, "offline");
        UpdateButton.IsEnabled = _status != null && !busy && !offline && J.Bool(_status, "completed");
        ResetButton.IsEnabled = _status != null && !busy && J.Bool(_status, "completed");
        PreferencesButton.IsEnabled = _status != null && !busy && J.Bool(_status, "completed");
        SetupOnlineButton.IsEnabled = _status != null && !busy && !offline;
        SetupLocalButton.IsEnabled = _status != null && !busy;
        SetupAutoUpdate.IsEnabled = !busy;
        SetupSources.IsHitTestVisible = !busy;
        foreach (var source in SetupSources.Children.OfType<CheckBox>()) source.IsEnabled = !busy;
        SetupAutoUpdate.Visibility = offline ? Visibility.Collapsed : Visibility.Visible;
        SetupOnlineButton.Visibility = offline ? Visibility.Collapsed : Visibility.Visible;
        SetupOfflineNote.Visibility = offline ? Visibility.Visible : Visibility.Collapsed;
        RetryButton.IsEnabled = !busy;
    }

    private async Task MutateAsync(string route, object? body, string success)
    {
        if (_busy || IsLoading) return;
        _busy = true; UpdateBusy(); Notice.IsOpen = false;
        try
        {
            await _api.PostAsync(route, body);
            if (_active) ManagementUi.Alert(Notice, success);
        }
        catch (Exception ex) { if (_active) ManagementUi.Alert(Notice, ex.Message, true); }
        finally { _busy = false; UpdateBusy(); if (_active) await ReloadAsync(); }
    }

    private async void Update_Click(object sender, RoutedEventArgs args) => await MutateAsync("/api/prices/update", null, T("价格库已更新。", "Price catalog updated."));
    private async void Retry_Click(object sender, RoutedEventArgs args) { Notice.IsOpen = false; await ReloadAsync(); }
    private string[] SetupSourceSelection() => SetupSources.Children.OfType<CheckBox>().Where(c => c.IsChecked == true).Select(c => (string)c.Tag).ToArray();
    private async void SetupOnline_Click(object sender, RoutedEventArgs args) => await MutateAsync("/api/setup", new { offline = false, autoUpdate = SetupAutoUpdate.IsChecked == true, selectedSources = SetupSourceSelection() }, T("价格库已就绪。", "Price catalog is ready."));
    private async void SetupLocal_Click(object sender, RoutedEventArgs args) => await MutateAsync("/api/setup", new { offline = true, autoUpdate = J.Bool(_status, "offline") || SetupAutoUpdate.IsChecked == true, selectedSources = SetupSourceSelection() }, T("已使用本地价格继续。", "Continued with local prices."));

    private async void Reset_Click(object sender, RoutedEventArgs args)
    {
        try
        {
            if (await ManagementUi.ConfirmAsync(this, _preferences, T("重置价格库？", "Reset the price catalog?"),
                T("将清除本机下载的单价、观察历史与下载缓存，重新显示初始化引导。用量记录和导入记录会保留。", "This clears downloaded rates, observation history, and download caches, then returns to setup. Usage and imported records are retained."), T("重置", "Reset")))
                await MutateAsync("/api/prices/reset", null, T("价格库已重置。", "Price catalog reset."));
        }
        catch (Exception ex) { ManagementUi.Alert(Notice, ex.Message, true); }
    }

    private async void Preferences_Click(object sender, RoutedEventArgs args)
    {
        if (_status == null || _busy) return;
        try
        {
            var content = new StackPanel { Spacing = 16, MinWidth = 340 };
            var autoUpdate = new CheckBox { Content = T("自动检查价格更新", "Automatically check for price updates"), IsChecked = J.Bool(_status, "autoUpdate") };
            content.Children.Add(autoUpdate);
            content.Children.Add(ManagementUi.Text(T("选择用于估算费用的公开价格来源。用户覆盖始终优先。", "Select public price sources for cost estimates. User overrides always take priority."), 14, true));
            var selected = J.Items(_status, "selectedSources").Select(n => n.ToString()).ToHashSet();
            var sources = J.Items(_status, "availableSources").Select(n => n.ToString()).Select(id => new CheckBox { Content = id == "litellm" ? T("LiteLLM · 第一方模型", "LiteLLM · First-party models") : id, Tag = id, IsChecked = selected.Contains(id) }).ToArray();
            foreach (var check in sources) content.Children.Add(check);
            var dialog = new ContentDialog { XamlRoot = XamlRoot, RequestedTheme = ActualTheme, Title = T("价格设置", "Price settings"), Content = content,
                PrimaryButtonText = T("保存", "Save"), CloseButtonText = T("取消", "Cancel"), DefaultButton = ContentDialogButton.Primary };
            if (await dialog.ShowAsync() == ContentDialogResult.Primary)
                await MutateAsync("/api/setup", new { offline = true, autoUpdate = autoUpdate.IsChecked == true, selectedSources = sources.Where(c => c.IsChecked == true).Select(c => (string)c.Tag).ToArray() }, T("价格偏好已保存。", "Price preferences saved."));
        }
        catch (Exception ex) { ManagementUi.Alert(Notice, ex.Message, true); }
    }

    private void Filters_Changed(object sender, TextChangedEventArgs args) => ApplyFilters();
    private void Provider_Changed(object sender, SelectionChangedEventArgs args) => ApplyFilters();
    private void Used_Toggled(object sender, RoutedEventArgs args) => ApplyFilters();

    private void Details_DataContextChanged(FrameworkElement sender, DataContextChangedEventArgs args)
    {
        // ListView recycles templates; never retain another model's expanded detail tree.
        if (sender is Expander expander) { expander.IsExpanded = false; expander.Content = null; }
    }

    private void Details_Expanding(Expander sender, ExpanderExpandingEventArgs args)
    {
        if (sender.Content != null || sender.DataContext is not ManagementPrice model) return;
        var record = model.Raw;
        var body = new StackPanel { Spacing = 12 };
        foreach (var tier in J.Items(record, "contextTiers"))
        {
            var threshold = J.Num(tier, "contextOver").ToString("N0", CultureInfo.InvariantCulture);
            body.Children.Add(ManagementUi.Text(T("上下文 ", "Context ") + (J.Bool(tier, "inclusive") ? "≥ " : "> ") + threshold, 14));
            body.Children.Add(ManagementUi.Rates(tier, _preferences));
        }
        var official = record["official"];
        if (J.Bool(official, "unresolvedLongContext")) body.Children.Add(ManagementUi.Text(T("长上下文计价尚未确定。", "Long-context pricing is unresolved."), 13, true));
        if (official?["cacheWrite1h"] != null) body.Children.Add(ManagementUi.Text(T("1 小时缓存写入：", "1-hour cache write: ") + ManagementUi.Rate(official, "cacheWrite1h"), 13));
        foreach (var rule in J.Items(official, "rules"))
        {
            var conditions = new List<string>();
            if (rule["contextOver"] != null) conditions.Add(T("上下文 > ", "Context > ") + J.Num(rule, "contextOver").ToString("N0"));
            if (rule["utcStart"] != null) conditions.Add("UTC " + Clock(J.Num(rule, "utcStart")) + "–" + Clock(J.Num(rule, "utcEnd")));
            if (rule["utcDays"] != null) conditions.Add(string.Join(", ", J.Items(rule, "utcDays").Select(n => n.ToString())));
            body.Children.Add(ManagementUi.Text(conditions.Count > 0 ? string.Join(" · ", conditions) : T("所有请求", "All requests"), 13, true));
            body.Children.Add(ManagementUi.Rates(rule, _preferences));
        }
        if (J.Bool(record, "cacheReadFallback") || J.Bool(record, "cacheWriteFallback")) body.Children.Add(ManagementUi.Text(T("* 未提供独立缓存价，使用回退费率。", "* A fallback rate is used where a separate cache price is unavailable."), 13, true));
        var names = J.Items(record, "names").Select(n => n.ToString()).ToArray();
        body.Children.Add(ManagementUi.Text(T("目录 ID：", "Catalog IDs: ") + (names.Length > 0 ? string.Join(" · ", names) : model.Name), 13, true));
        var aliases = J.Items(record, "usedAs").Concat(J.Items(official, "aliases")).Select(n => n.ToString()).Distinct().ToArray();
        if (aliases.Length > 0) body.Children.Add(ManagementUi.Text(T("日志名与别名：", "Log names and aliases: ") + string.Join(" · ", aliases), 13, true));
        var maxInput = J.Num(record, "maxInputTokens");
        if (maxInput > 0) body.Children.Add(ManagementUi.Text(T("最大输入：", "Maximum input: ") + maxInput.ToString("N0"), 13, true));
        else if (J.Num(record, "maxTokens") > 0) body.Children.Add(ManagementUi.Text(T("上下文窗口：", "Context window: ") + J.Num(record, "maxTokens").ToString("N0"), 13, true));
        if (J.Bool(official, "retained")) body.Children.Add(ManagementUi.Text(T("保留的历史模型，公开目录可能不再提供。", "Retained historical model; it may no longer be offered in the public catalog."), 13, true));
        foreach (var (key, zh, en) in new[] { ("endpoint", "端点：", "Endpoint: "), ("reference", "备注：", "Reference: ") })
        {
            var value = J.Str(official, key); if (value.Length > 0) body.Children.Add(ManagementUi.Text(T(zh, en) + value, 13, true));
        }
        var source = J.Str(official, "url", J.Str(_catalog?["updates"]?[model.Source], "url"));
        if (Uri.TryCreate(source, UriKind.Absolute, out var sourceUri) && sourceUri.Scheme == "https")
        {
            var link = new HyperlinkButton { Content = T("查看定价来源 ↗", "View price source ↗"), NavigateUri = sourceUri, Padding = new Thickness(0) };
            body.Children.Add(link);
        }
        var historyPanel = new StackPanel { Spacing = 10 };
        var historyButton = new Button { Content = T("加载价格观察历史", "Load observed price history") };
        var ids = J.Items(record, "ids").Select(n => n.ToString()).ToArray();
        if (ids.Length == 0) ids = [J.Str(record, "id")];
        var idPicker = new ComboBox { ItemsSource = ids, SelectedIndex = 0, HorizontalAlignment = HorizontalAlignment.Stretch };
        if (ids.Length > 1) body.Children.Add(idPicker);
        historyButton.Click += async (_, _) =>
        {
            historyButton.IsEnabled = false;
            try
            {
                var response = await _api.GetAsync("/api/prices?key=" + Uri.EscapeDataString(idPicker.SelectedItem?.ToString() ?? ids[0]), _read?.Token ?? CancellationToken.None);
                if (!_active) return;
                historyPanel.Children.Clear();
                foreach (var item in J.Items(response, "history"))
                {
                    historyPanel.Children.Add(ManagementUi.Text(ManagementUi.Date(J.Str(item, "observedAt"), _preferences), 13, true));
                    historyPanel.Children.Add(ManagementUi.Rates(item["record"], _preferences));
                }
                if (historyPanel.Children.Count == 0) historyPanel.Children.Add(ManagementUi.Text(T("还没有观察历史。", "No observation history yet."), 13, true));
                historyPanel.Children.Insert(0, ManagementUi.Text(T("记录的是本机观察时间，并非提供商生效日期。", "Dates show local observation times, not provider effective dates."), 13, true));
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { ManagementUi.Alert(Notice, ex.Message, true); }
            finally { historyButton.IsEnabled = true; }
        };
        body.Children.Add(historyButton); body.Children.Add(historyPanel);
        sender.Content = body;
    }

    private static string Clock(double raw) => $"{(int)raw / 100:00}:{(int)raw % 100:00}";
}
