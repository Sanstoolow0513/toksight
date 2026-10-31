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
    private bool _monthPickerUpdating;
    private bool _hasDetails;
    private bool _stacked;
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
        TodayButton.Content = preferences.T("今天", "Today");
        CompactButton.Content = preferences.T("紧凑", "Compact");
        CompactButton.IsChecked = preferences.CalendarCompact;
        RetryButton.Content = preferences.T("重试", "Retry");
        SelectionHint.Text = preferences.T("拖动选择 · Shift 连选 · Ctrl 增减 · Ctrl + 滚轮缩放 · 点击周数选择整周", "Drag to select · Shift for range · Ctrl to toggle · Ctrl + wheel to zoom · Click a week number to select its week");
        AutomationProperties.SetName(MonthPicker, preferences.T("跳转月份", "Jump to month"));
        _today = TodayInZone(); _firstDay = _today; _anchor = _today; _focused = _today;
        _selection.Add(_today);
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
        finally { if (sequence == _historySequence) { _historyLoading = false; LoadingChanged(); } }
    }
    private void FillMonthPicker()
    {
        _monthPickerUpdating = true;
        var months = new List<string>();
        for (var month = MonthStart(_today); month >= MonthStart(_firstDay); month = month.AddMonths(-1)) months.Add(month.ToString("yyyy-MM", CultureInfo.InvariantCulture));
        MonthPicker.ItemsSource = months; MonthPicker.SelectedItem = _focused.ToString("yyyy-MM", CultureInfo.InvariantCulture);
        _monthPickerUpdating = false;
    }
    private void RenderMonths()
    {
        MonthsPanel.Children.Clear(); _buttons.Clear(); _months.Clear();
        if (_shownFirst > MonthStart(_firstDay))
        {
            var earlier = new Button { Content = _preferences.T("加载更早的 12 个月", "Load 12 earlier months"), HorizontalAlignment = HorizontalAlignment.Stretch };
            earlier.Click += (_, _) =>
            {
                var keep = _shownFirst; _shownFirst = _shownFirst.AddMonths(-12);
                if (_shownFirst < MonthStart(_firstDay)) _shownFirst = MonthStart(_firstDay);
                RenderMonths(); DispatcherQueue.TryEnqueue(() => ScrollToDate(keep));
            };
            MonthsPanel.Children.Add(earlier);
        }
        for (var month = _shownFirst; month <= MonthStart(_today); month = month.AddMonths(1))
        {
            var panel = BuildMonth(month); _months[month] = panel; MonthsPanel.Children.Add(panel);
        }
        UpdateSelectionVisuals();
    }
    private FrameworkElement BuildMonth(DateOnly month)
    {
        var p = _preferences; var compact = p.CalendarCompact;
        var accessibilityContrast = new AccessibilitySettings().HighContrast;
        var outer = ReportUi.Panel(month.ToString(p.Language == "zh-CN" ? "yyyy 年 M 月" : "MMMM yyyy", p.Language == "zh-CN" ? CultureInfo.GetCultureInfo("zh-CN") : CultureInfo.GetCultureInfo("en-US")), out var body);
        var grid = new Grid { ColumnSpacing = compact ? 3 : 5, RowSpacing = compact ? 3 : 5 };
        for (var i = 0; i < 8; i++) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(i == 7 ? .62 : 1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var labels = p.Language == "zh-CN" ? new[] { "一", "二", "三", "四", "五", "六", "日", "周" } : new[] { "M", "T", "W", "T", "F", "S", "S", "Wk" };
        for (var i = 0; i < labels.Length; i++)
        {
            var label = ReportUi.Text(labels[i], 13, true); label.HorizontalAlignment = HorizontalAlignment.Center;
            Grid.SetColumn(label, i); grid.Children.Add(label);
        }
        var offset = ((int)month.DayOfWeek + 6) % 7;
        var count = DateTime.DaysInMonth(month.Year, month.Month);
        var weekRows = (offset + count + 6) / 7;
        for (var week = 0; week < weekRows; week++)
        {
            grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(compact ? 24 : 80) });
            var monday = month.AddDays(week * 7 - offset);
            var weekNumber = ISOWeek.GetWeekOfYear(monday.ToDateTime(TimeOnly.MinValue));
            var weekButton = new Button { Content = weekNumber.ToString(CultureInfo.InvariantCulture), FontSize = 13, Padding = new Thickness(1), MinWidth = 0, MinHeight = 0, HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch, Background = ReportUi.B("BgBrush"), Foreground = ReportUi.B("SignalBrush"), BorderThickness = new Thickness(0), Tag = monday };
            var weekDays = Enumerable.Range(0, 7).Select(i => monday.AddDays(i)).Where(d => d >= _firstDay && d <= _today).ToList();
            var weekTokens = weekDays.Sum(d => _days.TryGetValue(d, out var row) ? ReportUi.N(row, "totalTokens") : 0);
            var tooltip = $"{p.T("第", "Week ")}{weekNumber}{p.T("周", "")} · {ReportUi.Int(weekTokens)} tokens";
            ToolTipService.SetToolTip(weekButton, tooltip); AutomationProperties.SetName(weekButton, tooltip);
            weekButton.IsEnabled = weekDays.Count > 0;
            weekButton.Click += async (_, _) =>
            {
                if (!IsKeyDown(VirtualKey.Control)) _selection.Clear();
                foreach (var day in weekDays) _selection.Add(day);
                _anchor = weekDays.FirstOrDefault(_today); _focused = weekDays.LastOrDefault(_today);
                UpdateSelectionVisuals(); await LoadSelectionAsync();
            };
            Grid.SetColumn(weekButton, 7); Grid.SetRow(weekButton, week + 1); grid.Children.Add(weekButton);
        }
        for (var day = 1; day <= count; day++)
        {
            var date = new DateOnly(month.Year, month.Month, day); var index = offset + day - 1;
            var valid = date >= _firstDay && date <= _today;
            var totals = _days.GetValueOrDefault(date); var tokens = ReportUi.N(totals, "totalTokens");
            var level = tokens <= 0 || _maxTokens <= 0 ? 0 : Math.Clamp((int)Math.Ceiling(Math.Sqrt(tokens / _maxTokens) * 4), 1, 4);
            var content = new StackPanel { Spacing = 4 };
            var number = ReportUi.Text(compact ? "" : day.ToString(CultureInfo.InvariantCulture), 13);
            number.IsTextSelectionEnabled = false; content.Children.Add(number);
            if (!compact)
            {
                var usage = ReportUi.Text(tokens > 0 ? ReportUi.Tokens(tokens) : "—", 13); usage.IsTextSelectionEnabled = false;
                content.Children.Add(usage);
            }
            var highContrast = level >= 3;
            foreach (var text in content.Children.OfType<TextBlock>()) text.Foreground = highContrast && !accessibilityContrast ? new SolidColorBrush(ActualTheme == ElementTheme.Dark ? Colors.Black : Colors.White) : ReportUi.B("InkBrush");
            var opacity = new[] { .045, .12, .26, .50, .84 }[level];
            var ink = ActualTheme == ElementTheme.Dark ? (byte)236 : (byte)24;
            var button = new Button
            {
                Content = content, Tag = date, Padding = compact ? new Thickness(0) : new Thickness(5), MinWidth = 0, MinHeight = 0,
                HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch,
                VerticalContentAlignment = VerticalAlignment.Top, Background = accessibilityContrast ? ReportUi.B("SurfaceBrush") : new SolidColorBrush(ColorHelper.FromArgb((byte)(opacity * 255), ink, ink, ink)),
                CornerRadius = new CornerRadius(compact ? 3 : 4), BorderThickness = new Thickness(2), BorderBrush = new SolidColorBrush(Colors.Transparent),
                IsEnabled = valid, IsTabStop = date == _focused,
            };
            var tooltip = $"{Key(date)} · {ReportUi.Int(tokens)} tokens · {(totals is null ? "$0.00" : ReportUi.Cost(totals, p))}";
            ToolTipService.SetToolTip(button, tooltip); AutomationProperties.SetName(button, tooltip);
            button.Click += async (_, _) => { if (_dragging) return; SelectDay(date, IsKeyDown(VirtualKey.Shift), IsKeyDown(VirtualKey.Control)); await LoadSelectionAsync(); };
            button.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler(Day_PointerPressed), true);
            button.GotFocus += (_, _) => { _focused = date; UpdateTabStops(); };
            Grid.SetRow(button, index / 7 + 1); Grid.SetColumn(button, index % 7); grid.Children.Add(button);
            _buttons[date] = button;
        }
        body.Children.Add(grid);
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
            button.BorderBrush = _selection.Contains(date) ? ReportUi.B("SignalBrush") : date == _today ? ReportUi.B("MutedBrush") : new SolidColorBrush(Colors.Transparent);
            AutomationProperties.SetItemStatus(button, _selection.Contains(date) ? _preferences.T("已选中", "Selected") : "");
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
    private void RenderDetails(JsonNode data, DateOnly[] selected)
    {
        var p = _preferences; DetailPanel.Children.Clear();
        var title = selected.Length == 1 ? Key(selected[0]) : $"{Key(selected[0])} — {Key(selected[^1])} · {selected.Length} {p.T("天", "days")}";
        var heading = ReportUi.Text(title, 18); heading.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold; DetailPanel.Children.Add(heading);
        DetailPanel.Children.Add(ReportUi.Text(p.TimeZone, 13, true));
        if (selected.Length > 1 && selected.Length != selected[^1].DayNumber - selected[0].DayNumber + 1)
            DetailPanel.Children.Add(ReportUi.Text(p.T("非连续选区：", "Non-contiguous selection: ") + string.Join(", ", selected.Select(Key)), 13, true));
        DetailPanel.Children.Add(ReportUi.Kpis(data, p));
        if (selected.Length == 1)
        {
            var navigation = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var previous = new Button { Content = p.T("← 前一天", "← Previous day"), IsEnabled = selected[0] > _firstDay };
            var next = new Button { Content = p.T("后一天 →", "Next day →"), IsEnabled = selected[0] < _today };
            previous.Click += async (_, _) => { SelectDay(selected[0].AddDays(-1), false, false); ScrollToDate(_focused); await LoadSelectionAsync(); };
            next.Click += async (_, _) => { SelectDay(selected[0].AddDays(1), false, false); ScrollToDate(_focused); await LoadSelectionAsync(); };
            navigation.Children.Add(previous); navigation.Children.Add(next); DetailPanel.Children.Add(navigation);
            DetailPanel.Children.Add(ReportUi.Hourly(data, p));
        }
        if (ReportUi.N(data["totals"], "requests") == 0) DetailPanel.Children.Add(ReportUi.Text(p.T("选区内没有会话记录。", "No sessions in the selected dates."), 14, true));
        DetailPanel.Children.Add(ReportUi.Breakdown(data, p));
        DetailPanel.Children.Add(ReportUi.Agents(data, p, true));
        DetailPanel.Children.Add(ReportUi.Sessions(data, p));
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
    private void SetCompact(bool compact)
    {
        if (_preferences.CalendarCompact == compact) return;
        var anchor = _focused;
        var oldPosition = _buttons.TryGetValue(anchor, out var button) ? button.TransformToVisual(MonthScroller).TransformPoint(new Point()).Y : 0;
        var oldRects = new Dictionary<DateOnly, Rect>();
        if (new UISettings().AnimationsEnabled)
        {
            foreach (var (date, dayButton) in _buttons)
            {
                var point = dayButton.TransformToVisual(MonthScroller).TransformPoint(new Point());
                if (point.Y + dayButton.ActualHeight >= 0 && point.Y < MonthScroller.ActualHeight)
                    oldRects[date] = new Rect(point.X, point.Y, dayButton.ActualWidth, dayButton.ActualHeight);
            }
        }
        _preferences.CalendarCompact = compact; CompactButton.IsChecked = compact;
        try { _preferences.Save(); } catch (Exception ex) { ShowError(ex.Message); }
        RenderMonths();
        DispatcherQueue.TryEnqueue(() =>
        {
            MonthsPanel.UpdateLayout();
            if (_buttons.TryGetValue(anchor, out var anchorButton))
            {
                var target = anchorButton.TransformToVisual(MonthsPanel).TransformPoint(new Point()).Y;
                MonthScroller.ChangeView(null, Math.Max(0, target - Math.Max(0, oldPosition)), null, true);
            }
            MonthsPanel.UpdateLayout();
            if (!new UISettings().AnimationsEnabled) return;
            // FLIP in the composition layer: measure both layouts, translate and
            // scale the new cells from the old rectangles without reflowing on
            // every animation frame. The selected date remains the scroll anchor.
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
        });
    }
    private void Compact_Click(object sender, RoutedEventArgs e) => SetCompact(CompactButton.IsChecked == true);
    private void Calendar_Wheel(object sender, PointerRoutedEventArgs e)
    {
        if (!IsKeyDown(VirtualKey.Control)) return;
        e.Handled = true; SetCompact(e.GetCurrentPoint(MonthScroller).Properties.MouseWheelDelta < 0);
    }
    private async void Today_Click(object sender, RoutedEventArgs e)
    {
        SelectDay(_today, false, false); ScrollToDate(_today); await LoadSelectionAsync();
    }
    private void Month_Changed(object sender, SelectionChangedEventArgs e)
    {
        if (_monthPickerUpdating || MonthPicker.SelectedItem is not string key || !DateOnly.TryParseExact(key + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var month)) return;
        if (month < _shownFirst) { _shownFirst = month; RenderMonths(); }
        DispatcherQueue.TryEnqueue(() => ScrollToDate(month));
    }
    private void ScrollToDate(DateOnly date)
    {
        if (date < _shownFirst) { _shownFirst = MonthStart(date); RenderMonths(); }
        if (_months.TryGetValue(MonthStart(date), out var panel))
        {
            MonthsPanel.UpdateLayout();
            var y = panel.TransformToVisual(MonthsPanel).TransformPoint(new Point()).Y;
            MonthScroller.ChangeView(null, Math.Max(0, y), null, true);
        }
    }
    private void Calendar_Scrolled(object sender, ScrollViewerViewChangedEventArgs e)
    {
        if (!e.IsIntermediate) foreach (var button in _buttons.Values) if (ToolTipService.GetToolTip(button) is ToolTip tip) tip.IsOpen = false;
    }
    private void Page_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        var stacked = e.NewSize.Width < 980;
        if (_stacked == stacked) return; _stacked = stacked;
        Workspace.ColumnDefinitions.Clear(); Workspace.RowDefinitions.Clear();
        if (stacked)
        {
            Workspace.ColumnDefinitions.Add(new ColumnDefinition()); Workspace.RowDefinitions.Add(new RowDefinition()); Workspace.RowDefinitions.Add(new RowDefinition());
            Grid.SetColumn(DetailScroller, 0); Grid.SetRow(DetailScroller, 1);
        }
        else
        {
            Workspace.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1.2, GridUnitType.Star) }); Workspace.ColumnDefinitions.Add(new ColumnDefinition());
            Grid.SetColumn(DetailScroller, 1); Grid.SetRow(DetailScroller, 0);
        }
    }
    private void ShowError(string message) { ErrorBar.Message = message; ErrorBar.IsOpen = true; }
    private async void Retry_Click(object sender, RoutedEventArgs e) => await ReloadAsync();
    public void OnLeaving()
    {
        ++_historySequence; ++_detailSequence; _historyRequest?.Cancel(); _selectionRequest?.Cancel(); EndDrag();
        _historyLoading = false; _detailLoading = false;
    }
}
