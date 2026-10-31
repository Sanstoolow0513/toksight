using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;

namespace Toksight.Desktop.Services;

// Lucide's existing vector paths, drawn with native XAML shapes (no web renderer).
public static class NativeIcons
{
    private static readonly JsonObject Icons = JsonNode.Parse(File.ReadAllText(System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "Icons", "lucide.json")))!.AsObject();
    public static FrameworkElement Create(string name, double size = 16, string colorKey = "MutedBrush")
    {
        var canvas = new Canvas { Width = 24, Height = 24, IsHitTestVisible = false };
        var stroke = DesktopPalette.Brush(colorKey);
        foreach (var node in Icons[name]?.AsArray() ?? Icons["Info"]!.AsArray())
        {
            var tag = node![0]!.ToString(); var attrs = node[1]!;
            double N(string key, double fallback = 0) => double.TryParse(attrs[key]?.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var number) ? number : fallback;
            Shape? shape = null;
            if (tag == "circle")
            {
                var r = N("r"); shape = new Ellipse { Width = r * 2, Height = r * 2 };
                Canvas.SetLeft(shape, N("cx") - r); Canvas.SetTop(shape, N("cy") - r);
            }
            else if (tag == "ellipse")
            {
                shape = new Ellipse { Width = N("rx") * 2, Height = N("ry") * 2 };
                Canvas.SetLeft(shape, N("cx") - N("rx")); Canvas.SetTop(shape, N("cy") - N("ry"));
            }
            else if (tag == "rect")
            {
                shape = new Rectangle { Width = N("width"), Height = N("height"), RadiusX = N("rx"), RadiusY = N("ry", N("rx")) };
                Canvas.SetLeft(shape, N("x")); Canvas.SetTop(shape, N("y"));
            }
            else
            {
                var data = tag switch
                {
                    "path" => attrs["d"]!.ToString(),
                    "line" => FormattableString.Invariant($"M{N("x1")},{N("y1")} L{N("x2")},{N("y2")}"),
                    "polyline" => "M" + attrs["points"]!.ToString(),
                    "polygon" => "M" + attrs["points"]!.ToString() + " Z",
                    _ => "",
                };
                if (data.Length > 0) shape = (Shape)XamlReader.Load($"<Path xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' Data='{System.Security.SecurityElement.Escape(data)}'/>");
            }
            if (shape is null) continue;
            shape.Stroke = stroke; shape.StrokeThickness = 1.6;
            shape.StrokeStartLineCap = PenLineCap.Round; shape.StrokeEndLineCap = PenLineCap.Round; shape.StrokeLineJoin = PenLineJoin.Round;
            canvas.Children.Add(shape);
        }
        return new Viewbox { Child = canvas, Width = size, Height = size, Stretch = Stretch.Uniform, IsHitTestVisible = false };
    }
    public static FrameworkElement Brand(double size = 28)
    {
        var canvas = new Canvas { Width = 22, Height = 22, IsHitTestVisible = false };
        var levels = new[] { 1, 2, 4, 2, 4, 3, 0, 3, 4 };
        var opacity = new[] { .18, .34, .52, .72, 1 };
        for (var i = 0; i < levels.Length; i++)
        {
            var cell = new Rectangle { Width = 6.5, Height = 6.5, RadiusX = 1.8, RadiusY = 1.8, Fill = DesktopPalette.Brush("SignalBrush"), Opacity = opacity[levels[i]] };
            Canvas.SetLeft(cell, (i % 3) * 7.5); Canvas.SetTop(cell, (i / 3) * 7.5); canvas.Children.Add(cell);
        }
        return new Viewbox { Child = canvas, Width = size, Height = size, IsHitTestVisible = false };
    }
}
