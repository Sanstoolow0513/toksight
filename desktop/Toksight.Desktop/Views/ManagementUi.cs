using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Toksight.Desktop.Services;

namespace Toksight.Desktop.Views;

internal static class ManagementUi
{
    public static Brush Brush(string name) => DesktopPalette.Brush(name);

    public static TextBlock Text(string text, double size = 14, bool muted = false) => new()
    {
        Text = text, FontSize = size, TextWrapping = TextWrapping.Wrap,
        Foreground = Brush(muted ? "MutedBrush" : "InkBrush"), IsTextSelectionEnabled = true
    };

    public static string Rate(JsonNode? node, string key)
    {
        if (node?[key] is not JsonValue value || !value.TryGetValue<double>(out var rate) || !double.IsFinite(rate)) return "—";
        rate *= 1_000_000;
        var text = rate == 0 ? "$0" : Math.Abs(rate) < 0.00005 ? "<$0.0001" : "$" + rate.ToString("#,##0.00##", CultureInfo.InvariantCulture);
        return text + (J.Bool(node, key + "Fallback") ? "*" : "");
    }

    public static string Date(string value, DesktopPreferences preferences)
    {
        if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var at)) return "—";
        try { at = TimeZoneInfo.ConvertTime(at, TimeZoneInfo.FindSystemTimeZoneById(preferences.TimeZone)); } catch (TimeZoneNotFoundException) { }
        return at.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
    }

    public static string Bytes(double size) => size >= 1048576 ? $"{size / 1048576:0.0} MiB" : $"{size / 1024:0.0} KiB";

    public static Grid Rates(JsonNode? record, DesktopPreferences preferences)
    {
        var grid = new Grid { ColumnSpacing = 16 };
        var parts = new[] { ("input", preferences.T("输入", "Input")), ("output", preferences.T("输出", "Output")),
            ("cacheRead", preferences.T("缓存读取", "Cache read")), ("cacheWrite", preferences.T("缓存写入", "Cache write")) };
        for (var i = 0; i < parts.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var stack = new StackPanel { Spacing = 4 };
            stack.Children.Add(Text(parts[i].Item2, 13, true));
            stack.Children.Add(Text(Rate(record, parts[i].Item1), 16));
            Grid.SetColumn(stack, i); grid.Children.Add(stack);
        }
        return grid;
    }

    public static Border Section(UIElement child) => new()
    {
        Child = child, Background = Brush("SurfaceBrush"), CornerRadius = new CornerRadius(8), Padding = new Thickness(16, 12, 16, 12)
    };

    public static void Alert(InfoBar bar, string message, bool error = false)
    {
        bar.Message = message;
        bar.Severity = error ? InfoBarSeverity.Error : InfoBarSeverity.Success;
        bar.IsOpen = true;
    }

    public static async Task<bool> ConfirmAsync(FrameworkElement owner, DesktopPreferences preferences, string title, string description, string action)
    {
        var dialog = new ContentDialog
        {
            XamlRoot = owner.XamlRoot, RequestedTheme = owner.ActualTheme,
            Title = title, Content = Text(description), PrimaryButtonText = action,
            CloseButtonText = preferences.T("取消", "Cancel"), DefaultButton = ContentDialogButton.Close
        };
        return await dialog.ShowAsync() == ContentDialogResult.Primary;
    }

    public static string MergeSummary(JsonNode? node, DesktopPreferences preferences)
    {
        return preferences.T("数据库已合并", "Database merged") + $" · {preferences.T("新增", "Added")} {J.Num(node, "imported"):N0}" +
            $" · {preferences.T("补全", "Enriched")} {J.Num(node, "updated"):N0} · {preferences.T("重复", "Duplicates")} {J.Num(node, "duplicates"):N0}";
    }
}

internal sealed class ManagementChoice(string id, string label)
{
    public string Id { get; } = id;
    public string Label { get; } = label;
    public override string ToString() => Label;
}

public sealed class ManagementPrice(JsonNode raw, DesktopPreferences preferences)
{
    public JsonNode Raw { get; } = raw;
    public string Name => J.Str(Raw, "name");
    public string Provider => J.Str(Raw, "provider", preferences.T("其他", "Other"));
    public string Source => J.Str(Raw, "source");
    public bool Used => J.Bool(Raw, "used");
    public string Meta => Provider + " · " + Source + (Used ? preferences.T(" · 已使用", " · Used") : "");
    public string Input => ManagementUi.Rate(Raw, "input");
    public string Output => ManagementUi.Rate(Raw, "output");
    public string CacheRead => ManagementUi.Rate(Raw, "cacheRead");
    public string CacheWrite => ManagementUi.Rate(Raw, "cacheWrite");
    public string InputLabel => preferences.T("输入", "Input");
    public string OutputLabel => preferences.T("输出", "Output");
    public string CacheReadLabel => preferences.T("缓存读取", "Cache read");
    public string CacheWriteLabel => preferences.T("缓存写入", "Cache write");
    public string DetailsLabel => preferences.T("价格明细与历史", "Price details and history");
    public string SearchText => Name + " " + Provider + " " + string.Join(" ", J.Items(Raw, "names").Select(n => n.ToString())) + " " + string.Join(" ", J.Items(Raw, "usedAs").Select(n => n.ToString()));
}
