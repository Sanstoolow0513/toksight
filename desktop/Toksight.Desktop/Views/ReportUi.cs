using System.Globalization;
using System.Numerics;
using System.Text.Json.Nodes;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Media;
using Toksight.Desktop.Services;
using Windows.UI.ViewManagement;

namespace Toksight.Desktop.Views;

// Shared native report primitives. Data is always the committed API snapshot.
internal static class ReportUi
{
    private static readonly object AnimationTag = new();
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
        Text = value, FontSize = size, Foreground = B(muted ? "MutedBrush" : "InkBrush"),
        TextWrapping = TextWrapping.Wrap, IsTextSelectionEnabled = true,
    };
    internal static string Int(double value) => value.ToString("N0", CultureInfo.CurrentCulture);
    internal static string Tokens(double value) => value >= 1_000_000 ? (value / 1_000_000).ToString("0.##", CultureInfo.InvariantCulture) + "M" : value >= 1000 ? (value / 1000).ToString("0.#", CultureInfo.InvariantCulture) + "K" : Int(value);
    internal static string Money(double value) => "$" + value.ToString(value is > 0 and < .01 ? "0.0000" : "0.00", CultureInfo.InvariantCulture);
    internal static string Rate(JsonNode? row)
    {
        var denominator = N(row, "inputTokens") + N(row, "cacheReadTokens");
        return denominator > 0 ? (N(row, "cacheReadTokens") / denominator).ToString("P1", CultureInfo.CurrentCulture) : "—";
    }
    internal static string Cost(JsonNode? row, DesktopPreferences p)
    {
        var requests = N(row, "requests");
        var priced = N(row, "pricedRequests");
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
    internal static Border Panel(string title, out StackPanel content)
    {
        content = new StackPanel { Spacing = 12 };
        if (title.Length > 0)
        {
            var heading = Text(title, 15);
            heading.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
            content.Children.Add(heading);
        }
        return new Border { Background = B("SurfaceBrush"), CornerRadius = new CornerRadius(8), Padding = new Thickness(16, 12, 16, 12), Child = content };
    }
    internal static Grid Columns(params FrameworkElement[] children)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        for (var i = 0; i < children.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(children[i], i);
            grid.Children.Add(children[i]);
        }
        return grid;
    }
    internal static FrameworkElement Kpis(JsonNode data, DesktopPreferences p, bool comparison = false)
    {
        var panel = Panel("", out var body);
        var totals = data["totals"];
        var labels = new[] { "Tokens", p.T("参考费用", "Reference cost"), p.T("缓存命中率", "Cache hit rate"), p.T("请求", "Requests") };
        var values = new[] { Tokens(N(totals, "totalTokens")), Cost(totals, p), Rate(totals), Int(N(totals, "requests")) };
        var cells = new List<FrameworkElement>();
        for (var i = 0; i < labels.Length; i++)
        {
            var cell = new StackPanel { Spacing = 6, MinWidth = 100 };
            cell.Children.Add(Text(labels[i], 13, true));
            var value = Text(values[i], 28); value.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
            cell.Children.Add(value);
            if (comparison && i < 2)
            {
                var previous = data["comparison"]?["previous"]?["totals"];
                var key = i == 0 ? "totalTokens" : "costUsd";
                var before = N(previous, key);
                var priced = i == 0 || (N(data["comparison"]?["current"]?["costCoverage"], "unpricedRequests") == 0 && N(data["comparison"]?["previous"]?["costCoverage"], "unpricedRequests") == 0);
                if (before > 0 && priced)
                {
                    var delta = (N(totals, key) - before) / before;
                    cell.Children.Add(Text($"{(delta >= 0 ? "+" : "")}{delta:P1} · {p.T("对比昨日全天", "vs. all yesterday")}", 13, true));
                }
            }
            cells.Add(cell);
        }
        var grid = Columns(cells.ToArray());
        body.Children.Add(grid);
        grid.SizeChanged += (_, e) =>
        {
            var compact = e.NewSize.Width < 680;
            if (grid.RowDefinitions.Count == (compact ? 2 : 0)) return;
            grid.ColumnDefinitions.Clear(); grid.RowDefinitions.Clear();
            for (var i = 0; i < (compact ? 2 : 4); i++) grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            if (compact) { grid.RowDefinitions.Add(new RowDefinition()); grid.RowDefinitions.Add(new RowDefinition()); grid.RowSpacing = 16; }
            for (var i = 0; i < cells.Count; i++) { Grid.SetColumn(cells[i], i % (compact ? 2 : 4)); Grid.SetRow(cells[i], compact ? i / 2 : 0); }
        };
        if (N(data["costCoverage"], "unpricedRequests") > 0)
            body.Children.Add(Text($"* {Int(N(data["costCoverage"], "unpricedRequests"))} {p.T("条请求未定价；费用仅包含已定价部分。", "requests are unpriced; cost includes priced requests only.")}", 13, true));
        return panel;
    }
    internal static FrameworkElement Chart(IEnumerable<JsonNode> source, bool cost, string tokenKey, Func<JsonNode, string> label, DesktopPreferences p, double height = 150)
    {
        var rows = source.ToList();
        var grid = new Grid { Height = height + 28, ColumnSpacing = 3 };
        var max = rows.Select(r => N(r, cost ? "costUsd" : tokenKey)).DefaultIfEmpty(0).Max();
        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i]; var amount = N(row, cost ? "costUsd" : tokenKey);
            grid.ColumnDefinitions.Add(new ColumnDefinition());
            var text = label(row) + " · " + (cost ? Money(amount) : Int(amount) + " tokens");
            var bar = new Border { Height = Math.Max(2, max > 0 ? amount / max * height : 2), MinWidth = 1, HorizontalAlignment = HorizontalAlignment.Stretch, Background = B(amount == max && max > 0 ? "SignalBrush" : "InkBrush"), CornerRadius = new CornerRadius(3, 3, 0, 0), VerticalAlignment = VerticalAlignment.Bottom, Opacity = amount == 0 ? .12 : .78 };
            // Button defaults to Left alignment. Its empty Border has no desired
            // width, so content stretching alone can produce invisible 0px bars.
            var button = new Button { Content = bar, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch, VerticalContentAlignment = VerticalAlignment.Bottom, Background = new SolidColorBrush(Colors.Transparent), BorderThickness = new Thickness(0), Padding = new Thickness(0, 8, 0, 0), VerticalAlignment = VerticalAlignment.Stretch, MinWidth = 0, MinHeight = 0 };
            ToolTipService.SetToolTip(button, text); AutomationProperties.SetName(button, text);
            Grid.SetColumn(button, i); grid.Children.Add(button);
        }
        AutomationProperties.SetName(grid, p.T("用量柱状图；可用 Tab 查看每根柱的数值。", "Usage chart. Tab to inspect individual bars."));
        Animate(grid);
        return grid;
    }
    internal static FrameworkElement Hourly(JsonNode data, DesktopPreferences p)
    {
        var panel = Panel(p.T("时段分布", "Hourly usage"), out var body);
        var metric = new ComboBox { ItemsSource = new[] { "Tokens", p.T("参考费用", "Reference cost") }, SelectedIndex = 0, MinWidth = 130 };
        AutomationProperties.SetName(metric, p.T("图表指标", "Chart metric"));
        body.Children.Add(metric);
        var host = new ContentControl { HorizontalContentAlignment = HorizontalAlignment.Stretch };
        body.Children.Add(host);
        void Render() => host.Content = Chart(A(data, "hourly"), metric.SelectedIndex == 1, "tokens", row => $"{N(row, "hour"):00}:00", p);
        metric.SelectionChanged += (_, _) => Render(); Render();
        var labels = new[] { "00:00", "06:00", "12:00", "18:00", "24:00" }.Select(value => Text(value, 13, true)).ToArray();
        for (var i = 0; i < labels.Length; i++) labels[i].HorizontalAlignment = i == 0 ? HorizontalAlignment.Left : i == labels.Length - 1 ? HorizontalAlignment.Right : HorizontalAlignment.Center;
        body.Children.Add(Columns(labels));
        body.Children.Add(Text(p.T("按统计时区", "In report time zone") + " · " + p.TimeZone, 13, true));
        return panel;
    }
    internal static FrameworkElement Breakdown(JsonNode data, DesktopPreferences p)
    {
        var panel = Panel(p.T("Token 构成", "Token breakdown"), out var body);
        var row = data["totals"];
        var fields = new[] { "inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens" };
        var labels = new[] { p.T("新鲜输入", "Fresh input"), p.T("缓存读取", "Cache read"), p.T("缓存写入", "Cache write"), p.T("输出", "Output") };
        var total = N(row, "totalTokens");
        var strip = new Grid { Height = 12, ColumnSpacing = 2, CornerRadius = new CornerRadius(6) };
        for (var i = 0; i < fields.Length; i++)
        {
            var amount = N(row, fields[i]);
            strip.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(total > 0 ? amount : 1, GridUnitType.Star) });
            var block = new Border { Background = B(i == 0 ? "SignalBrush" : "InkBrush"), Opacity = i == 0 ? 1 : 1.15 - i * .25 };
            Grid.SetColumn(block, i); strip.Children.Add(block);
        }
        body.Children.Add(strip);
        for (var i = 0; i < fields.Length; i++)
        {
            var amount = N(row, fields[i]);
            body.Children.Add(Text($"{labels[i]}    {Int(amount)}    {(total > 0 ? amount / total : 0):P1}"));
        }
        return panel;
    }
    internal static FrameworkElement Details(JsonNode row, DesktopPreferences p)
    {
        var block = new StackPanel { Spacing = 6, Padding = new Thickness(4, 8, 4, 8) };
        block.Children.Add(Text($"{p.T("新鲜输入", "Fresh input")}: {Int(N(row, "inputTokens"))}  ·  {p.T("输出", "Output")}: {Int(N(row, "outputTokens"))}"));
        block.Children.Add(Text($"{p.T("缓存读取", "Cache read")}: {Int(N(row, "cacheReadTokens"))}  ·  {p.T("缓存写入", "Cache write")}: {Int(N(row, "cacheWriteTokens"))}"));
        block.Children.Add(Text($"{p.T("缓存命中率", "Cache hit rate")}: {Rate(row)}  ·  {p.T("请求", "Requests")}: {Int(N(row, "requests"))}  ·  {p.T("已定价", "Priced")}: {Int(N(row, "pricedRequests"))}"));
        return block;
    }
    internal static FrameworkElement Agents(JsonNode data, DesktopPreferences p, bool includeMergedModels = false)
    {
        var panel = Panel(p.T("Agent 与模型", "Agents and models"), out var body);
        var sort = new ComboBox { ItemsSource = new[] { p.T("按 Tokens 排序", "Sort by tokens"), p.T("按费用排序", "Sort by cost") }, SelectedIndex = 0, MinWidth = 160 };
        body.Children.Add(sort);
        var host = new StackPanel { Spacing = 8 }; body.Children.Add(host);
        void Render()
        {
            host.Children.Clear();
            var field = sort.SelectedIndex == 0 ? "totalTokens" : "costUsd";
            var clients = data["clients"] as JsonObject;
            if (clients is null || clients.Count == 0) { host.Children.Add(Text(p.T("这个范围内没有会话。", "No sessions in this range."), 14, true)); return; }
            foreach (var entry in clients.OrderByDescending(x => N(x.Value, field)))
            {
                if (entry.Value is not { } row) continue;
                var details = new StackPanel { Spacing = 8 };
                details.Children.Add(Details(row, p));
                foreach (var model in A(data, "models").Where(x => S(x, "client") == entry.Key).OrderByDescending(x => N(x, field)))
                {
                    var modelDetails = new StackPanel { Spacing = 8 }; modelDetails.Children.Add(Details(model, p));
                    var rate = A(data["pricing"], "modelRates").FirstOrDefault(x => S(x, "client") == entry.Key && (S(x, "displayModel") == S(model, "model") || S(x, "model") == S(model, "model")));
                    if (rate is not null)
                        modelDetails.Children.Add(Text(rate["input"] is null ? p.T("单价随请求条件变化，详见价格库。", "Rates vary by request; see the price catalog.") : $"{p.T("美元 / 百万 tokens", "USD / million tokens")}: {p.T("输入", "Input")} {N(rate, "input"):0.####} · {p.T("输出", "Output")} {N(rate, "output"):0.####} · {p.T("缓存读取", "Cache read")} {N(rate, "cacheRead"):0.####} · {p.T("缓存写入", "Cache write")} {N(rate, "cacheWrite"):0.####}", 13, true));
                    details.Children.Add(new Expander { Header = Text($"{S(model, "model")}    {Tokens(N(model, "totalTokens"))}    {Cost(model, p)}"), Content = modelDetails, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch });
                }
                host.Children.Add(new Expander { Header = Text($"{Agent(entry.Key)}    {Tokens(N(row, "totalTokens"))}    {Cost(row, p)}    {Rate(row)}"), Content = details, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch });
            }
            if (!includeMergedModels) return;
            host.Children.Add(Text(p.T("按模型汇总（跨 Agent）", "Models across agents"), 15));
            foreach (var group in A(data, "models").GroupBy(x => S(x, "model")).OrderByDescending(g => g.Sum(x => N(x, field))))
            {
                var aggregate = new JsonObject();
                foreach (var key in new[] { "totalTokens", "inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens", "requests", "pricedRequests", "costUsd" }) aggregate[key] = group.Sum(x => N(x, key));
                var stack = new StackPanel { Spacing = 6 }; stack.Children.Add(Text(string.Join(", ", group.Select(x => Agent(S(x, "client"))).Distinct()), 13, true)); stack.Children.Add(Details(aggregate, p));
                host.Children.Add(new Expander { Header = Text($"{group.Key}    {Tokens(N(aggregate, "totalTokens"))}    {Cost(aggregate, p)}"), Content = stack, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch });
            }
        }
        sort.SelectionChanged += (_, _) => Render(); Render();
        return panel;
    }
    internal static FrameworkElement Sessions(JsonNode data, DesktopPreferences p)
    {
        var sessions = A(data, "topSessions").ToList();
        var panel = Panel($"{p.T("会话", "Sessions")} · {Int(N(data["totals"], "sessions"))}", out var body);
        var list = new StackPanel { Spacing = 8 }; body.Children.Add(list);
        var expanded = false;
        var more = new Button { Content = p.T("展开会话", "Show more sessions"), Visibility = sessions.Count > 5 ? Visibility.Visible : Visibility.Collapsed };
        void Render()
        {
            list.Children.Clear();
            foreach (var row in sessions.Take(expanded ? sessions.Count : 5))
            {
                var detail = new StackPanel { Spacing = 6 };
                detail.Children.Add(Text(S(row, "directory"), 13, true));
                detail.Children.Add(Text(string.Join(", ", A(row, "models").Select(x => x.ToString())), 13, true));
                detail.Children.Add(Text($"{Stamp(row["startedAt"], p.TimeZone)} — {Stamp(row["endedAt"], p.TimeZone)} · {p.TimeZone}", 13, true));
                detail.Children.Add(Text($"{p.T("活跃时长", "Active time")}: {TimeSpan.FromMilliseconds(N(row, "activeMs")).TotalMinutes:0.#} min", 13, true));
                detail.Children.Add(Details(row, p));
                var title = S(row, "title"); if (string.IsNullOrWhiteSpace(title)) title = S(row, "sessionId", p.T("未命名会话", "Untitled session"));
                list.Children.Add(new Expander { Header = Text($"{Agent(S(row, "client"))} · {title}\n{Tokens(N(row, "totalTokens"))} tokens · {Cost(row, p)}"), Content = detail, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch });
            }
            if (sessions.Count == 0) list.Children.Add(Text(p.T("没有会话记录。", "No recorded sessions."), 14, true));
            more.Content = expanded ? p.T("收起会话", "Show fewer sessions") : p.T("展开会话", "Show more sessions");
            if (expanded && N(data["totals"], "sessions") > sessions.Count) list.Children.Add(Text(p.T("显示 API 返回的用量最高会话。", "Showing the highest-usage sessions returned by the API."), 13, true));
        }
        more.Click += (_, _) => { expanded = !expanded; Render(); }; body.Children.Add(more); Render();
        return panel;
    }
    internal static void Animate(FrameworkElement element)
    {
        element.Tag = AnimationTag;
        element.Loaded += (_, _) =>
        {
            if (!new UISettings().AnimationsEnabled) return;
            var visual = ElementCompositionPreview.GetElementVisual(element);
            var animation = visual.Compositor.CreateScalarKeyFrameAnimation();
            animation.InsertKeyFrame(0, 0); animation.InsertKeyFrame(1, 1, visual.Compositor.CreateCubicBezierEasingFunction(new Vector2(.2f, .7f), new Vector2(.1f, 1)));
            animation.Duration = TimeSpan.FromMilliseconds(360); visual.StartAnimation("Opacity", animation);
        };
    }
    internal static void FinishAnimations(DependencyObject root)
    {
        if (root is FrameworkElement element && ReferenceEquals(element.Tag, AnimationTag))
        {
            var visual = ElementCompositionPreview.GetElementVisual(element);
            visual.StopAnimation("Opacity"); visual.Opacity = 1;
        }
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++) FinishAnimations(VisualTreeHelper.GetChild(root, i));
    }
}
