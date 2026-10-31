using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
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
    private string? _provider;
    private bool _allModels;
    private int _columns = 2;
    private readonly HashSet<string> _expanded = [];
    public bool IsLoading => _loading || _busy;
    public FrameworkElement? ExportElement => null;
    private string T(string zh, string en) => _preferences.T(zh, en);

    public PricesPage(DesktopApi api, DesktopPreferences preferences)
    {
        _api = api; _preferences = preferences;
        InitializeComponent();
        Search.PlaceholderText = T("搜索模型或厂商", "Search models or providers");
        AutomationProperties.SetName(Search, Search.PlaceholderText);
        SearchIcon.Content = NativeIcons.Create("Search", 15);
        SetupIcon.Content = NativeIcons.Create("Database", 24, "SignalInkBrush");
        ManagementUi.IconButton(PreferencesButton, "Settings", T("价格设置", "Price settings"));
        ManagementUi.IconButton(UpdateButton, "Refresh", T("更新单价", "Update prices"));
        ManagementUi.IconButton(ResetButton, "Database", T("重置价格库", "Reset catalog"));
        AutomationProperties.SetName(UsedOnly, T("只看用过的模型", "Used models only"));
        RetryButton.Content = T("重新读取", "Reload");
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
            _models = J.Items(_catalog, "models").Select(model => new ManagementPrice(model, _preferences)).ToArray();
            SetupPanel.Visibility = J.Bool(_status, "completed") ? Visibility.Collapsed : Visibility.Visible;
            FilterPanel.Visibility = J.Bool(_status, "completed") ? Visibility.Visible : Visibility.Collapsed;
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
        if (_binding || Catalog == null || UsedOnly == null || ProviderChips == null) return;
        var words = Search.Text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var usedCount = _models.Count(m => m.Used);
        var usedOnly = usedCount > 0 && !_allModels;
        _binding = true; UsedOnly.IsChecked = usedOnly; UsedOnly.Visibility = usedCount > 0 ? Visibility.Visible : Visibility.Collapsed;
        PaintUsedSwitch(); _binding = false;
        var scoped = _models.Where(m => !usedOnly || m.Used).ToArray();
        var groups = scoped.GroupBy(m => m.Provider).Select(g => new ManagementProvider(g.Key, ManagementUi.ProviderName(g.Key), g.OrderBy(m => m.Name).ToArray()))
            .OrderByDescending(g => g.Models.Any(m => m.Used)).ThenBy(g => g.Name).ToArray();
        if (_provider != null && !groups.Any(g => g.Id == _provider)) _provider = null;
        ProviderChips.Children.Clear();
        ProviderChips.Children.Add(ProviderChip(null, T("全部", "All"), scoped.Length));
        foreach (var group in groups) ProviderChips.Children.Add(ProviderChip(group.Id, group.Name, group.Models.Length));
        var rows = new List<ManagementCatalogRow>(); var matched = 0;
        var preview = !usedOnly && words.Length == 0 && _provider == null;
        foreach (var group in groups.Where(g => _provider == null || g.Id == _provider))
        {
            var models = group.Models.Where(m => words.All(word => m.SearchText.Contains(word, StringComparison.OrdinalIgnoreCase))).ToArray();
            if (models.Length == 0) continue;
            matched += models.Length;
            rows.Add(new ManagementCatalogRow(group with { Models = models }, [], _columns));
            var tiles = models.Take(preview ? 5 : models.Length).Cast<object>().ToList();
            if (tiles.Count < models.Length) tiles.Add(new ManagementMore(group, models.Length - tiles.Count));
            for (var index = 0; index < tiles.Count; index += _columns) rows.Add(new ManagementCatalogRow(null, tiles.Skip(index).Take(_columns).ToArray(), _columns));
        }
        Catalog.ItemsSource = rows;
        Summary.Text = T("美元 / 百万 token", "USD / million tokens") + $" · {matched:N0} / {_models.Length:N0} " + T("模型", "models") +
            " · " + T("价格更新于", "Prices updated") + " " + ManagementUi.Date(J.Str(_catalog, "updates.litellm.fetchedAt", J.Str(_status, "observedAt")), _preferences);
        ToolTipService.SetToolTip(Summary, Summary.Text);
        EmptyMessage.Text = T("没有匹配的模型。可调整筛选或更新价格库。", "No matching models. Adjust the filters or update the price catalog.");
        EmptyPanel.Visibility = rows.Count == 0 && J.Bool(_status, "completed") ? Visibility.Visible : Visibility.Collapsed;
        Catalog.Visibility = J.Bool(_status, "completed") ? Visibility.Visible : Visibility.Collapsed;
    }

    private void PaintUsedSwitch()
    {
        var active = UsedOnly.IsChecked == true;
        var track = new Border { Width = 30, Height = 18, CornerRadius = new CornerRadius(9), Background = ManagementUi.Brush(active ? "SignalBrush" : "LineBrush"),
            Child = new Border { Width = 14, Height = 14, CornerRadius = new CornerRadius(7), Background = ManagementUi.Brush("SurfaceBrush"),
                HorizontalAlignment = active ? HorizontalAlignment.Right : HorizontalAlignment.Left, Margin = new Thickness(2) } };
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        content.Children.Add(track); var label = ManagementUi.Text(T("只看用过的模型", "Used models only"), 14); label.IsTextSelectionEnabled = false;
        content.Children.Add(label); UsedOnly.Content = content;
    }

    private ToggleButton ProviderChip(string? id, string title, int count)
    {
        var active = id == _provider;
        var chip = new ToggleButton { IsChecked = active, MinHeight = 30, MinWidth = 0, Padding = new Thickness(10, 4, 10, 4), CornerRadius = new CornerRadius(15),
            BorderThickness = new Thickness(0), Background = ManagementUi.Brush(active ? "InkBrush" : "Surface2Brush") };
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7 };
        if (id != null && !active) content.Children.Add(ManagementUi.Logo(id, size: 16));
        var text = ManagementUi.Text(title, 14); text.IsTextSelectionEnabled = false; text.Foreground = ManagementUi.Brush(active ? "BgBrush" : "InkBrush");
        var number = ManagementUi.Text(count.ToString("N0"), 13, true); number.IsTextSelectionEnabled = false; number.Foreground = ManagementUi.Brush(active ? "BgBrush" : "MutedBrush");
        content.Children.Add(text); content.Children.Add(number); chip.Content = content;
        AutomationProperties.SetName(chip, $"{title} · {count}");
        chip.Click += (_, _) => { _provider = id; ApplyFilters(); if (Catalog.Items.Count > 0) Catalog.ScrollIntoView(Catalog.Items[0]); };
        return chip;
    }

    private void Catalog_SizeChanged(object sender, SizeChangedEventArgs args)
    {
        var columns = Math.Clamp((int)((args.NewSize.Width - 16 + 12) / (330 + 12)), 1, 3);
        if (columns == _columns) return;
        _columns = columns; ApplyFilters();
    }

    private void FilterRow_SizeChanged(object sender, SizeChangedEventArgs args)
    {
        if (HeaderActions == null) return;
        var narrow = args.NewSize.Width < 920;
        FilterRow.RowSpacing = narrow ? 8 : 0;
        Grid.SetRow(HeaderActions, narrow ? 1 : 0); Grid.SetColumn(HeaderActions, 2);
        Grid.SetColumnSpan(SearchFilters, narrow ? 3 : 1);
        Grid.SetRow(Summary, narrow ? 1 : 0); Grid.SetColumn(Summary, narrow ? 0 : 1); Grid.SetColumnSpan(Summary, narrow ? 2 : 1);
        Summary.HorizontalAlignment = narrow ? HorizontalAlignment.Left : HorizontalAlignment.Right;
    }

    private void Catalog_ContainerContentChanging(ListViewBase sender, ContainerContentChangingEventArgs args)
    {
        if (args.ItemContainer.ContentTemplateRoot is not Grid root)
        {
            if (!args.InRecycleQueue && args.Phase == 0) args.RegisterUpdateCallback(1, Catalog_ContainerContentChanging);
            return;
        }
        root.Children.Clear(); root.ColumnDefinitions.Clear(); root.Padding = new Thickness(0); root.Margin = new Thickness(0);
        if (args.InRecycleQueue || args.Item is not ManagementCatalogRow row) return;
        if (row.Header is { } provider)
        {
            var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(0, 4, 0, 8) };
            header.Children.Add(ManagementUi.Logo(provider.Id, size: 22));
            var title = ManagementUi.Text(provider.Name, 16); title.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold; header.Children.Add(title);
            var count = ManagementUi.Text($"{provider.Models.Length:N0} " + T("个模型", "models"), 13, true); count.VerticalAlignment = VerticalAlignment.Center; header.Children.Add(count);
            root.Children.Add(header);
        }
        else
        {
            root.ColumnSpacing = 12; root.Margin = new Thickness(0, 0, 0, 12);
            for (var index = 0; index < row.Columns; index++) root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            for (var index = 0; index < row.Tiles.Length; index++)
            {
                FrameworkElement card = row.Tiles[index] is ManagementPrice model ? ModelCard(model) : MoreCard((ManagementMore)row.Tiles[index]);
                card.VerticalAlignment = VerticalAlignment.Top; Grid.SetColumn(card, index); root.Children.Add(card);
            }
        }
        args.Handled = true;
    }

    private FrameworkElement MoreCard(ManagementMore more)
    {
        var content = new StackPanel { Spacing = 6, HorizontalAlignment = HorizontalAlignment.Center };
        content.Children.Add(NativeIcons.Create("Layers3", 18));
        content.Children.Add(ManagementUi.Text(T($"查看全部 {more.Provider.Models.Length:N0} 个模型", $"View all {more.Provider.Models.Length:N0} models"), 14));
        content.Children.Add(ManagementUi.Text(T($"还有 {more.Remaining:N0} 个 {more.Provider.Name} 模型", $"{more.Remaining:N0} more from {more.Provider.Name}"), 13, true));
        var button = new Button { Content = content, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Center,
            MinHeight = 132, CornerRadius = new CornerRadius(8), Background = new SolidColorBrush(Colors.Transparent), BorderBrush = ManagementUi.Brush("LineBrush"), BorderThickness = new Thickness(1) };
        button.Click += (_, _) => { _provider = more.Provider.Id; ApplyFilters(); if (Catalog.Items.Count > 0) Catalog.ScrollIntoView(Catalog.Items[0]); };
        return button;
    }

    private FrameworkElement ModelCard(ManagementPrice model)
    {
        var id = J.Str(model.Raw, "id", model.Source + "/" + model.Name);
        var card = new Border { Background = ManagementUi.Brush("SurfaceBrush"), CornerRadius = new CornerRadius(8), Padding = new Thickness(14), BorderThickness = new Thickness(1), BorderBrush = new SolidColorBrush(Colors.Transparent) };
        var stack = new StackPanel { Spacing = 12 }; card.Child = stack;
        var header = new Grid { ColumnSpacing = 10 };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); header.ColumnDefinitions.Add(new ColumnDefinition()); header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        header.Children.Add(ManagementUi.Logo(model.Provider, model.Name));
        var titleStack = new StackPanel { Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
        var title = ManagementUi.Text(model.Name, 14); title.FontWeight = Microsoft.UI.Text.FontWeights.Medium; title.TextWrapping = TextWrapping.NoWrap; title.TextTrimming = TextTrimming.CharacterEllipsis;
        title.FontFamily = (FontFamily)Application.Current.Resources["MonoFontFamily"]; ToolTipService.SetToolTip(title, model.Name); titleStack.Children.Add(title);
        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        meta.Children.Add(ManagementUi.Text(ManagementUi.ProviderName(model.Provider), 13, true));
        if (model.Used) { var used = ManagementUi.Text(T("已使用", "Used"), 13); used.Foreground = ManagementUi.Brush("SignalInkBrush"); meta.Children.Add(new Border { Child = used, Background = ManagementUi.Brush("SignalSoftBrush"), CornerRadius = new CornerRadius(4), Padding = new Thickness(5, 1, 5, 1) }); }
        titleStack.Children.Add(meta); Grid.SetColumn(titleStack, 1); header.Children.Add(titleStack);
        var toggle = new ToggleButton { IsChecked = _expanded.Contains(id), MinWidth = 28, MinHeight = 28, Width = 28, Height = 28, Padding = new Thickness(0), BorderThickness = new Thickness(0), Background = new SolidColorBrush(Colors.Transparent), VerticalAlignment = VerticalAlignment.Top };
        ManagementUi.IconButton(toggle, toggle.IsChecked == true ? "ChevronRight" : "ChevronDown", model.Name + " · " + T("价格明细", "Price details"));
        Grid.SetColumn(toggle, 2); header.Children.Add(toggle); stack.Children.Add(header);
        stack.Children.Add(ManagementUi.Rates(model.Raw, _preferences, UsedOnly.IsChecked == true));
        var details = new Border { BorderBrush = ManagementUi.Brush("LineBrush"), BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(0, 10, 0, 0), Visibility = Visibility.Collapsed };
        var tiers = J.Items(model.Raw, "contextTiers").ToArray();
        if (tiers.Length > 0)
        {
            var label = T("长上下文 ", "Long context ") + (J.Num(tiers[0], "contextOver") / 1000).ToString("0.#") + "K+";
            var tierButton = new Button { Content = ManagementUi.ButtonContent(label, "Layers3"), MinHeight = 26, Padding = new Thickness(8, 2, 8, 2), CornerRadius = new CornerRadius(13), Background = new SolidColorBrush(Colors.Transparent), BorderBrush = ManagementUi.Brush("LineBrush"), BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Left };
            tierButton.Click += (_, _) => { toggle.IsChecked = toggle.IsChecked != true; ShowDetails(); };
            stack.Children.Add(tierButton);
        }
        stack.Children.Add(details);
        void ShowDetails()
        {
            var open = toggle.IsChecked == true;
            if (open) { _expanded.Add(id); details.Child ??= BuildDetails(model); } else _expanded.Remove(id);
            details.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
            card.BorderBrush = open ? ManagementUi.Brush("LineBrush") : new SolidColorBrush(Colors.Transparent);
            var chevron = NativeIcons.Create("ChevronDown", 15);
            chevron.RenderTransformOrigin = new Windows.Foundation.Point(.5, .5); chevron.RenderTransform = new RotateTransform { Angle = open ? 180 : 0 };
            toggle.Content = chevron;
        }
        toggle.Click += (_, _) => ShowDetails(); ShowDetails();
        card.PointerEntered += (_, _) => card.BorderBrush = ManagementUi.Brush("LineBrush");
        card.PointerExited += (_, _) => card.BorderBrush = toggle.IsChecked == true ? ManagementUi.Brush("LineBrush") : new SolidColorBrush(Colors.Transparent);
        return card;
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
    private void Used_Click(object sender, RoutedEventArgs args) { if (_binding) return; _allModels = UsedOnly.IsChecked != true; _provider = null; ApplyFilters(); }

    private StackPanel BuildDetails(ManagementPrice model)
    {
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
        return body;
    }

    private static string Clock(double raw) => $"{(int)raw / 100:00}:{(int)raw % 100:00}";
}
