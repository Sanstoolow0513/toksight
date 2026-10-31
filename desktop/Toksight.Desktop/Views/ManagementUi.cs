using System.Globalization;
using System.Collections.Concurrent;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Toksight.Desktop.Services;
using Windows.System;

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

    public static Grid Rates(JsonNode? record, DesktopPreferences preferences, bool prominent = false)
    {
        var grid = new Grid { Background = Brush("Surface2Brush"), CornerRadius = new CornerRadius(6) };
        var parts = new[] { ("input", preferences.T("输入", "Input")), ("output", preferences.T("输出", "Output")),
            ("cacheRead", preferences.T("缓存读取", "Cache read")), ("cacheWrite", preferences.T("缓存写入", "Cache write")) };
        for (var i = 0; i < parts.Length; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var stack = new StackPanel { Spacing = 2 };
            var label = Text(parts[i].Item2, 13, true); label.TextWrapping = TextWrapping.NoWrap; label.TextTrimming = TextTrimming.CharacterEllipsis;
            ToolTipService.SetToolTip(label, parts[i].Item2);
            stack.Children.Add(label);
            var rate = Text(Rate(record, parts[i].Item1), prominent ? 18 : 15); rate.FontWeight = Microsoft.UI.Text.FontWeights.SemiBold;
            rate.TextWrapping = TextWrapping.NoWrap; rate.TextTrimming = TextTrimming.CharacterEllipsis;
            ToolTipService.SetToolTip(rate, rate.Text); stack.Children.Add(rate);
            var cell = new Border { Child = stack, Padding = new Thickness(8, 8, 6, 8), BorderBrush = Brush("LineBrush"), BorderThickness = new Thickness(i == 0 ? 0 : 1, 0, 0, 0) };
            Grid.SetColumn(cell, i); grid.Children.Add(cell);
        }
        return grid;
    }

    public static Border Section(UIElement child) => new()
    {
        Child = child, Background = Brush("SurfaceBrush"), CornerRadius = new CornerRadius(8), Padding = new Thickness(16, 12, 16, 12)
    };

    public static void IconButton(ButtonBase button, string icon, string label)
    {
        button.Content = NativeIcons.Create(icon, 16);
        AutomationProperties.SetName(button, label); ToolTipService.SetToolTip(button, label);
    }

    public static StackPanel ButtonContent(string label, string? icon = null)
    {
        var panel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7 };
        if (icon != null) panel.Children.Add(NativeIcons.Create(icon, 15));
        var text = Text(label, 14); text.IsTextSelectionEnabled = false; text.VerticalAlignment = VerticalAlignment.Center; panel.Children.Add(text);
        return panel;
    }

    public static FrameworkElement Segmented((string Id, string Label, string? Icon)[] choices, string selected, Action<string> changed, string label)
    {
        var group = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2 };
        var buttons = new List<ToggleButton>();
        var frame = new Border { Child = group, Background = Brush("Surface2Brush"), CornerRadius = new CornerRadius(6), Padding = new Thickness(3), HorizontalAlignment = HorizontalAlignment.Right };
        AutomationProperties.SetName(frame, label);
        void Paint(string id)
        {
            foreach (var button in buttons)
            {
                var active = (string)button.Tag == id;
                button.IsChecked = active; button.IsTabStop = active;
                button.Background = active ? Brush("SurfaceBrush") : new SolidColorBrush(Colors.Transparent);
                button.BorderBrush = active ? Brush("LineBrush") : new SolidColorBrush(Colors.Transparent);
            }
        }
        foreach (var option in choices)
        {
            var button = new ToggleButton { Tag = option.Id, Content = ButtonContent(option.Label, option.Icon), MinHeight = 28, MinWidth = 0,
                Padding = new Thickness(10, 3, 10, 3), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(4) };
            AutomationProperties.SetName(button, option.Label);
            button.Click += (_, _) => { Paint(option.Id); changed(option.Id); };
            button.KeyDown += (_, args) =>
            {
                var index = buttons.IndexOf(button);
                var next = args.Key switch { VirtualKey.Left or VirtualKey.Up => (index - 1 + buttons.Count) % buttons.Count,
                    VirtualKey.Right or VirtualKey.Down => (index + 1) % buttons.Count, VirtualKey.Home => 0, VirtualKey.End => buttons.Count - 1, _ => -1 };
                if (next < 0) return;
                args.Handled = true; buttons[next].Focus(FocusState.Keyboard);
                var id = (string)buttons[next].Tag; Paint(id); changed(id);
            };
            buttons.Add(button); group.Children.Add(button);
        }
        Paint(selected); return frame;
    }

    public static string ProviderName(string id) => id switch
    {
        "openai" => "OpenAI", "anthropic" => "Anthropic", "google" => "Google", "moonshot" => "Moonshot AI", "zai" => "Z.ai",
        "deepseek" => "DeepSeek", "alibaba" => "Alibaba · Qwen", "mistral" => "Mistral", "xai" => "xAI", "minimax" => "MiniMax", "cohere" => "Cohere", "ai21" => "AI21", _ => id
    };

    private static readonly ConcurrentDictionary<string, Task<string>> SvgFiles = new();
    public static FrameworkElement Logo(string provider, string? modelName = null, double size = 40)
    {
        var name = (modelName ?? "").Split('/').Last().ToLowerInvariant();
        var file = name.StartsWith("claude") ? "claude-color" : name.StartsWith("gemini") ? "gemini-color" : name.StartsWith("kimi") ? "kimi-color" : name.StartsWith("grok") ? "grok"
            : provider switch { "google" => "google-color", "deepseek" => "deepseek-color", "alibaba" => "qwen-color", "mistral" => "mistral-color", "minimax" => "minimax-color", "cohere" => "cohere-color",
                "openai" or "anthropic" or "moonshot" or "zai" or "xai" or "ai21" => provider, _ => "" };
        var letter = Text((ProviderName(provider).Length > 0 ? ProviderName(provider)[..1] : "?"), size < 24 ? 13 : 16);
        letter.HorizontalAlignment = HorizontalAlignment.Center; letter.VerticalAlignment = VerticalAlignment.Center; letter.IsTextSelectionEnabled = false;
        var image = new Image { Stretch = Stretch.Uniform };
        var inner = new Grid(); inner.Children.Add(letter); inner.Children.Add(image);
        var border = new Border { Width = size, Height = size, Child = inner, CornerRadius = new CornerRadius(size >= 40 ? 8 : 4),
            Background = size >= 40 ? Brush("Surface2Brush") : new SolidColorBrush(Colors.Transparent), Padding = new Thickness(size >= 40 ? 8 : 0) };
        AutomationProperties.SetAccessibilityView(border, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);
        if (file.Length == 0) return border;
        image.Loaded += async (_, _) =>
        {
            if (image.Source != null) return;
            try
            {
                var raw = await SvgFiles.GetOrAdd(file, id => File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Assets", "Logos", id + ".svg")));
                var color = ((SolidColorBrush)Brush("InkBrush")).Color;
                var svg = raw.Replace("currentColor", $"#{color.R:X2}{color.G:X2}{color.B:X2}").Replace("\"1em\"", "\"24\"");
                using var bytes = new MemoryStream(Encoding.UTF8.GetBytes(svg));
                var source = new SvgImageSource();
                var result = await source.SetSourceAsync(bytes.AsRandomAccessStream());
                if (result == SvgImageSourceLoadStatus.Success) { image.Source = source; letter.Visibility = Visibility.Collapsed; }
            }
            catch (Exception) { /* Unsupported or unavailable artwork retains the initial-letter fallback. */ }
        };
        return border;
    }

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
    public string SearchText => Name + " " + Provider + " " + J.Str(Raw, "modelId") + " " + J.Str(Raw, "official.endpoint") + " " +
        string.Join(" ", J.Items(Raw, "names").Concat(J.Items(Raw, "usedAs")).Concat(J.Items(Raw, "official.aliases")).Select(n => n.ToString()));
}

internal sealed record ManagementProvider(string Id, string Name, ManagementPrice[] Models);
internal sealed record ManagementCatalogRow(ManagementProvider? Header, object[] Tiles, int Columns);
internal sealed record ManagementMore(ManagementProvider Provider, int Remaining);
