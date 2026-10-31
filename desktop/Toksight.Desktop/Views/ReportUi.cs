using System.Globalization;
using System.Numerics;
using System.Text.Json.Nodes;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Toksight.Desktop.Services;
using Windows.System;
using Windows.UI.ViewManagement;

namespace Toksight.Desktop.Views;

// Native counterparts of the report design system. All calculations keep the
// committed API snapshot's token and pricing semantics.
internal static class ReportUi
{
    private static readonly object AnimationTag = new(), RiseTag = new();
    private static readonly string[] Parts = ["inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens"];
    private static readonly string[] PartBrushes = ["SignalBrush", "TokenReadBrush", "TokenWriteBrush", "TokenOutputBrush"];
    internal static double N(JsonNode? n, string key = "")
    {
        n = string.IsNullOrEmpty(key) ? n : n?[key];
        return double.TryParse(n?.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var value) && double.IsFinite(value) ? value : 0;
    }
    internal static string S(JsonNode? n, string key = "", string fallback = "") => (string.IsNullOrEmpty(key) ? n : n?[key])?.ToString() ?? fallback;
    internal static IEnumerable<JsonNode> A(JsonNode? n, string key = "") => ((string.IsNullOrEmpty(key) ? n : n?[key]) as JsonArray)?.OfType<JsonNode>() ?? Enumerable.Empty<JsonNode>();
    internal static Brush B(string key) => DesktopPalette.Brush(key);
    internal static TextBlock Text(string value, double size = 14, bool muted = false) => new()
    {
        Text = value, FontSize = size, Foreground = B(muted ? "MutedBrush" : "InkBrush"), TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true,
    };
    private static TextBlock Single(string value, double size = 14, bool muted = false, bool right = false)
    {
        var text = Text(value, size, muted); text.TextWrapping = TextWrapping.NoWrap; text.TextTrimming = TextTrimming.CharacterEllipsis;
        text.VerticalAlignment = VerticalAlignment.Center; text.TextAlignment = right ? TextAlignment.Right : TextAlignment.Left; return text;
    }
    private static void Mono(TextBlock text) => text.FontFamily = (FontFamily)Application.Current.Resources["MonoFontFamily"];
    private static TextBlock Strong(string value, double size = 14)
    {
        var text = Single(value, size); text.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold; return text;
    }
    internal static string Int(double value) => value.ToString("N0", CultureInfo.CurrentCulture);
    internal static string Tokens(double value)
    {
        var absolute = Math.Abs(value);
        if (absolute < 1000) return Int(value);
        if (absolute < 1e6) return (value / 1e3).ToString(absolute < 1e5 ? "0.0" : "0", CultureInfo.InvariantCulture) + "K";
        if (absolute < 1e9) return (value / 1e6).ToString(absolute < 1e8 ? "0.00" : "0.0", CultureInfo.InvariantCulture) + "M";
        return (value / 1e9).ToString("0.00", CultureInfo.InvariantCulture) + "B";
    }
    internal static string Money(double value)
    {
        var absolute = Math.Abs(value);
        return "$" + value.ToString(absolute >= 1000 ? "N0" : absolute >= 1 ? "0.00" : absolute >= .1 ? "0.000" : absolute >= .0001 ? "0.0000" : absolute == 0 ? "0" : "0.00E+0", CultureInfo.InvariantCulture);
    }
    private static double? CacheRate(JsonNode? row)
    {
        var denominator = N(row, "inputTokens") + N(row, "cacheReadTokens");
        return denominator > 0 ? N(row, "cacheReadTokens") / denominator : null;
    }
    internal static string Rate(JsonNode? row) => CacheRate(row)?.ToString("P1", CultureInfo.CurrentCulture) ?? "—";
    internal static string Cost(JsonNode? row, DesktopPreferences p)
    {
        var requests = N(row, "requests"); var priced = N(row, "pricedRequests");
        return requests > 0 && priced == 0 ? p.T("未定价", "Unpriced") : Money(N(row, "costUsd")) + (priced < requests ? " *" : "");
    }
    internal static string Agent(string name) => name switch
    {
        "claude" => "Claude Code", "codex" => "Codex", "kimi" => "Kimi Code", "opencode" => "OpenCode", "zcode" => "ZCode", _ => name,
    };
    internal static string Stamp(JsonNode? n, string zone)
    {
        if (n is null) return "—";
        DateTimeOffset timestamp;
        if (double.TryParse(n.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var milliseconds))
        {
            try { timestamp = DateTimeOffset.FromUnixTimeMilliseconds((long)milliseconds); } catch { return "—"; }
        }
        else if (!DateTimeOffset.TryParse(n.ToString(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out timestamp)) return "—";
        try { return TimeZoneInfo.ConvertTime(timestamp, TimeZoneInfo.FindSystemTimeZoneById(zone)).ToString("yyyy-MM-dd HH:mm"); }
        catch { return timestamp.ToLocalTime().ToString("yyyy-MM-dd HH:mm"); }
    }
    private static string Clock(JsonNode? n, string zone) { var stamp = Stamp(n, zone); return stamp.Length >= 16 ? stamp[11..] : stamp; }
    private static Border Hairline() => new() { Height = 1, Background = B("LineBrush"), HorizontalAlignment = HorizontalAlignment.Stretch };
    internal static Grid Header(string title, string icon = "", string? subtitle = null, FrameworkElement? action = null)
    {
        var grid = new Grid { MinHeight = 28, ColumnSpacing = 10 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); grid.ColumnDefinitions.Add(new ColumnDefinition()); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var name = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        if (icon.Length > 0) name.Children.Add(NativeIcons.Create(icon, 16, "MutedBrush"));
        name.Children.Add(Strong(title, 15)); grid.Children.Add(name);
        if (!string.IsNullOrWhiteSpace(subtitle)) { var sub = Single(subtitle, 13, true); Grid.SetColumn(sub, 1); grid.Children.Add(sub); }
        if (action is not null) { action.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(action, 2); grid.Children.Add(action); }
        return grid;
    }
    internal static Border Panel(string title, out StackPanel content)
    {
        content = new StackPanel { Spacing = 12 };
        if (title.Length > 0) content.Children.Add(Header(title));
        return new Border { Background = B("SurfaceBrush"), CornerRadius = new CornerRadius(8), Padding = new Thickness(16, 12, 16, 12), Child = content };
    }
    internal static Grid Columns(params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        for (var i = 0; i < children.Length; i++) { grid.ColumnDefinitions.Add(new ColumnDefinition()); Grid.SetColumn(children[i], i); grid.Children.Add(children[i]); }
        return grid;
    }
    internal static Button Ghost(string label, string? icon = null)
    {
        var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 5, VerticalAlignment = VerticalAlignment.Center };
        if (icon is not null) content.Children.Add(NativeIcons.Create(icon, 15, "MutedBrush"));
        var text = Single(label, 13, true); text.IsTextSelectionEnabled = false; content.Children.Add(text);
        return new Button { Content = content, Padding = new Thickness(6, 3, 6, 3), MinHeight = 28, MinWidth = 0, BorderThickness = new Thickness(0), Background = new SolidColorBrush(Colors.Transparent), HorizontalContentAlignment = HorizontalAlignment.Center };
    }
    private static Button IconButton(string icon, string label)
    {
        var button = new Button { Content = NativeIcons.Create(icon, 15, "MutedBrush"), Width = 28, Height = 28, MinWidth = 0, MinHeight = 0, Padding = new Thickness(6), BorderThickness = new Thickness(0), Background = new SolidColorBrush(Colors.Transparent), CornerRadius = new CornerRadius(6) };
        ToolTipService.SetToolTip(button, label); AutomationProperties.SetName(button, label); return button;
    }
    internal static FrameworkElement Segmented(string[] labels, int selected, Action<int> changed)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2 }; var buttons = new List<Button>();
        void Select(int index, bool focus = false)
        {
            var previous = selected; selected = Math.Clamp(index, 0, labels.Length - 1);
            for (var i = 0; i < buttons.Count; i++)
            {
                buttons[i].Background = i == selected ? B("SurfaceBrush") : new SolidColorBrush(Colors.Transparent);
                buttons[i].Foreground = B(i == selected ? "InkBrush" : "MutedBrush");
                buttons[i].FontWeight = i == selected ? Microsoft.UI.Text.FontWeights.SemiBold : Microsoft.UI.Text.FontWeights.Normal;
                buttons[i].IsTabStop = i == selected; AutomationProperties.SetItemStatus(buttons[i], i == selected ? "Selected" : "");
            }
            if (focus) buttons[selected].Focus(FocusState.Keyboard); if (previous != selected) changed(selected);
        }
        for (var i = 0; i < labels.Length; i++)
        {
            var index = i; var button = new Button { Content = labels[i], FontSize = 13, MinHeight = 24, Height = 24, MinWidth = 0, Padding = new Thickness(8, 0, 8, 0), BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(4) };
            button.Click += (_, _) => Select(index);
            button.KeyDown += (_, e) =>
            {
                if (e.Key is VirtualKey.Left or VirtualKey.Up) { Select((selected + labels.Length - 1) % labels.Length, true); e.Handled = true; }
                else if (e.Key is VirtualKey.Right or VirtualKey.Down) { Select((selected + 1) % labels.Length, true); e.Handled = true; }
                else if (e.Key == VirtualKey.Home) { Select(0, true); e.Handled = true; }
                else if (e.Key == VirtualKey.End) { Select(labels.Length - 1, true); e.Handled = true; }
            };
            buttons.Add(button); row.Children.Add(button);
        }
        Select(selected);
        return new Border { Child = row, Padding = new Thickness(2), CornerRadius = new CornerRadius(6), Background = B("Surface3Brush"), HorizontalAlignment = HorizontalAlignment.Right };
    }
    private static Border Chip(string label, bool accent = false, string? icon = null)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2 };
        if (icon is not null) row.Children.Add(NativeIcons.Create(icon, 13, accent ? "SignalInkBrush" : "MutedBrush"));
        var text = Single(label, 13); text.Foreground = B(accent ? "SignalInkBrush" : "MutedBrush"); row.Children.Add(text);
        return new Border { Child = row, Padding = new Thickness(4, 1, 4, 1), CornerRadius = new CornerRadius(4), Background = B(accent ? "SignalSoftBrush" : "Surface3Brush"), VerticalAlignment = VerticalAlignment.Center };
    }
    internal static FrameworkElement Kpis(JsonNode data, DesktopPreferences p, bool comparison = false)
    {
        var panel = Panel("", out var body); var totals = data["totals"];
        if (comparison)
        {
            var caption = new Grid { ColumnSpacing = 12 }; caption.ColumnDefinitions.Add(new ColumnDefinition()); caption.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var dayLabel = S(data["view"], "today");
            if (DateOnly.TryParse(dayLabel, CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
                dayLabel = p.Language == "zh-CN" ? $"{day.Month}月{day.Day}日 {new[] { "周日", "周一", "周二", "周三", "周四", "周五", "周六" }[(int)day.DayOfWeek]}" : day.ToString("MMM d, ddd", CultureInfo.GetCultureInfo("en-US"));
            caption.Children.Add(Single($"{dayLabel} · {p.T("截至", "As of")} {Clock(data["generatedAt"], p.TimeZone)}", 13, true));
            if (data["comparison"]?["previous"] is not null) { var basis = Single(p.T("对比昨日全天", "Compared with all of yesterday"), 13, true); Grid.SetColumn(basis, 1); caption.Children.Add(basis); }
            body.Children.Add(caption);
        }
        var labels = new[] { "Tokens", p.T("参考费用", "Reference cost"), p.T("缓存命中率", "Cache hit rate"), p.T("请求", "Requests") };
        var icons = new[] { "Layers3", "Coins", "Zap", "MessagesSquare" };
        var values = new[] { Tokens(N(totals, "totalTokens")), Cost(totals, p), Rate(totals), Int(N(totals, "requests")) };
        var unpriced = A(data["pricing"], "unpricedModels").Count();
        var sub = new[]
        {
            $"{p.T("输入", "Input")} {Tokens(N(totals, "inputTokens") + N(totals, "cacheReadTokens") + N(totals, "cacheWriteTokens"))} · {p.T("输出", "Output")} {Tokens(N(totals, "outputTokens"))}",
            unpriced > 0 ? $"{unpriced} {p.T("个模型未定价", "unpriced models")}" : N(totals, "totalTokens") > 0 ? p.T("每百万 tokens ", "Per million tokens ") + Money(N(totals, "costUsd") / N(totals, "totalTokens") * 1e6) : p.T("美元 · 参考费用", "USD · Estimated cost"),
            p.T("缓存读取 ", "Cache read ") + Tokens(N(totals, "cacheReadTokens")), Int(N(totals, "sessions")) + p.T(" 个会话", " sessions"),
        };
        var grid = new Grid { ColumnSpacing = 0, RowSpacing = 12 }; var cells = new List<Border>();
        for (var i = 0; i < labels.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition()); var stack = new StackPanel { Spacing = 5 };
            var label = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            label.Children.Add(NativeIcons.Create(icons[i], 15, "MutedBrush")); label.Children.Add(Single(labels[i], 13, true)); stack.Children.Add(label);
            var reading = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var value = Strong(values[i], i == 1 && N(totals, "requests") > 0 && N(totals, "pricedRequests") == 0 ? 22 : comparison ? 30 : 26);
            value.CharacterSpacing = -15; reading.Children.Add(value);
            if (comparison && i < 2)
            {
                var previous = data["comparison"]?["previous"]?["totals"]; var key = i == 0 ? "totalTokens" : "costUsd"; var before = N(previous, key);
                var complete = i == 0 || (N(totals, "pricedRequests") == N(totals, "requests") && N(previous, "pricedRequests") == N(previous, "requests"));
                if (before > 0 && complete)
                {
                    var delta = (N(totals, key) - before) / before; var chip = Chip((Math.Abs(delta) * 100).ToString("0.0", CultureInfo.InvariantCulture) + "%", delta >= 0, delta >= 0 ? "ArrowUpRight" : "ArrowDownRight");
                    ToolTipService.SetToolTip(chip, p.T("对比昨日全天", "Compared with all of yesterday")); reading.Children.Add(chip);
                }
            }
            stack.Children.Add(reading); stack.Children.Add(Single(sub[i], 13, true));
            var cell = new Border { Child = stack, Padding = new Thickness(i == 0 ? 0 : 16, 0, i == 3 ? 0 : 16, 0), BorderBrush = B("LineBrush"), BorderThickness = new Thickness(i == 0 ? 0 : 1, 0, 0, 0) };
            cells.Add(cell); Grid.SetColumn(cell, i); grid.Children.Add(cell);
        }
        bool? wasCompact = null;
        grid.SizeChanged += (_, e) =>
        {
            var compact = e.NewSize.Width < 760; if (wasCompact == compact) return; wasCompact = compact;
            grid.ColumnDefinitions.Clear(); grid.RowDefinitions.Clear();
            for (var i = 0; i < (compact ? 2 : 4); i++) grid.ColumnDefinitions.Add(new ColumnDefinition());
            if (compact) { grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto }); }
            for (var i = 0; i < cells.Count; i++)
            {
                var first = i % (compact ? 2 : 4) == 0; Grid.SetColumn(cells[i], i % (compact ? 2 : 4)); Grid.SetRow(cells[i], compact ? i / 2 : 0);
                cells[i].BorderThickness = new Thickness(first ? 0 : 1, compact && i >= 2 ? 1 : 0, 0, 0);
                cells[i].Padding = new Thickness(first ? 0 : 16, compact && i >= 2 ? 12 : 0, i % (compact ? 2 : 4) == (compact ? 1 : 3) ? 0 : 16, 0);
            }
        };
        body.Children.Add(grid);
        if (N(data["costCoverage"], "unpricedRequests") > 0) body.Children.Add(Text($"* {Int(N(data["costCoverage"], "unpricedRequests"))} {p.T("条请求未定价；费用仅包含已定价部分。", "requests are unpriced; cost includes priced requests only.")}", 13, true));
        return panel;
    }
    internal static FrameworkElement Chart(IEnumerable<JsonNode> source, bool cost, string tokenKey, Func<JsonNode, string> label, DesktopPreferences p, double height = 142)
    {
        var rows = source.ToList(); var max = rows.Select(r => N(r, cost ? "costUsd" : tokenKey)).DefaultIfEmpty(0).Max();
        string Format(double value) => cost ? Money(value) : Tokens(value);
        var chart = new Grid { ColumnSpacing = 8 };
        chart.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(44) }); chart.ColumnDefinitions.Add(new ColumnDefinition());
        chart.RowDefinitions.Add(new RowDefinition { Height = new GridLength(22) }); chart.RowDefinitions.Add(new RowDefinition { Height = new GridLength(height) }); chart.RowDefinitions.Add(new RowDefinition { Height = new GridLength(26) });
        var axis = new Grid(); Grid.SetRow(axis, 1); chart.Children.Add(axis);
        foreach (var (amount, align) in new[] { (max, VerticalAlignment.Top), (max / 2, VerticalAlignment.Center), (0d, VerticalAlignment.Bottom) })
        { var text = Single(Format(amount), 13, true, true); text.VerticalAlignment = align; axis.Children.Add(text); }
        var plot = new Grid(); Grid.SetColumn(plot, 1); Grid.SetRow(plot, 1); chart.Children.Add(plot);
        foreach (var align in new[] { VerticalAlignment.Top, VerticalAlignment.Center, VerticalAlignment.Bottom }) plot.Children.Add(new Border { Height = 1, Background = B("LineBrush"), VerticalAlignment = align, IsHitTestVisible = false });
        var bars = new Grid { ColumnSpacing = 3 }; plot.Children.Add(bars);
        // A separate canvas lets the peak label span several narrow hour columns.
        var flags = new Canvas { Height = 22, HorizontalAlignment = HorizontalAlignment.Stretch, IsHitTestVisible = false };
        Grid.SetColumn(flags, 1); chart.Children.Add(flags);
        var peak = rows.FindIndex(row => N(row, cost ? "costUsd" : tokenKey) == max && max > 0);
        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i]; var amount = N(row, cost ? "costUsd" : tokenKey); var isPeak = i == peak;
            bars.ColumnDefinitions.Add(new ColumnDefinition());
            var bar = new Border { Height = amount > 0 && max > 0 ? Math.Max(3, amount / max * height) : 0, MinWidth = 1, HorizontalAlignment = HorizontalAlignment.Stretch, Background = B(isPeak ? "SignalBrush" : "ChartBrush"), CornerRadius = new CornerRadius(2, 2, 0, 0), VerticalAlignment = VerticalAlignment.Bottom };
            var button = new Button { Content = bar, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch, VerticalContentAlignment = VerticalAlignment.Bottom, Background = new SolidColorBrush(Colors.Transparent), BorderThickness = new Thickness(0), Padding = new Thickness(0), VerticalAlignment = VerticalAlignment.Stretch, MinWidth = 0, MinHeight = 0, IsTabStop = amount > 0, CornerRadius = new CornerRadius(2) };
            var tip = $"{label(row)}\nTokens  {Int(N(row, tokenKey))}\n{p.T("参考费用", "Reference cost")}  {Money(N(row, "costUsd"))}\n{p.T("请求", "Requests")}  {Int(N(row, "requests"))}";
            ToolTipService.SetToolTip(button, tip); AutomationProperties.SetName(button, label(row) + " · " + Format(amount));
            button.PointerEntered += (_, _) => bar.Background = B("SignalBrush"); button.PointerExited += (_, _) => bar.Background = B(isPeak ? "SignalBrush" : "ChartBrush");
            button.GotFocus += (_, _) => bar.Background = B("SignalBrush"); button.LostFocus += (_, _) => bar.Background = B(isPeak ? "SignalBrush" : "ChartBrush");
            Grid.SetColumn(button, i); bars.Children.Add(button); Rise(bar);
            if (isPeak)
            {
                var value = Single(Format(max), 13); value.Foreground = new SolidColorBrush(Colors.White); value.TextAlignment = TextAlignment.Center;
                var flag = new Border { Child = value, Background = B("SignalBrush"), CornerRadius = new CornerRadius(4), Padding = new Thickness(4, 0, 4, 0), Width = Math.Max(38, Format(max).Length * 7 + 8), Height = 19, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Top, IsHitTestVisible = false };
                var column = i;
                void PositionFlag()
                {
                    var columnWidth = Math.Max(0, (flags.ActualWidth - 3 * (rows.Count - 1)) / rows.Count);
                    var center = column * (columnWidth + 3) + columnWidth / 2;
                    Canvas.SetLeft(flag, Math.Clamp(center - flag.Width / 2, 0, Math.Max(0, flags.ActualWidth - flag.Width)));
                }
                flags.Children.Add(flag); flags.SizeChanged += (_, _) => PositionFlag(); flags.Loaded += (_, _) => PositionFlag();
            }
        }
        var xaxis = new Grid { Margin = new Thickness(0, 4, 0, 0) }; Grid.SetColumn(xaxis, 1); Grid.SetRow(xaxis, 2); chart.Children.Add(xaxis);
        var hourly = rows.Count == 24 && rows.All(r => r["hour"] is not null);
        var texts = hourly ? new[] { "00:00", "06:00", "12:00", "18:00", "24:00" } : rows.Count > 0 ? new[] { label(rows[0]), label(rows[^1]) } : Array.Empty<string>();
        for (var i = 0; i < texts.Length; i++)
        {
            xaxis.ColumnDefinitions.Add(new ColumnDefinition()); var text = Single(texts[i], 13, true); text.HorizontalAlignment = i == 0 ? HorizontalAlignment.Left : i == texts.Length - 1 ? HorizontalAlignment.Right : HorizontalAlignment.Center; Grid.SetColumn(text, i); xaxis.Children.Add(text);
        }
        AutomationProperties.SetName(chart, p.T("用量柱状图；可用 Tab 查看每根柱的数值。", "Usage chart. Tab to inspect individual bars.")); return chart;
    }
    internal static FrameworkElement Hourly(JsonNode data, DesktopPreferences p)
    {
        var panel = Panel("", out var body); var metric = 0; var host = new ContentControl { HorizontalContentAlignment = HorizontalAlignment.Stretch };
        var footer = new Grid(); footer.ColumnDefinitions.Add(new ColumnDefinition()); footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        void Render()
        {
            var rows = A(data, "hourly").ToList(); host.Content = Chart(rows, metric == 1, "tokens", row => $"{N(row, "hour"):00}:00", p); footer.Children.Clear();
            var legend = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 }; legend.Children.Add(new Border { Width = 7, Height = 7, CornerRadius = new CornerRadius(2), Background = B("ChartBrush"), VerticalAlignment = VerticalAlignment.Center }); legend.Children.Add(Single(metric == 0 ? "Tokens" : p.T("参考费用", "Reference cost"), 13, true)); footer.Children.Add(legend);
            var peak = rows.OrderByDescending(row => N(row, metric == 0 ? "tokens" : "costUsd")).FirstOrDefault(); var max = N(peak, metric == 0 ? "tokens" : "costUsd");
            var peakRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 }; peakRow.Children.Add(Single(max > 0 ? $"{N(peak, "hour"):00}:00 · {(metric == 0 ? Tokens(max) : Money(max))}" : p.T("无活动", "No activity"), 13, true));
            if (max > 0) peakRow.Children.Add(Chip(p.T("峰值", "Peak"), true)); Grid.SetColumn(peakRow, 1); footer.Children.Add(peakRow);
        }
        var segmented = Segmented(["Tokens", p.T("费用", "Cost")], 0, index => { metric = index; Render(); });
        body.Children.Add(Header(p.T("时段分布", "Hourly usage"), "ChartColumn", p.T("24 小时 · 按统计时区", "24 hours · Report time zone"), segmented));
        body.Children.Add(host); body.Children.Add(footer); Render(); return panel;
    }
    private static string[] PartLabels(DesktopPreferences p) => [p.T("输入", "Input"), p.T("缓存读取", "Cache read"), p.T("缓存写入", "Cache write"), p.T("输出", "Output")];
    private static Grid PartsBar(JsonNode? row, double height = 12)
    {
        var total = N(row, "totalTokens"); var strip = new Grid { Height = height, ColumnSpacing = height > 6 ? 2 : 1, CornerRadius = new CornerRadius(height > 6 ? 4 : 2), Background = B("Surface2Brush"), VerticalAlignment = VerticalAlignment.Center }; var column = 0;
        for (var i = 0; i < Parts.Length; i++)
        {
            var amount = N(row, Parts[i]); if (amount <= 0 || total <= 0) continue;
            strip.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(amount, GridUnitType.Star) }); var block = new Border { Background = B(PartBrushes[i]) }; Grid.SetColumn(block, column++); strip.Children.Add(block);
        }
        return strip;
    }
    internal static FrameworkElement Breakdown(JsonNode data, DesktopPreferences p)
    {
        var panel = Panel("", out var body); body.Children.Add(Header(p.T("Token 构成", "Token breakdown"), "ChartPie", null, Single(p.T("合计", "Total"), 13, true)));
        var row = data["totals"]; var total = N(row, "totalTokens"); var readout = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 2, 0, 0) };
        var value = Strong(Tokens(total), 22); value.CharacterSpacing = -15; readout.Children.Add(value); var unit = Single("Tokens", 13, true); unit.VerticalAlignment = VerticalAlignment.Bottom; readout.Children.Add(unit); body.Children.Add(readout);
        var strip = PartsBar(row); AutomationProperties.SetName(strip, p.T("Token 构成", "Token breakdown")); body.Children.Add(strip);
        var legend = new StackPanel { Spacing = 7 }; var labels = PartLabels(p);
        for (var i = 0; i < Parts.Length; i++)
        {
            var line = new Grid { ColumnSpacing = 8, MinHeight = 19 };
            foreach (var width in new[] { GridLength.Auto, new GridLength(1, GridUnitType.Star), GridLength.Auto, new GridLength(48) }) line.ColumnDefinitions.Add(new ColumnDefinition { Width = width });
            var label = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7 }; label.Children.Add(new Border { Width = 7, Height = 7, CornerRadius = new CornerRadius(2), Background = B(PartBrushes[i]), VerticalAlignment = VerticalAlignment.Center }); label.Children.Add(Single(labels[i], 14, true)); line.Children.Add(label);
            var leader = new Line { X1 = 0, X2 = 100, Y1 = 0, Y2 = 0, Stretch = Stretch.Fill, Height = 1, StrokeThickness = 1, Stroke = B("LineBrush"), StrokeDashArray = new DoubleCollection { 1, 3 }, VerticalAlignment = VerticalAlignment.Center }; Grid.SetColumn(leader, 1); line.Children.Add(leader);
            var count = Single(Tokens(N(row, Parts[i])), 14, false, true); count.FontWeight = Microsoft.UI.Text.FontWeights.Medium; Grid.SetColumn(count, 2); line.Children.Add(count);
            var share = Single(total > 0 ? (N(row, Parts[i]) / total).ToString("P1", CultureInfo.CurrentCulture) : "—", 13, true, true); Grid.SetColumn(share, 3); line.Children.Add(share); legend.Children.Add(line);
        }
        body.Children.Add(legend); return panel;
    }
    internal static FrameworkElement Details(JsonNode row, DesktopPreferences p)
    {
        var grid = new Grid { ColumnSpacing = 20, RowSpacing = 10 };
        for (var i = 0; i < 2; i++) grid.ColumnDefinitions.Add(new ColumnDefinition());
        var names = PartLabels(p).Concat([p.T("缓存命中率", "Cache hit rate"), p.T("请求 / 已定价", "Requests / priced")]).ToArray();
        var values = Parts.Select(part => Int(N(row, part))).Concat([Rate(row), $"{Int(N(row, "requests"))} / {Int(N(row, "pricedRequests"))}"]).ToArray();
        for (var i = 0; i < names.Length; i++)
        {
            if (i % 2 == 0) grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var pair = new Grid { ColumnSpacing = 10 }; pair.ColumnDefinitions.Add(new ColumnDefinition()); pair.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            pair.Children.Add(Single(names[i], 13, true)); var value = Single(values[i], 13); Grid.SetColumn(value, 1); pair.Children.Add(value); Grid.SetColumn(pair, i % 2); Grid.SetRow(pair, i / 2); grid.Children.Add(pair);
        }
        return grid;
    }
    private static Brush AgentBrush(string agent)
    {
        var dark = (App.MainWindow.Content as FrameworkElement)?.ActualTheme == ElementTheme.Dark;
        var color = agent switch
        {
            "claude" => dark ? (224, 144, 109) : (176, 96, 63), "codex" => dark ? (108, 197, 168) : (47, 127, 106),
            "kimi" => dark ? (134, 174, 240) : (63, 109, 179), "zcode" => dark ? (196, 154, 224) : (138, 90, 168),
            _ => dark ? (169, 169, 174) : (119, 119, 122),
        };
        return new SolidColorBrush(ColorHelper.FromArgb(255, (byte)color.Item1, (byte)color.Item2, (byte)color.Item3));
    }
    private static Grid DataGrid()
    {
        var grid = new Grid { ColumnSpacing = 12, MinHeight = 38, Padding = new Thickness(8, 5, 4, 5) };
        foreach (var width in new[] { new GridLength(2.8, GridUnitType.Star), new GridLength(1, GridUnitType.Star), new GridLength(1, GridUnitType.Star), new GridLength(1.3, GridUnitType.Star), new GridLength(1.1, GridUnitType.Star), new GridLength(.7, GridUnitType.Star), new GridLength(28) }) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = width });
        return grid;
    }
    private static void Cell(Grid grid, FrameworkElement element, int column) { Grid.SetColumn(element, column); element.VerticalAlignment = VerticalAlignment.Center; grid.Children.Add(element); }
    private static void CompactTable(Grid grid, double width)
    {
        foreach (var index in new[] { 3, 4, 5 })
        {
            var visible = index == 4 ? width >= 460 : width >= 690;
            grid.ColumnDefinitions[index].Width = visible ? new GridLength(index == 3 ? 1.3 : index == 4 ? 1.1 : .7, GridUnitType.Star) : new GridLength(0);
            foreach (var element in grid.Children.OfType<FrameworkElement>().Where(child => Grid.GetColumn(child) == index)) element.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        }
    }
    private static FrameworkElement Metric(string value, string? secondary = null)
    {
        var block = new Grid { ColumnSpacing = 8, HorizontalAlignment = HorizontalAlignment.Stretch };
        block.ColumnDefinitions.Add(new ColumnDefinition()); block.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        block.Children.Add(Single(value, 14, false, true));
        if (secondary is not null)
        {
            var share = Single(secondary, 13, true, true); Grid.SetColumn(share, 1); block.Children.Add(share);
            block.SizeChanged += (_, e) => share.Visibility = e.NewSize.Width >= 100 ? Visibility.Visible : Visibility.Collapsed;
        }
        return block;
    }
    private static JsonNode? CommonRate(JsonNode model, JsonNode data, string client)
    {
        var ids = A(model, "modelIds").Select(x => x.ToString()).ToArray(); if (ids.Length == 0) ids = [S(model, "model")];
        var matches = ids.Select(id => A(data["pricing"], "modelRates").FirstOrDefault(rate => S(rate, "client") == client && (S(rate, "model") == id || S(rate, "displayModel") == id))).ToArray();
        var first = matches[0]; if (first is null || first["input"] is null || string.IsNullOrEmpty(S(first, "source"))) return null;
        return matches.All(rate => rate is not null && S(rate, "source") == S(first, "source") && new[] { "input", "cacheRead", "cacheWrite", "output" }.All(key => N(rate, key) == N(first, key))) ? first : null;
    }
    private static FrameworkElement RowDetails(JsonNode row, DesktopPreferences p, JsonNode? rate = null, bool model = false)
    {
        var content = new StackPanel { Spacing = 10 }; content.Children.Add(Details(row, p));
        if (model)
        {
            content.Children.Add(Hairline()); content.Children.Add(Single(p.T("单价 · 美元 / 百万 tokens", "Rates · USD / million tokens"), 13, true));
            if (rate is null) content.Children.Add(Text(p.T("单价未覆盖或随请求条件变化，详见价格库。", "Rates are unavailable or vary by request. See the price catalog."), 13, true));
            else
            {
                var rates = new Grid { ColumnSpacing = 10 }; var labels = PartLabels(p); var keys = new[] { "input", "cacheRead", "cacheWrite", "output" };
                for (var i = 0; i < 4; i++)
                {
                    rates.ColumnDefinitions.Add(new ColumnDefinition()); var value = new StackPanel { Spacing = 3 };
                    value.Children.Add(Single(labels[i], 13, true)); value.Children.Add(Single("$" + N(rate, keys[i]).ToString("0.####", CultureInfo.InvariantCulture), 14)); Grid.SetColumn(value, i); rates.Children.Add(value);
                }
                content.Children.Add(rates);
            }
        }
        return new Border { Background = B("Surface2Brush"), Padding = new Thickness(14, 12, 14, 12), CornerRadius = new CornerRadius(4), Margin = new Thickness(8, 0, 8, 8), Child = content };
    }
    internal static FrameworkElement Agents(JsonNode data, DesktopPreferences p, bool includeMergedModels = false)
    {
        var panel = Panel("", out var body); body.Spacing = 4;
        var subtitle = Single(p.T("按 Tokens 排序", "Sorted by tokens"), 13, true);
        var count = Single($"{(data["clients"] as JsonObject)?.Count ?? 0} {p.T("个 Agent", "agents")}", 13, true);
        var title = Header(p.T("Agent 与模型", "Agents and models"), "Layers3", null, count); Grid.SetColumn(subtitle, 1); title.Children.Add(subtitle); body.Children.Add(title);
        var table = new StackPanel { Spacing = 0 }; body.Children.Add(table);
        var sortCost = false; var expandedAgents = new HashSet<string>(); var expandedDetails = new HashSet<string>();
        var grids = new List<Grid>(); double width = 900;
        Grid HeaderRow()
        {
            var header = DataGrid(); grids.Add(header); header.MinHeight = 36; Cell(header, Single("Agent", 13, true), 0);
            for (var index = 1; index <= 2; index++)
            {
                var cost = index == 2; var active = sortCost == cost; var line = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
                var label = Single(cost ? p.T("费用", "Cost") : "Tokens", 13, true); label.IsTextSelectionEnabled = false; line.Children.Add(label);
                if (active) line.Children.Add(NativeIcons.Create("ArrowDown", 13, "SignalBrush"));
                var button = Ghost(""); button.Content = line; button.HorizontalAlignment = HorizontalAlignment.Right;
                button.Click += (_, _) => { sortCost = cost; Render(); }; AutomationProperties.SetName(button, cost ? p.T("按费用降序排列", "Sort by cost descending") : p.T("按 Tokens 降序排列", "Sort by tokens descending")); Cell(header, button, index);
            }
            Cell(header, Single(p.T("Token 构成", "Token mix"), 13, true), 3); Cell(header, Single(p.T("缓存命中", "Cache hit"), 13, true), 4); Cell(header, Single(p.T("请求", "Requests"), 13, true, true), 5);
            return header;
        }
        FrameworkElement MakeRow(string key, string name, string client, JsonNode row, bool model, IReadOnlyList<JsonNode>? models = null)
        {
            var wrap = new StackPanel { Spacing = 0 }; var grid = DataGrid(); grids.Add(grid); grid.MinHeight = model ? 38 : 46;
            var nameBlock = new StackPanel { Spacing = 2 };
            var nameLine = new Grid { ColumnSpacing = 7 }; nameLine.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); nameLine.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto }); nameLine.ColumnDefinitions.Add(new ColumnDefinition());
            var disclosure = new ContentControl { Content = NativeIcons.Create(expandedAgents.Contains(key) ? "ChevronDown" : "ChevronRight", 13, "MutedBrush"), Width = 13, Height = 13, VerticalAlignment = VerticalAlignment.Center, Visibility = !model && models?.Count > 0 ? Visibility.Visible : Visibility.Collapsed };
            nameLine.Children.Add(disclosure);
            if (!model) { var dot = new Border { Width = 7, Height = 7, CornerRadius = new CornerRadius(4), Background = AgentBrush(client), VerticalAlignment = VerticalAlignment.Center }; Grid.SetColumn(dot, 1); nameLine.Children.Add(dot); }
            var nameText = Single(name, model ? 13 : 14); nameText.IsTextSelectionEnabled = false; if (model) Mono(nameText); else nameText.FontWeight = Microsoft.UI.Text.FontWeights.Medium;
            Grid.SetColumn(nameText, 2); nameLine.Children.Add(nameText); nameBlock.Children.Add(nameLine);
            if (!model && models?.Count == 1) { var summary = Single(S(models[0], "model"), 13, true); Mono(summary); summary.Margin = new Thickness(27, 0, 0, 0); summary.IsTextSelectionEnabled = false; nameBlock.Children.Add(summary); }
            else if (!model && models?.Count > 1)
            {
                nameLine.ColumnSpacing = 8;
                nameLine.ColumnDefinitions[2].Width = GridLength.Auto;
                nameLine.ColumnDefinitions.Add(new ColumnDefinition());
                var summary = Single($"{models.Count} {p.T("个模型", "models")}", 13, true); summary.IsTextSelectionEnabled = false;
                summary.HorizontalAlignment = HorizontalAlignment.Left;
                Grid.SetColumn(summary, 3); nameLine.Children.Add(summary);
            }
            var nameButton = new Button { Content = nameBlock, Padding = new Thickness(model ? 25 : 0, 0, 0, 0), MinWidth = 0, MinHeight = 28, Background = new SolidColorBrush(Colors.Transparent), BorderThickness = new Thickness(0), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch };
            AutomationProperties.SetName(nameButton, name); ToolTipService.SetToolTip(nameButton, name); Cell(grid, nameButton, 0);
            var allTokens = N(data["totals"], "totalTokens"); var allCost = N(data["totals"], "costUsd");
            Cell(grid, Metric(Tokens(N(row, "totalTokens")), allTokens > 0 ? (N(row, "totalTokens") / allTokens).ToString("P1") : "—"), 1);
            Cell(grid, Metric(Cost(row, p), N(row, "requests") > 0 && N(row, "pricedRequests") == 0 ? "—" : allCost > 0 ? (N(row, "costUsd") / allCost).ToString("P1") : "—"), 2);
            Cell(grid, PartsBar(row, 6), 3);
            var meter = new Grid { ColumnSpacing = 8 }; meter.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(32) }); meter.ColumnDefinitions.Add(new ColumnDefinition());
            var track = new Border { Width = 32, Height = 6, Background = B("Surface3Brush"), CornerRadius = new CornerRadius(3), VerticalAlignment = VerticalAlignment.Center,
                Child = new Border { Width = 32 * Math.Clamp(CacheRate(row) ?? 0, 0, 1), Background = B("ChartBrush"), CornerRadius = new CornerRadius(3), HorizontalAlignment = HorizontalAlignment.Left } };
            meter.Children.Add(track);
            var cache = Single(Rate(row), 13); Grid.SetColumn(cache, 1); meter.Children.Add(cache); Cell(grid, meter, 4); Cell(grid, Single(Int(N(row, "requests")), 14, false, true), 5);
            var detailHost = new ContentControl { Visibility = expandedDetails.Contains(key) ? Visibility.Visible : Visibility.Collapsed, HorizontalContentAlignment = HorizontalAlignment.Stretch };
            var details = IconButton("Info", p.T("查看明细：", "Details: ") + name); Cell(grid, details, 6);
            void ToggleDetails()
            {
                if (!expandedDetails.Remove(key)) expandedDetails.Add(key);
                if (detailHost.Content is null) detailHost.Content = RowDetails(row, p, model ? CommonRate(row, data, client) : null, model);
                detailHost.Visibility = expandedDetails.Contains(key) ? Visibility.Visible : Visibility.Collapsed; AutomationProperties.SetItemStatus(details, expandedDetails.Contains(key) ? "Expanded" : "Collapsed");
            }
            details.Click += (_, _) => ToggleDetails();
            if (expandedDetails.Contains(key)) detailHost.Content = RowDetails(row, p, model ? CommonRate(row, data, client) : null, model);
            var childRows = new StackPanel { Spacing = 0 }; var childrenHost = new Border { Child = childRows, Background = B("Surface2Brush"), Visibility = expandedAgents.Contains(key) ? Visibility.Visible : Visibility.Collapsed };
            if (!model && models is not null) foreach (var child in models) childRows.Children.Add(MakeRow(key + "/" + S(child, "model"), S(child, "model"), client, child, true));
            nameButton.Click += (_, _) =>
            {
                if (model || models?.Count is not > 0) { ToggleDetails(); return; }
                if (!expandedAgents.Remove(key)) expandedAgents.Add(key); childrenHost.Visibility = expandedAgents.Contains(key) ? Visibility.Visible : Visibility.Collapsed;
                disclosure.Content = NativeIcons.Create(expandedAgents.Contains(key) ? "ChevronDown" : "ChevronRight", 13, "MutedBrush"); AutomationProperties.SetItemStatus(nameButton, expandedAgents.Contains(key) ? "Expanded" : "Collapsed");
            };
            grid.PointerEntered += (_, _) => grid.Background = B("Surface3Brush"); grid.PointerExited += (_, _) => grid.Background = new SolidColorBrush(Colors.Transparent);
            wrap.Children.Add(grid); wrap.Children.Add(detailHost); wrap.Children.Add(Hairline()); if (!model) wrap.Children.Add(childrenHost); return wrap;
        }
        void Render()
        {
            grids.Clear(); table.Children.Clear(); subtitle.Text = sortCost ? p.T("按费用排序", "Sorted by cost") : p.T("按 Tokens 排序", "Sorted by tokens");
            table.Children.Add(HeaderRow()); table.Children.Add(Hairline()); var clients = data["clients"] as JsonObject; var field = sortCost ? "costUsd" : "totalTokens";
            if (clients is null || clients.Count == 0) table.Children.Add(Text(p.T("这个范围内没有会话。", "No sessions in this range."), 14, true));
            else foreach (var entry in clients.OrderByDescending(x => N(x.Value, field)))
            {
                if (entry.Value is not { } row) continue; var models = A(data, "models").Where(x => S(x, "client") == entry.Key).OrderByDescending(x => N(x, field)).ToList();
                table.Children.Add(MakeRow(entry.Key, Agent(entry.Key), entry.Key, row, false, models));
            }
            if (includeMergedModels)
            {
                var subhead = Header(p.T("按模型汇总", "Models across agents"), "Layers3"); subhead.Margin = new Thickness(8, 12, 0, 4); table.Children.Add(subhead);
                foreach (var group in A(data, "models").GroupBy(x => S(x, "model")).OrderByDescending(g => g.Sum(x => N(x, field))))
                {
                    var row = new JsonObject(); foreach (var key in Parts.Concat(["totalTokens", "requests", "pricedRequests", "costUsd"])) row[key] = group.Sum(x => N(x, key)); row["model"] = group.Key;
                    table.Children.Add(MakeRow("merged/" + group.Key, group.Key, "", row, true));
                }
            }
            foreach (var grid in grids) CompactTable(grid, width);
        }
        var legend = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12, Margin = new Thickness(8, 7, 0, 0) }; var names = PartLabels(p);
        for (var i = 0; i < Parts.Length; i++) { var item = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 5 }; item.Children.Add(new Border { Width = 6, Height = 6, Background = B(PartBrushes[i]), CornerRadius = new CornerRadius(2), VerticalAlignment = VerticalAlignment.Center }); item.Children.Add(Single(names[i], 13, true)); legend.Children.Add(item); }
        body.Children.Add(legend); panel.SizeChanged += (_, e) => { width = e.NewSize.Width - 32; foreach (var grid in grids) CompactTable(grid, width); }; Render(); return panel;
    }
    internal static FrameworkElement Sessions(JsonNode data, DesktopPreferences p)
    {
        var sessions = A(data, "topSessions").ToList(); var panel = Panel("", out var body); body.Spacing = 4;
        var count = Single("", 13, true); var expanded = false; var more = Ghost(p.T("展开会话", "Show more"), "ChevronDown"); more.Visibility = sessions.Count > 5 ? Visibility.Visible : Visibility.Collapsed;
        var title = Header(p.T("会话", "Sessions"), "Clock", null, more); Grid.SetColumn(count, 1); title.Children.Add(count); body.Children.Add(title);
        var list = new StackPanel { Spacing = 0 }; body.Children.Add(list);
        void Render()
        {
            list.Children.Clear(); var visible = sessions.Take(expanded ? sessions.Count : 5).ToList(); count.Text = $"{visible.Count} / {Int(N(data["totals"], "sessions"))}";
            for (var index = 0; index < visible.Count; index++)
            {
                var row = visible[index]; var client = S(row, "client"); var item = new Grid { ColumnSpacing = 12, Padding = new Thickness(0, 10, 0, 10) };
                item.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(26) }); item.ColumnDefinitions.Add(new ColumnDefinition());
                var number = Single((index + 1).ToString("00"), 13, true); number.TextAlignment = TextAlignment.Center;
                var badge = new Border { Child = number, Height = 30, VerticalAlignment = VerticalAlignment.Top, Padding = new Thickness(0, 5, 0, 4), Background = B("Surface2Brush"), BorderBrush = AgentBrush(client), BorderThickness = new Thickness(0, 0, 0, 2), CornerRadius = new CornerRadius(3) }; item.Children.Add(badge);
                var content = new StackPanel { Spacing = 4 }; Grid.SetColumn(content, 1); item.Children.Add(content);
                var line = new Grid { ColumnSpacing = 12 }; foreach (var width in new[] { new GridLength(1, GridUnitType.Star), new GridLength(88), new GridLength(70), new GridLength(28) }) line.ColumnDefinitions.Add(new ColumnDefinition { Width = width });
                var name = S(row, "title");
                if (string.IsNullOrWhiteSpace(name)) name = S(row, "directory").TrimEnd('/', '\\').Replace('\\', '/').Split('/').LastOrDefault() ?? "";
                if (string.IsNullOrWhiteSpace(name)) name = p.T("未命名会话", "Untitled session");
                var heading = Strong(name); ToolTipService.SetToolTip(heading, S(row, "sessionId")); line.Children.Add(heading);
                Cell(line, Single(Tokens(N(row, "totalTokens")), 14, false, true), 1); Cell(line, Single(Cost(row, p), 14, false, true), 2);
                var detailButton = IconButton("Info", p.T("会话明细", "Session details")); Cell(line, detailButton, 3); content.Children.Add(line);
                var active = N(row, "activeMs") > 0 ? $" · {p.T("活跃", "Active")} {TimeSpan.FromMilliseconds(N(row, "activeMs")).TotalMinutes:0.#} min" : "";
                content.Children.Add(Single($"{Agent(client)} · {Clock(row["startedAt"], p.TimeZone)}–{Clock(row["endedAt"], p.TimeZone)}{active} · {Int(N(row, "requests"))} {p.T("次请求", "requests")}", 13, true));
                var meta = string.Join(" · ", new[] { S(row, "directory"), string.Join(", ", A(row, "models").Select(x => x.ToString())) }.Where(x => x.Length > 0));
                if (meta.Length > 0) { var path = Single(meta, 13, true); Mono(path); ToolTipService.SetToolTip(path, meta); content.Children.Add(path); }
                var details = new StackPanel { Spacing = 8, Visibility = Visibility.Collapsed, Margin = new Thickness(0, 6, 0, 0) };
                details.Children.Add(RowDetails(row, p)); details.Children.Add(Text(S(row, "sessionId"), 13, true)); details.Children.Add(Text($"{Stamp(row["startedAt"], p.TimeZone)} — {Stamp(row["endedAt"], p.TimeZone)} · {p.TimeZone}", 13, true)); content.Children.Add(details);
                detailButton.Click += (_, _) => { details.Visibility = details.Visibility == Visibility.Visible ? Visibility.Collapsed : Visibility.Visible; AutomationProperties.SetItemStatus(detailButton, details.Visibility == Visibility.Visible ? "Expanded" : "Collapsed"); };
                list.Children.Add(item); if (index < visible.Count - 1) list.Children.Add(Hairline());
            }
            if (sessions.Count == 0) list.Children.Add(Text(p.T("没有会话记录。", "No recorded sessions."), 14, true));
            if (expanded && N(data["totals"], "sessions") > sessions.Count) list.Children.Add(Text(p.T("显示 API 返回的用量最高会话。", "Showing the highest-usage sessions returned by the API."), 13, true));
            more.Content = p.T(expanded ? "收起会话" : "展开会话", expanded ? "Show fewer" : "Show more");
        }
        more.Click += (_, _) => { expanded = !expanded; Render(); }; Render(); return panel;
    }
    internal static void Animate(FrameworkElement element)
    {
        element.Tag = AnimationTag; element.Loaded += (_, _) =>
        {
            if (!new UISettings().AnimationsEnabled) return;
            var visual = ElementCompositionPreview.GetElementVisual(element); var animation = visual.Compositor.CreateScalarKeyFrameAnimation();
            animation.InsertKeyFrame(0, 0); animation.InsertKeyFrame(1, 1, visual.Compositor.CreateCubicBezierEasingFunction(new Vector2(.2f, .7f), new Vector2(.1f, 1)));
            animation.Duration = TimeSpan.FromMilliseconds(200); visual.StartAnimation("Opacity", animation);
        };
    }
    private static void Rise(FrameworkElement element)
    {
        element.Tag = RiseTag; element.Loaded += (_, _) =>
        {
            if (!new UISettings().AnimationsEnabled || element.ActualHeight <= 0) return;
            var visual = ElementCompositionPreview.GetElementVisual(element); visual.CenterPoint = new Vector3(0, (float)element.ActualHeight, 0);
            var animation = visual.Compositor.CreateVector3KeyFrameAnimation(); animation.InsertKeyFrame(0, new Vector3(1, 0, 1));
            animation.InsertKeyFrame(1, Vector3.One, visual.Compositor.CreateCubicBezierEasingFunction(new Vector2(.2f, .7f), new Vector2(.1f, 1)));
            animation.Duration = TimeSpan.FromMilliseconds(360); visual.StartAnimation("Scale", animation);
        };
    }
    internal static void FinishAnimations(DependencyObject root)
    {
        if (root is FrameworkElement element)
        {
            var visual = ElementCompositionPreview.GetElementVisual(element);
            if (ReferenceEquals(element.Tag, AnimationTag)) { visual.StopAnimation("Opacity"); visual.Opacity = 1; }
            if (ReferenceEquals(element.Tag, RiseTag)) { visual.StopAnimation("Scale"); visual.Scale = Vector3.One; }
        }
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++) FinishAnimations(VisualTreeHelper.GetChild(root, i));
    }
}
