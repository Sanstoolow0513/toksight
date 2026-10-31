using System.Globalization;
using System.Numerics;
using System.Text.Json.Nodes;
using Microsoft.UI;
using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Toksight.Desktop.Services;
using Windows.Foundation;
using Windows.System;
using Windows.UI.Core;
using Windows.UI.ViewManagement;

namespace Toksight.Desktop.Views;

public sealed partial class CalendarPage : UserControl, IDesktopPage
{
    private readonly DesktopApi _api;
    private readonly DesktopPreferences _preferences;
    private readonly Dictionary<DateOnly, JsonNode> _days = new();
    private readonly Dictionary<DateOnly, Button> _buttons = new();
    private readonly Dictionary<DateOnly, FrameworkElement> _months = new();
    private readonly Dictionary<DateOnly, string> _monthSummaries = new();
    private readonly List<(Button Button, List<DateOnly> Days)> _weekButtons = new();
    private readonly SortedSet<DateOnly> _selection = new();
    private CancellationTokenSource? _historyRequest;
    private CancellationTokenSource? _selectionRequest;
    private DateOnly _today;
    private DateOnly _firstDay;
    private DateOnly _shownFirst;
    private DateOnly _anchor;
    private DateOnly _focused;
    private DateOnly? _dragLast;
    private HashSet<DateOnly>? _dragBase;
    private bool _dragging;
    private bool _historyLoading;
    private bool _detailLoading;
    private bool _hasDetails;
    private bool _stacked;
    private bool _smallCells;
    private bool _layoutReady;
    private bool _renderingMonths;
    private bool _zooming;
    private bool _showSessions;
    private int _compactColumns = 3;
    private DateOnly _visibleMonth;
    private DispatcherTimer? _zoomTimer;
    private double _maxTokens;
    private int _historySequence;
    private int _detailSequence;
    private JsonNode? _detailData;
    private DispatcherTimer? _autoScroll;
    private double _scrollDirection;
    private Pointer? _capturedPointer;
    private Button? _captureOwner;
    public bool IsLoading => _historyLoading || _detailLoading;
    // Export the selected range, including its exact dates and timezone. Controls
    // outside this report (calendar navigation and hover state) are not captured.
    public FrameworkElement? ExportElement
    {
        get
        {
            if (!_hasDetails || IsLoading || ErrorBar.IsOpen) return null;
            ReportUi.FinishAnimations(DetailPanel); return DetailPanel;
        }
    }

    public CalendarPage(DesktopApi api, DesktopPreferences preferences)
    {
        InitializeComponent(); _api = api; _preferences = preferences;
        MonthsPanel.AddHandler(UIElement.PointerMovedEvent, new PointerEventHandler(Calendar_PointerMoved), true);
        MonthsPanel.AddHandler(UIElement.PointerReleasedEvent, new PointerEventHandler(Calendar_PointerReleased), true);
        MonthsPanel.AddHandler(UIElement.PointerCanceledEvent, new PointerEventHandler(Calendar_PointerCanceled), true);
        MonthIcon.Content = NativeIcons.Create("Calendar");
        TodayButton.Content = NativeIcons.Create("Calendar");
        LargeButton.Content = preferences.T("大", "Large");
        CompactButton.Content = preferences.T("紧凑", "Compact");
        SetTip(TodayButton, preferences.T("回到今天", "Back to today"));
        SetTip(MonthJumpButton, preferences.T("定位月份", "Jump to month"));
        SetTip(LargeButton, preferences.T("大日历 · Ctrl + 滚轮放大", "Large calendar · Ctrl + wheel to zoom in"));
        SetTip(CompactButton, preferences.T("紧凑热图 · Ctrl + 滚轮缩小", "Compact heatmap · Ctrl + wheel to zoom out"));
        RetryButton.Content = preferences.T("重试", "Retry");
        ToolTipService.SetToolTip(SelectionHint, preferences.T("拖动选择 · Shift 连选 · Ctrl 增减 · 点击周数选择整周", "Drag to select · Shift for a range · Ctrl to toggle · Click a week number to select its week"));
        _today = TodayInZone(); _firstDay = _today; _anchor = _today; _focused = _today;
        _selection.Add(_today);
        _visibleMonth = MonthStart(_today);
        ConfigureCalendarChrome();
        MonthScroller.Loaded += (_, _) => DispatcherQueue.TryEnqueue(() => ScrollToDate(_focused));
    }
    private static void SetTip(Button button, string text) { ToolTipService.SetToolTip(button, text); AutomationProperties.SetName(button, text); }
    private string MonthLabel(DateOnly month) => month.ToString(_preferences.Language == "zh-CN" ? "yyyy年M月" : "MMMM yyyy", CultureInfo.GetCultureInfo(_preferences.Language == "zh-CN" ? "zh-CN" : "en-US"));
    private string ShortDate(DateOnly date) => date.ToString(_preferences.Language == "zh-CN" ? "M月d日" : "MMM d", CultureInfo.GetCultureInfo(_preferences.Language == "zh-CN" ? "zh-CN" : "en-US"));
    private Button ToolButton(string icon, string label)
    {
        var button = new Button { Style = (Style)Resources["CalendarToolButton"], Content = NativeIcons.Create(icon), Width = 28, Height = 28, Padding = new Thickness(6) };
        SetTip(button, label); return button;
    }
    private Brush HeatBrush(int level)
    {
        if (new AccessibilitySettings().HighContrast) return ReportUi.B(level == 0 ? "SurfaceBrush" : "Surface3Brush");
        // Keep five stable levels. Large cells use slightly softer fills so the
        // numbers, rather than solid dark blocks, remain the visual foreground.
        var opacity = (_preferences.CalendarCompact ? new[] { .045, .12, .26, .50, .84 } : new[] { .045, .10, .20, .38, .68 })[level];
        var ink = ActualTheme == ElementTheme.Dark ? (byte)236 : (byte)24;
        return new SolidColorBrush(ColorHelper.FromArgb((byte)(opacity * 255), ink, ink, ink));
    }
    private void ConfigureCalendarChrome()
    {
        MonthLocation.Text = MonthLabel(_visibleMonth);
        var compact = _preferences.CalendarCompact;
        LargeButton.Background = ReportUi.B(compact ? "Surface2Brush" : "SurfaceBrush");
        CompactButton.Background = ReportUi.B(compact ? "SurfaceBrush" : "Surface2Brush");
        LargeButton.FontWeight = compact ? Microsoft.UI.Text.FontWeights.Normal : Microsoft.UI.Text.FontWeights.SemiBold;
        CompactButton.FontWeight = compact ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal;
        AutomationProperties.SetItemStatus(LargeButton, compact ? "" : _preferences.T("已选中", "Selected"));
        AutomationProperties.SetItemStatus(CompactButton, compact ? _preferences.T("已选中", "Selected") : "");
        WeekdayRow.Height = new GridLength(compact ? 0 : 30);
        WeekdayBar.Children.Clear(); WeekdayBar.ColumnDefinitions.Clear();
        var labels = _preferences.Language == "zh-CN" ? new[] { "一", "二", "三", "四", "五", "六", "日", "周" } : new[] { "M", "T", "W", "T", "F", "S", "S", "Wk" };
        for (var i = 0; i < labels.Length; i++)
        {
            WeekdayBar.ColumnDefinitions.Add(new ColumnDefinition());
            var text = ReportUi.Text(labels[i], 13, true); text.VerticalAlignment = VerticalAlignment.Center; text.Margin = new Thickness(i == 7 ? 12 : 6, 0, 0, 0);
            Grid.SetColumn(text, i); WeekdayBar.Children.Add(text);
        }
        HeatLegend.Children.Clear();
        HeatLegend.Children.Add(ReportUi.Text(_preferences.T("少", "Less"), 13, true));
        for (var level = 0; level < 5; level++) HeatLegend.Children.Add(new Border { Width = 12, Height = 12, CornerRadius = new CornerRadius(3), Background = HeatBrush(level), VerticalAlignment = VerticalAlignment.Center });
        HeatLegend.Children.Add(ReportUi.Text(_preferences.T("多", "More"), 13, true));
    }
    private DateOnly TodayInZone()
    {
        try { return DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.Now, TimeZoneInfo.FindSystemTimeZoneById(_preferences.TimeZone)).DateTime); }
        catch { return DateOnly.FromDateTime(DateTime.Now); }
    }
    private static DateOnly MonthStart(DateOnly date) => new(date.Year, date.Month, 1);
    private static string Key(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    private static bool IsKeyDown(VirtualKey key) => (InputKeyboardSource.GetKeyStateForCurrentThread(key) & CoreVirtualKeyStates.Down) != 0;
    private void LoadingChanged() => LoadingBar.Visibility = IsLoading ? Visibility.Visible : Visibility.Collapsed;
    public async Task ReloadAsync()
    {
        _historyRequest?.Cancel(); _historyRequest?.Dispose(); _historyRequest = new CancellationTokenSource();
        var token = _historyRequest.Token; var sequence = ++_historySequence;
        _historyLoading = true; LoadingChanged(); ErrorBar.IsOpen = false;
        try
        {
            var data = await _api.GetAsync(_api.ReportQuery("all"), token);
            if (sequence != _historySequence || token.IsCancellationRequested) return;
            _days.Clear(); _maxTokens = 0;
            foreach (var row in ReportUi.A(data, "daily"))
            {
                if (!DateOnly.TryParseExact(ReportUi.S(row, "date"), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) continue;
                _days[date] = row; _maxTokens = Math.Max(_maxTokens, ReportUi.N(row, "totalTokens"));
            }
            _today = DateOnly.TryParse(ReportUi.S(data["view"], "today"), out var today) ? today : TodayInZone();
            _firstDay = _days.Count > 0 ? _days.Keys.Min() : _today;
            if (_firstDay > _today) _firstDay = _today;
            _selection.RemoveWhere(d => d < _firstDay || d > _today);
            if (_selection.Count == 0) _selection.Add(_today);
            _focused = _selection.Max; _anchor = _selection.Min;
            _shownFirst = MonthStart(_today).AddMonths(-11);
            if (_shownFirst < MonthStart(_firstDay)) _shownFirst = MonthStart(_firstDay);
            if (_focused < _shownFirst) _shownFirst = MonthStart(_focused);
            FillMonthPicker(); RenderMonths();
            DispatcherQueue.TryEnqueue(() => ScrollToDate(_focused));
            await LoadSelectionAsync();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { if (sequence == _historySequence) ShowError(ex.Message); }
        finally { if (sequence == _historySequence) { _historyLoading = false; LoadingChanged(); DispatcherQueue.TryEnqueue(() => ScrollToDate(_focused)); } }
    }
    private void FillMonthPicker()
    {
        MonthMenu.Items.Clear();
        for (var month = MonthStart(_today); month >= MonthStart(_firstDay); month = month.AddMonths(-1))
        {
            var target = month;
            var item = new MenuFlyoutItem { Text = MonthLabel(month) };
            item.Click += (_, _) =>
            {
                if (target < _shownFirst) { _shownFirst = target; RenderMonths(); }
                DispatcherQueue.TryEnqueue(() => ScrollToMonth(target));
            };
            MonthMenu.Items.Add(item);
        }
    }
    private void RenderMonths()
    {
        if (_renderingMonths) return;
        _renderingMonths = true;
        try
        {
            MonthsPanel.Children.Clear(); MonthsPanel.RowDefinitions.Clear(); MonthsPanel.ColumnDefinitions.Clear();
            _buttons.Clear(); _months.Clear(); _weekButtons.Clear(); _monthSummaries.Clear();
            ConfigureCalendarChrome();
            var columns = _preferences.CalendarCompact ? _compactColumns : 1;
            for (var column = 0; column < columns; column++) MonthsPanel.ColumnDefinitions.Add(new ColumnDefinition());
            var firstRow = 0;
            if (_shownFirst > MonthStart(_firstDay))
            {
                MonthsPanel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                var earlier = new Button { Style = (Style)Resources["CalendarToolButton"], Content = _preferences.T("加载更早的 12 个月", "Load 12 earlier months"), HorizontalAlignment = HorizontalAlignment.Stretch, Background = ReportUi.B("Surface2Brush") };
                earlier.Click += (_, _) =>
                {
                    var keep = _shownFirst; _shownFirst = _shownFirst.AddMonths(-12);
                    if (_shownFirst < MonthStart(_firstDay)) _shownFirst = MonthStart(_firstDay);
                    RenderMonths(); DispatcherQueue.TryEnqueue(() => ScrollToMonth(keep));
                };
                Grid.SetColumnSpan(earlier, columns); MonthsPanel.Children.Add(earlier); firstRow = 1;
            }
            var index = 0;
            for (var month = _shownFirst; month <= MonthStart(_today); month = month.AddMonths(1), index++)
            {
                if (index % columns == 0) MonthsPanel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                var panel = BuildMonth(month); _months[month] = panel;
                Grid.SetRow(panel, firstRow + index / columns); Grid.SetColumn(panel, index % columns);
                MonthsPanel.Children.Add(panel);
            }
            UpdateSelectionVisuals();
            DispatcherQueue.TryEnqueue(UpdateStickyMonth);
        }
        finally { _renderingMonths = false; }
    }
    private JsonObject SummarizeDates(IEnumerable<DateOnly> dates)
    {
        var rows = dates.Where(_days.ContainsKey).Select(date => _days[date]).ToArray();
        var totals = new JsonObject();
        foreach (var field in new[] { "totalTokens", "costUsd", "requests", "pricedRequests" }) totals[field] = rows.Sum(row => ReportUi.N(row, field));
        return totals;
    }
    private Grid CellContent(string label, string tokens, string cost, Brush ink, bool today = false, bool week = false)
    {
        var content = new Grid();
        var date = ReportUi.Text(label, 13); date.IsTextSelectionEnabled = false;
        date.FontWeight = Microsoft.UI.Text.FontWeights.Medium; date.Foreground = week ? ReportUi.B("SignalInkBrush") : ink;
        var dateBadge = new Border { Child = date, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(6, 5, 4, 0), CornerRadius = new CornerRadius(3) };
        if (today) { dateBadge.Background = ReportUi.B("SignalBrush"); dateBadge.Padding = new Thickness(3, 1, 3, 1); date.Foreground = new SolidColorBrush(Colors.White); }
        content.Children.Add(dateBadge);
        var amounts = new StackPanel { Spacing = 2, Margin = new Thickness(6, 0, 4, 6), VerticalAlignment = VerticalAlignment.Bottom };
        var usage = ReportUi.Text(tokens, _smallCells ? 13 : 15); usage.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
        usage.Foreground = ink; usage.IsTextSelectionEnabled = false; usage.TextWrapping = TextWrapping.NoWrap; usage.TextTrimming = TextTrimming.CharacterEllipsis;
        amounts.Children.Add(usage);
        if (!_smallCells)
        {
            var price = ReportUi.Text(cost, 13); price.Foreground = ink; price.Opacity = .85; price.IsTextSelectionEnabled = false;
            price.TextWrapping = TextWrapping.NoWrap; price.TextTrimming = TextTrimming.CharacterEllipsis; amounts.Children.Add(price);
        }
        content.Children.Add(amounts);
        return content;
    }
    private FrameworkElement BuildMonth(DateOnly month)
    {
        var p = _preferences; var compact = p.CalendarCompact;
        var accessibilityContrast = new AccessibilitySettings().HighContrast;
        var count = DateTime.DaysInMonth(month.Year, month.Month);
        var monthTotals = SummarizeDates(Enumerable.Range(0, count).Select(offset => month.AddDays(offset)));
        var summary = ReportUi.N(monthTotals, "requests") > 0
            ? $"{ReportUi.Tokens(ReportUi.N(monthTotals, "totalTokens"))} · {ReportUi.Cost(monthTotals, p)}"
            : p.T("无记录", "No activity");
        _monthSummaries[month] = summary;
        var outer = new Grid { RowSpacing = 0, VerticalAlignment = VerticalAlignment.Top };
        outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); outer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        if (compact) { outer.Width = 151; outer.HorizontalAlignment = HorizontalAlignment.Center; }
        var name = ReportUi.Text(MonthLabel(month), compact ? 14 : 15); name.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
        name.VerticalAlignment = VerticalAlignment.Center; name.TextWrapping = TextWrapping.NoWrap;
        var meta = ReportUi.Text(summary, 13, true); meta.VerticalAlignment = VerticalAlignment.Center; meta.TextWrapping = TextWrapping.NoWrap; meta.TextTrimming = TextTrimming.CharacterEllipsis;
        FrameworkElement heading;
        if (compact)
        {
            heading = new StackPanel { Spacing = 3, Padding = new Thickness(0, 12, 0, 9), Children = { name, meta } };
        }
        else
        {
            var row = new Grid { Height = 42, ColumnSpacing = 8, Background = ReportUi.B("SurfaceBrush") };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new ColumnDefinition());
            Grid.SetColumn(meta, 1); meta.HorizontalAlignment = HorizontalAlignment.Right; row.Children.Add(name); row.Children.Add(meta); heading = row;
        }
        outer.Children.Add(heading);
        var grid = new Grid { ColumnSpacing = compact ? 3 : 6, RowSpacing = compact ? 3 : 6 };
        for (var i = 0; i < (compact ? 7 : 8); i++) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = compact ? new GridLength(19) : new GridLength(1, GridUnitType.Star) });
        var offset = ((int)month.DayOfWeek + 6) % 7;
        var weekRows = (offset + count + 6) / 7;
        for (var week = 0; week < weekRows; week++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(compact ? 19 : _smallCells ? 64 : 104) });
            if (compact) continue;
            var monday = month.AddDays(week * 7 - offset);
            var weekNumber = ISOWeek.GetWeekOfYear(monday.ToDateTime(TimeOnly.MinValue));
            var isoYear = ISOWeek.GetYear(monday.ToDateTime(TimeOnly.MinValue));
            var yearPrefix = isoYear != month.Year || monday.Year != monday.AddDays(6).Year ? (isoYear % 100).ToString("00") : "";
            var weekDays = Enumerable.Range(0, 7).Select(i => monday.AddDays(i)).Where(d => d >= _firstDay && d <= _today).ToList();
            var weekTotals = SummarizeDates(weekDays); var tokens = ReportUi.N(weekTotals, "totalTokens");
            var weekButton = new Button { Style = (Style)Resources["CalendarCellButton"], Background = ReportUi.B("SurfaceBrush"),
                BorderBrush = ReportUi.B("LineBrush"), BorderThickness = new Thickness(1), Margin = new Thickness(6, 0, 0, 0), IsEnabled = weekDays.Count > 0,
                Content = CellContent($"{yearPrefix}W{weekNumber}", weekDays.Count == 0 ? "" : tokens > 0 ? ReportUi.Tokens(tokens) : "—",
                    weekDays.Count == 0 ? "" : tokens > 0 ? ReportUi.Cost(weekTotals, p) : "—", ReportUi.B("InkBrush"), week: true) };
            var tooltip = $"{isoYear} W{weekNumber} · {ShortDate(monday)} – {ShortDate(monday.AddDays(6))}\n{ReportUi.Int(tokens)} tokens · {ReportUi.Cost(weekTotals, p)}";
            ToolTipService.SetToolTip(weekButton, new ToolTip { Content = tooltip }); AutomationProperties.SetName(weekButton, tooltip);
            weekButton.Click += async (_, _) =>
            {
                if (!IsKeyDown(VirtualKey.Control)) _selection.Clear();
                foreach (var day in weekDays) _selection.Add(day);
                _anchor = weekDays.FirstOrDefault(_today); _focused = weekDays.LastOrDefault(_today);
                UpdateSelectionVisuals(); await LoadSelectionAsync();
            };
            _weekButtons.Add((weekButton, weekDays));
            Grid.SetColumn(weekButton, 7); Grid.SetRow(weekButton, week); grid.Children.Add(weekButton);
        }
        for (var day = 1; day <= count; day++)
        {
            var date = new DateOnly(month.Year, month.Month, day); var index = offset + day - 1;
            var valid = date >= _firstDay && date <= _today; var future = date > _today;
            var totals = _days.GetValueOrDefault(date); var tokens = ReportUi.N(totals, "totalTokens");
            var level = tokens <= 0 || _maxTokens <= 0 ? 0 : Math.Clamp((int)Math.Ceiling(Math.Sqrt(tokens / _maxTokens) * 4), 1, 4);
            var highFill = compact ? level >= 3 : level == 4;
            var ink = highFill && !accessibilityContrast ? new SolidColorBrush(ActualTheme == ElementTheme.Dark ? Colors.Black : Colors.White) : ReportUi.B(future ? "MutedBrush" : "InkBrush");
            var button = new Button
            {
                Style = (Style)Resources["CalendarCellButton"], Tag = date, IsEnabled = valid, IsTabStop = date == _focused,
                Background = future ? ReportUi.B("Surface2Brush") : HeatBrush(level), CornerRadius = new CornerRadius(compact ? 3 : 4),
                Content = compact ? new Grid() : CellContent(day.ToString(CultureInfo.InvariantCulture), future ? "" : tokens > 0 ? ReportUi.Tokens(tokens) : "—",
                    future ? "" : tokens > 0 ? ReportUi.Cost(totals, p) : "—", ink, date == _today),
            };
            var tooltip = $"{Key(date)} · {date.ToString("dddd", CultureInfo.GetCultureInfo(p.Language == "zh-CN" ? "zh-CN" : "en-US"))}\n"
                + (future ? p.T("尚未到来", "Future date") : tokens == 0 ? p.T("无活动", "No activity") : $"{ReportUi.Int(tokens)} tokens · {ReportUi.Cost(totals, p)}\n{ReportUi.Int(ReportUi.N(totals, "requests"))} {p.T("次请求", "requests")}");
            ToolTipService.SetToolTip(button, new ToolTip { Content = tooltip }); AutomationProperties.SetName(button, tooltip);
            button.Click += async (_, _) => { if (_dragging) return; SelectDay(date, IsKeyDown(VirtualKey.Shift), IsKeyDown(VirtualKey.Control)); await LoadSelectionAsync(); };
            button.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler(Day_PointerPressed), true);
            button.GotFocus += (_, _) => { _focused = date; UpdateTabStops(); };
            Grid.SetRow(button, index / 7); Grid.SetColumn(button, index % 7); grid.Children.Add(button); _buttons[date] = button;
        }
        Grid.SetRow(grid, 1); outer.Children.Add(grid);
        return outer;
    }
    private void SelectDay(DateOnly date, bool extend, bool toggle)
    {
        if (date < _firstDay || date > _today) return;
        if (extend)
        {
            if (!toggle) _selection.Clear();
            AddRange(_anchor, date);
        }
        else if (toggle)
        {
            if (!_selection.Remove(date) || _selection.Count == 0) _selection.Add(date);
            _anchor = date;
        }
        else { _selection.Clear(); _selection.Add(date); _anchor = date; }
        _focused = date; UpdateSelectionVisuals();
    }
    private void AddRange(DateOnly a, DateOnly b)
    {
        var start = a < b ? a : b; var end = a > b ? a : b;
        if (start < _firstDay) start = _firstDay; if (end > _today) end = _today;
        for (var day = start; day <= end; day = day.AddDays(1)) _selection.Add(day);
    }
    private void UpdateSelectionVisuals()
    {
        foreach (var (date, button) in _buttons)
        {
            button.BorderBrush = _selection.Contains(date) || (date == _today && _preferences.CalendarCompact) ? ReportUi.B("SignalBrush") : new SolidColorBrush(Colors.Transparent);
            AutomationProperties.SetItemStatus(button, _selection.Contains(date) ? _preferences.T("已选中", "Selected") : "");
        }
        foreach (var (button, days) in _weekButtons)
        {
            var selected = days.Count > 0 && _selection.SetEquals(days);
            button.BorderBrush = ReportUi.B(selected ? "SignalBrush" : "LineBrush"); button.BorderThickness = new Thickness(selected ? 2 : 1);
            button.Background = ReportUi.B(selected ? "SignalSoftBrush" : "SurfaceBrush");
            AutomationProperties.SetItemStatus(button, selected ? _preferences.T("已选中整周", "Selected week") : "");
        }
        if (_selection.Count > 0)
        {
            var range = _selection.Count == 1 ? ShortDate(_selection.Min) : $"{ShortDate(_selection.Min)} – {ShortDate(_selection.Max)}";
            SelectionHint.Text = $"{range} · {_preferences.T($"已选 {_selection.Count} 天", $"{_selection.Count} selected")}";
        }
        UpdateTabStops();
    }
    private void UpdateTabStops() { foreach (var (date, button) in _buttons) button.IsTabStop = date == _focused; }
    private void Day_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        if (sender is not Button { Tag: DateOnly date } button || !e.GetCurrentPoint(button).Properties.IsLeftButtonPressed) return;
        e.Handled = true;
        _dragBase = IsKeyDown(VirtualKey.Control) ? _selection.ToHashSet() : new HashSet<DateOnly>();
        SelectDay(date, IsKeyDown(VirtualKey.Shift), IsKeyDown(VirtualKey.Control));
        _dragging = true; _dragLast = date; _captureOwner = button; _capturedPointer = e.Pointer;
        button.CapturePointer(e.Pointer); button.Focus(FocusState.Pointer);
    }
    private void Calendar_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_dragging) return;
        var point = e.GetCurrentPoint(null).Position;
        var target = VisualTreeHelper.FindElementsInHostCoordinates(point, MonthsPanel).Select(FindDayButton).FirstOrDefault(b => b is { IsEnabled: true });
        if (target?.Tag is DateOnly date && date != _dragLast)
        {
            _dragLast = date; _selection.Clear();
            if (_dragBase is not null) foreach (var d in _dragBase) _selection.Add(d);
            AddRange(_anchor, date); _focused = date; UpdateSelectionVisuals();
        }
        var position = e.GetCurrentPoint(MonthScroller).Position;
        _scrollDirection = position.Y < 48 ? -1 : position.Y > MonthScroller.ActualHeight - 48 ? 1 : 0;
        if (_scrollDirection != 0)
        {
            _autoScroll ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(30) };
            _autoScroll.Tick -= AutoScroll_Tick; _autoScroll.Tick += AutoScroll_Tick; _autoScroll.Start();
        }
        else _autoScroll?.Stop();
        e.Handled = true;
    }
    private void AutoScroll_Tick(object? sender, object e)
    {
        if (!_dragging) { _autoScroll?.Stop(); return; }
        MonthScroller.ChangeView(null, Math.Clamp(MonthScroller.VerticalOffset + _scrollDirection * 16, 0, MonthScroller.ScrollableHeight), null, true);
    }
    private static Button? FindDayButton(UIElement element)
    {
        DependencyObject? current = element;
        while (current is not null)
        {
            if (current is Button { Tag: DateOnly } button) return button;
            current = VisualTreeHelper.GetParent(current);
        }
        return null;
    }
    private async void Calendar_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_dragging) return; EndDrag(); e.Handled = true; await LoadSelectionAsync();
    }
    private async void Calendar_PointerCanceled(object sender, PointerRoutedEventArgs e)
    {
        if (!_dragging) return; EndDrag(); await LoadSelectionAsync();
    }
    private void EndDrag()
    {
        _dragging = false; _autoScroll?.Stop();
        if (_capturedPointer is not null) _captureOwner?.ReleasePointerCapture(_capturedPointer);
        _capturedPointer = null; _captureOwner = null; _dragBase = null;
    }
    private async Task LoadSelectionAsync()
    {
        _selectionRequest?.Cancel(); _selectionRequest?.Dispose(); _selectionRequest = new CancellationTokenSource();
        var token = _selectionRequest.Token; var sequence = ++_detailSequence;
        var selected = _selection.ToArray(); if (selected.Length == 0) return;
        var p = _preferences;
        _detailLoading = true; _hasDetails = false; LoadingChanged(); ErrorBar.IsOpen = false;
        DetailPanel.Opacity = .55;
        try
        {
            var continuous = selected.Length == selected[^1].DayNumber - selected[0].DayNumber + 1;
            // Contiguous ranges do not need the server's bounded explicit-day list.
            var query = _api.ReportQuery("custom", Key(selected[0]), Key(selected[^1]), continuous ? null : selected.Select(Key));
            var data = await _api.GetAsync(query, token);
            if (sequence != _detailSequence || token.IsCancellationRequested) return;
            _detailData = data; RenderDetails(data, selected); _hasDetails = true;
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { if (sequence == _detailSequence) ShowError(ex.Message); }
        finally { if (sequence == _detailSequence) { _detailLoading = false; DetailPanel.Opacity = 1; LoadingChanged(); } }
    }
    private FrameworkElement DetailHeader(JsonNode data, DateOnly[] selected)
    {
        var p = _preferences; var totals = data["totals"];
        var activeDays = ReportUi.A(data, "daily").Count(row => ReportUi.N(row, "requests") > 0);
        var panel = ReportUi.Panel("", out var body); body.Spacing = 10;
        var heading = new Grid { ColumnSpacing = 10 };
        heading.ColumnDefinitions.Add(new ColumnDefinition()); heading.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var title = selected.Length == 1
            ? $"{ShortDate(selected[0])} {selected[0].ToString("ddd", CultureInfo.GetCultureInfo(p.Language == "zh-CN" ? "zh-CN" : "en-US"))}"
            : p.T($"已选 {selected.Length} 天", $"{selected.Length} days selected");
        var label = ReportUi.Text(title, 18); label.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold; label.VerticalAlignment = VerticalAlignment.Center;
        heading.Children.Add(label);
        var navigation = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2 };
        if (selected.Length == 1)
        {
            var previous = ToolButton("ChevronLeft", p.T("前一天", "Previous day")); previous.IsEnabled = selected[0] > _firstDay;
            var next = ToolButton("ChevronRight", p.T("后一天", "Next day")); next.IsEnabled = selected[0] < _today;
            previous.Click += async (_, _) => { SelectDay(selected[0].AddDays(-1), false, false); ScrollToDate(_focused); await LoadSelectionAsync(); };
            next.Click += async (_, _) => { SelectDay(selected[0].AddDays(1), false, false); ScrollToDate(_focused); await LoadSelectionAsync(); };
            navigation.Children.Add(previous); navigation.Children.Add(next);
        }
        else
        {
            var clear = new Button { Style = (Style)Resources["CalendarToolButton"], Height = 28, Content = p.T("清除选择", "Clear selection"), FontSize = 13 };
            clear.Click += async (_, _) => { SelectDay(selected[^1], false, false); ScrollToDate(_focused); await LoadSelectionAsync(); }; navigation.Children.Add(clear);
        }
        Grid.SetColumn(navigation, 1); heading.Children.Add(navigation); body.Children.Add(heading);
        var continuous = selected.Length == selected[^1].DayNumber - selected[0].DayNumber + 1;
        var meta = selected.Length == 1 ? (selected[0] == _today ? p.T("今天 · ", "Today · ") : "") + p.TimeZone
            : $"{ShortDate(selected[0])} – {ShortDate(selected[^1])} · {p.T($"活跃 {activeDays} 天", $"{activeDays} active days")}" + (continuous ? "" : p.T(" · 不连续", " · Non-contiguous"));
        body.Children.Add(ReportUi.Text(meta, 13, true));
        var stats = new Grid { ColumnSpacing = 12, Margin = new Thickness(0, 2, 0, 0) };
        var values = new[] { ReportUi.Tokens(ReportUi.N(totals, "totalTokens")), ReportUi.Cost(totals, p), ReportUi.Rate(totals), ReportUi.Int(ReportUi.N(totals, "requests")) };
        var labels = new[] { "Tokens", p.T("参考费用", "Est. cost"), p.T("缓存命中", "Cache hit"), p.T("请求", "Requests") };
        for (var index = 0; index < values.Length; index++)
        {
            stats.ColumnDefinitions.Add(new ColumnDefinition());
            var number = ReportUi.Text(values[index], 18); number.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold; number.TextWrapping = TextWrapping.NoWrap;
            var group = new StackPanel { Spacing = 3, Children = { number, ReportUi.Text(labels[index], 13, true) } };
            Grid.SetColumn(group, index); stats.Children.Add(group);
        }
        body.Children.Add(stats);
        var sub = selected.Length == 1 ? p.T($"输出 {ReportUi.Tokens(ReportUi.N(totals, "outputTokens"))}", $"Output {ReportUi.Tokens(ReportUi.N(totals, "outputTokens"))}")
            : p.T($"活跃日均 {ReportUi.Tokens(ReportUi.N(totals, "totalTokens") / Math.Max(1, activeDays))}", $"Per active day {ReportUi.Tokens(ReportUi.N(totals, "totalTokens") / Math.Max(1, activeDays))}");
        body.Children.Add(ReportUi.Text(sub + $" · {ReportUi.Int(ReportUi.N(totals, "sessions"))} {p.T("个会话", "sessions")}", 13, true));
        return panel;
    }
    private FrameworkElement DetailHourly(JsonNode data)
    {
        var p = _preferences; var hours = ReportUi.A(data, "hourly").ToList();
        var maximum = hours.Select(hour => ReportUi.N(hour, "tokens")).DefaultIfEmpty(0).Max();
        var peak = hours.FindIndex(hour => ReportUi.N(hour, "tokens") == maximum);
        var panel = ReportUi.Panel("", out var body); body.Spacing = 8;
        var peakLabel = ReportUi.Text(maximum > 0 ? $"{p.T("峰值", "Peak")} {peak:00}:00 · {ReportUi.Tokens(maximum)}" : p.T("无活动", "No activity"), 13, true);
        body.Children.Add(ReportUi.Header(p.T("时段分布", "Hourly usage"), "Clock", null, peakLabel));
        var bars = new Grid { Height = 52, ColumnSpacing = 3 };
        for (var index = 0; index < 24; index++)
        {
            bars.ColumnDefinitions.Add(new ColumnDefinition());
            var value = index < hours.Count ? ReportUi.N(hours[index], "tokens") : 0;
            var fill = value > 0 && index == peak ? "SignalBrush" : value > maximum * .01 ? "InkBrush" : "Surface3Brush";
            var bar = new Border { Height = maximum > 0 ? Math.Max(2, value / maximum * 52) : 2,
                Background = ReportUi.B(fill), Opacity = fill == "InkBrush" ? .72 : 1, VerticalAlignment = VerticalAlignment.Bottom, CornerRadius = new CornerRadius(3, 3, 0, 0) };
            var content = new Grid(); content.Children.Add(bar);
            var button = new Button { Style = (Style)Resources["CalendarCellButton"], Content = content, Height = 52, BorderThickness = new Thickness(0),
                Background = new SolidColorBrush(Colors.Transparent), IsTabStop = value > 0 };
            var tooltip = $"{index:00}:00 · {ReportUi.Int(value)} tokens";
            ToolTipService.SetToolTip(button, new ToolTip { Content = tooltip }); AutomationProperties.SetName(button, tooltip);
            Grid.SetColumn(button, index); bars.Children.Add(button);
        }
        body.Children.Add(bars);
        var axis = new Grid();
        for (var index = 0; index < 5; index++)
        {
            axis.ColumnDefinitions.Add(new ColumnDefinition());
            var tick = ReportUi.Text((index * 6).ToString("00"), 13, true);
            tick.HorizontalAlignment = index == 0 ? HorizontalAlignment.Left : index == 4 ? HorizontalAlignment.Right : HorizontalAlignment.Center;
            Grid.SetColumn(tick, index); axis.Children.Add(tick);
        }
        body.Children.Add(axis); return panel;
    }
    private void RenderDetails(JsonNode data, DateOnly[] selected)
    {
        var p = _preferences; DetailPanel.Children.Clear();
        DetailPanel.Children.Add(DetailHeader(data, selected));
        if (ReportUi.N(data["totals"], "requests") == 0)
        {
            var empty = ReportUi.Panel("", out var emptyBody); emptyBody.Children.Add(ReportUi.Text(p.T("所选日期没有记录。", "No activity in the selected dates."), 14, true));
            DetailPanel.Children.Add(empty);
        }
        else
        {
            if (selected.Length == 1) DetailPanel.Children.Add(DetailHourly(data));
            var mode = ReportUi.Segmented([p.T("用量拆分", "Usage breakdown"), p.T("会话", "Sessions")], _showSessions ? 1 : 0, index =>
            {
                _showSessions = index == 1; RenderDetails(data, selected);
            });
            mode.HorizontalAlignment = HorizontalAlignment.Left; DetailPanel.Children.Add(mode);
            DetailPanel.Children.Add(_showSessions ? ReportUi.Sessions(data, p) : ReportUi.Agents(data, p, true));
        }
        DetailPanel.Children.Add(ReportUi.Text($"toksight {ReportUi.S(data, "version")} · {p.T("刷新于", "Refreshed")} {ReportUi.Stamp(data["snapshot"]?["refreshedAt"], p.TimeZone)}\n{p.T("本机处理 · 费用仅供参考", "Processed locally · Costs are estimates")}", 13, true));
    }
    private async void Calendar_KeyDown(object sender, KeyRoutedEventArgs e)
    {
        var date = _focused;
        switch (e.Key)
        {
            case VirtualKey.Left: date = date.AddDays(-1); break;
            case VirtualKey.Right: date = date.AddDays(1); break;
            case VirtualKey.Up: date = date.AddDays(-7); break;
            case VirtualKey.Down: date = date.AddDays(7); break;
            case VirtualKey.PageUp: date = date.AddMonths(-1); break;
            case VirtualKey.PageDown: date = date.AddMonths(1); break;
            case VirtualKey.Home: date = IsKeyDown(VirtualKey.Control) ? _firstDay : date.AddDays(-((int)date.DayOfWeek + 6) % 7); break;
            case VirtualKey.End: date = IsKeyDown(VirtualKey.Control) ? _today : date.AddDays(6 - ((int)date.DayOfWeek + 6) % 7); break;
            case VirtualKey.Escape: date = _today; break;
            case VirtualKey.Add: SetCompact(false); e.Handled = true; return;
            case VirtualKey.Subtract: SetCompact(true); e.Handled = true; return;
            case VirtualKey.Space:
            case VirtualKey.Enter: SelectDay(date, IsKeyDown(VirtualKey.Shift), IsKeyDown(VirtualKey.Control)); await LoadSelectionAsync(); e.Handled = true; return;
            default: return;
        }
        e.Handled = true;
        if (date < _firstDay) date = _firstDay; if (date > _today) date = _today;
        _focused = date;
        if (e.Key == VirtualKey.Escape) SelectDay(date, false, false);
        else if (IsKeyDown(VirtualKey.Shift)) SelectDay(date, true, IsKeyDown(VirtualKey.Control));
        if (date < _shownFirst) { _shownFirst = MonthStart(date); RenderMonths(); }
        UpdateTabStops(); ScrollToDate(date);
        if (_buttons.TryGetValue(date, out var button)) button.Focus(FocusState.Keyboard);
        if (IsKeyDown(VirtualKey.Shift) || e.Key == VirtualKey.Escape) await LoadSelectionAsync();
    }
    private void SetCompact(bool compact, DateOnly? pointedDate = null)
    {
        if (_preferences.CalendarCompact == compact || _zooming) return;
        var anchor = pointedDate ?? _focused;
        var visible = _buttons.Select(pair => (pair.Key, Button: pair.Value, Point: pair.Value.TransformToVisual(MonthScroller).TransformPoint(new Point())))
            .Where(item => item.Point.Y >= 0 && item.Point.Y < MonthScroller.ActualHeight).ToArray();
        if (!visible.Any(item => item.Key == anchor) && visible.Length > 0)
            anchor = visible.OrderBy(item => Math.Abs(item.Point.Y - MonthScroller.ActualHeight / 2)).First().Key;
        var oldPosition = _buttons.TryGetValue(anchor, out var button) ? button.TransformToVisual(MonthScroller).TransformPoint(new Point()).Y : 0;
        var oldRects = new Dictionary<DateOnly, Rect>();
        var animate = new UISettings().AnimationsEnabled;
        if (animate)
        {
            foreach (var (date, dayButton) in _buttons)
            {
                var point = dayButton.TransformToVisual(MonthScroller).TransformPoint(new Point());
                if (point.Y + dayButton.ActualHeight >= 0 && point.Y < MonthScroller.ActualHeight)
                    oldRects[date] = new Rect(point.X, point.Y, dayButton.ActualWidth, dayButton.ActualHeight);
            }
        }
        _preferences.CalendarCompact = compact;
        try { _preferences.Save(); } catch (Exception ex) { ShowError(ex.Message); }
        _zooming = animate;
        RenderMonths();
        DispatcherQueue.TryEnqueue(() =>
        {
            EnsureMonthEndSpace();
            if (_buttons.TryGetValue(anchor, out var anchorButton))
            {
                var target = anchorButton.TransformToVisual(MonthsPanel).TransformPoint(new Point()).Y;
                MonthScroller.ChangeView(null, Math.Clamp(target - oldPosition, 0, MonthScroller.ScrollableHeight), null, true);
            }
            MonthsPanel.UpdateLayout(); UpdateStickyMonth();
            if (!animate) return;
            // FLIP preserves the pointed/visible day while the month grid changes.
            foreach (var (date, old) in oldRects)
            {
                if (!_buttons.TryGetValue(date, out var next) || next.ActualWidth <= 0 || next.ActualHeight <= 0) continue;
                var point = next.TransformToVisual(MonthScroller).TransformPoint(new Point());
                if (point.Y + next.ActualHeight < 0 || point.Y > MonthScroller.ActualHeight) continue;
                ElementCompositionPreview.SetIsTranslationEnabled(next, true);
                var visual = ElementCompositionPreview.GetElementVisual(next);
                var ease = visual.Compositor.CreateCubicBezierEasingFunction(new Vector2(.2f, .7f), new Vector2(.1f, 1));
                var move = visual.Compositor.CreateVector3KeyFrameAnimation();
                move.InsertKeyFrame(0, new Vector3((float)(old.X - point.X), (float)(old.Y - point.Y), 0));
                move.InsertKeyFrame(1, Vector3.Zero, ease); move.Duration = TimeSpan.FromMilliseconds(360);
                visual.StartAnimation("Translation", move);
                var scale = visual.Compositor.CreateVector3KeyFrameAnimation();
                scale.InsertKeyFrame(0, new Vector3((float)(old.Width / next.ActualWidth), (float)(old.Height / next.ActualHeight), 1));
                scale.InsertKeyFrame(1, Vector3.One, ease); scale.Duration = TimeSpan.FromMilliseconds(360);
                visual.StartAnimation("Scale", scale);
            }
            _zoomTimer?.Stop();
            _zoomTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(370) };
            _zoomTimer.Tick += (_, _) => { _zoomTimer.Stop(); _zooming = false; };
            _zoomTimer.Start();
        });
    }
    private void Large_Click(object sender, RoutedEventArgs e) => SetCompact(false);
    private void Compact_Click(object sender, RoutedEventArgs e) => SetCompact(true);
    private void Calendar_Wheel(object sender, PointerRoutedEventArgs e)
    {
        if (!IsKeyDown(VirtualKey.Control)) return;
        var target = VisualTreeHelper.FindElementsInHostCoordinates(e.GetCurrentPoint(null).Position, MonthsPanel).Select(FindDayButton).FirstOrDefault();
        e.Handled = true; SetCompact(e.GetCurrentPoint(MonthScroller).Properties.MouseWheelDelta < 0, target?.Tag is DateOnly date ? date : null);
    }
    private async void Today_Click(object sender, RoutedEventArgs e)
    {
        SelectDay(_today, false, false); ScrollToDate(_today); await LoadSelectionAsync();
    }
    private void EnsureMonthEndSpace()
    {
        // When the last month is shorter than the viewport, allow its own
        // heading to reach the top instead of pinning the previous month's
        // heading above a few clipped/covered cells.
        MonthScroller.UpdateLayout(); MonthsPanel.UpdateLayout();
        var bottom = 20d;
        if (!_preferences.CalendarCompact && _months.TryGetValue(MonthStart(_today), out var last))
            bottom = Math.Max(bottom, Math.Ceiling(MonthScroller.ViewportHeight - last.ActualHeight));
        if (Math.Abs(MonthsPanel.Padding.Bottom - bottom) > .5)
        {
            MonthsPanel.Padding = new Thickness(16, 0, 16, bottom);
            MonthsPanel.UpdateLayout(); MonthScroller.UpdateLayout();
        }
    }
    private void ScrollToMonth(DateOnly month)
    {
        EnsureMonthEndSpace();
        if (_months.TryGetValue(MonthStart(month), out var panel))
        {
            var y = panel.TransformToVisual(MonthsPanel).TransformPoint(new Point()).Y;
            MonthScroller.ChangeView(null, Math.Clamp(y, 0, MonthScroller.ScrollableHeight), null, true);
            UpdateStickyMonth();
        }
    }
    private void ScrollToDate(DateOnly date)
    {
        if (date < _shownFirst) { _shownFirst = MonthStart(date); RenderMonths(); }
        EnsureMonthEndSpace();
        if (_buttons.TryGetValue(date, out var button))
        {
            var y = button.TransformToVisual(MonthsPanel).TransformPoint(new Point()).Y;
            var inset = _preferences.CalendarCompact ? Math.Max(42, MonthScroller.ViewportHeight / 2) : 60;
            var target = y - inset;
            // If the entire selected month fits, present the whole month with
            // its heading first; the selected day is still fully visible.
            if (!_preferences.CalendarCompact && _months.TryGetValue(MonthStart(date), out var month) && month.ActualHeight <= MonthScroller.ViewportHeight)
                target = month.TransformToVisual(MonthsPanel).TransformPoint(new Point()).Y;
            MonthScroller.ChangeView(null, Math.Clamp(target, 0, MonthScroller.ScrollableHeight), null, true);
            UpdateStickyMonth();
        }
    }
    private void UpdateStickyMonth()
    {
        if (_months.Count == 0 || MonthScroller.ActualHeight <= 0) return;
        var active = _months.Keys.Min(); var activeY = double.MaxValue; var nextY = double.MaxValue;
        foreach (var (month, panel) in _months.OrderBy(entry => entry.Key))
        {
            var y = panel.TransformToVisual(MonthScroller).TransformPoint(new Point()).Y;
            if (y <= 1) { active = month; activeY = y; }
            else if (nextY == double.MaxValue) nextY = y;
        }
        _visibleMonth = active; MonthLocation.Text = MonthLabel(active);
        StickyMonthHeader.Visibility = !_preferences.CalendarCompact && activeY < 0 ? Visibility.Visible : Visibility.Collapsed;
        StickyMonthLabel.Text = MonthLabel(active); StickyMonthSummary.Text = _monthSummaries.GetValueOrDefault(active, "");
        StickyMonthHeader.RenderTransform = new TranslateTransform { Y = Math.Min(0, nextY - 42) };
    }
    private void CalendarViewport_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        CalendarViewport.Clip = new RectangleGeometry { Rect = new Rect(0, 0, Math.Max(0, e.NewSize.Width), Math.Max(0, e.NewSize.Height)) };
    }
    private void Calendar_Scrolled(object sender, ScrollViewerViewChangedEventArgs e)
    {
        UpdateStickyMonth();
        foreach (var button in _buttons.Values) if (ToolTipService.GetToolTip(button) is ToolTip tip) tip.IsOpen = false;
    }
    private void Page_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        if (CalendarColumn is null || _renderingMonths) return;
        var stacked = e.NewSize.Width < 1040;
        var padding = e.NewSize.Width < 760 ? 12 : 24;
        var width = stacked ? e.NewSize.Width - padding * 2 : (e.NewSize.Width - padding * 2 - 16) * .545;
        var smallCells = width < 550; var compactColumns = width >= 530 ? 3 : 2;
        var rerender = _layoutReady && (_stacked != stacked || _smallCells != smallCells || _compactColumns != compactColumns);
        _stacked = stacked; _smallCells = smallCells; _compactColumns = compactColumns; _layoutReady = true;
        PageRoot.Padding = new Thickness(padding, 16, padding, 16);
        Workspace.ColumnDefinitions.Clear(); Workspace.RowDefinitions.Clear();
        if (stacked)
        {
            Workspace.ColumnDefinitions.Add(new ColumnDefinition());
            Workspace.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); Workspace.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            CalendarColumn.Height = Math.Max(430, Math.Min(640, e.NewSize.Height * .72));
            WorkspaceScroller.VerticalScrollBarVisibility = ScrollBarVisibility.Auto; WorkspaceScroller.VerticalScrollMode = ScrollMode.Enabled; WorkspaceScroller.VerticalContentAlignment = VerticalAlignment.Top;
            DetailScroller.VerticalScrollBarVisibility = ScrollBarVisibility.Disabled; DetailScroller.VerticalScrollMode = ScrollMode.Disabled;
            Grid.SetColumn(DetailScroller, 0); Grid.SetRow(DetailScroller, 1);
        }
        else
        {
            Workspace.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) }); Workspace.ColumnDefinitions.Add(new ColumnDefinition());
            Workspace.RowDefinitions.Add(new RowDefinition());
            CalendarColumn.Height = double.NaN;
            WorkspaceScroller.VerticalScrollBarVisibility = ScrollBarVisibility.Disabled; WorkspaceScroller.VerticalScrollMode = ScrollMode.Disabled; WorkspaceScroller.VerticalContentAlignment = VerticalAlignment.Stretch;
            DetailScroller.VerticalScrollBarVisibility = ScrollBarVisibility.Auto; DetailScroller.VerticalScrollMode = ScrollMode.Enabled;
            Grid.SetColumn(DetailScroller, 1); Grid.SetRow(DetailScroller, 0);
        }
        if (rerender && _months.Count > 0)
        {
            RenderMonths(); DispatcherQueue.TryEnqueue(() => ScrollToDate(_focused));
        }
        else if (_months.Count > 0)
        {
            DispatcherQueue.TryEnqueue(() => { EnsureMonthEndSpace(); UpdateStickyMonth(); });
        }
    }
    private void ShowError(string message) { ErrorBar.Message = message; ErrorBar.IsOpen = true; }
    private async void Retry_Click(object sender, RoutedEventArgs e) => await ReloadAsync();
    public void OnLeaving()
    {
        ++_historySequence; ++_detailSequence; _historyRequest?.Cancel(); _selectionRequest?.Cancel(); EndDrag(); _zoomTimer?.Stop(); _zooming = false;
        _historyLoading = false; _detailLoading = false;
    }
}
