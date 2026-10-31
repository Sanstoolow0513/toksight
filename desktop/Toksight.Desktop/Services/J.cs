using System.Globalization;
using System.Text.Json.Nodes;

namespace Toksight.Desktop.Services;

public static class J
{
    public static JsonNode? At(JsonNode? node, string path) => path.Split('.', StringSplitOptions.RemoveEmptyEntries)
        .Aggregate(node, (current, key) => current is JsonObject obj ? obj[key] : null);
    public static string Str(JsonNode? node, string key = "", string fallback = "") => (key.Length == 0 ? node : At(node, key))?.ToString() ?? fallback;
    public static double Num(JsonNode? node, string key = "") => double.TryParse(Str(node, key), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) ? n : 0;
    public static bool Bool(JsonNode? node, string key = "") => bool.TryParse(Str(node, key), out var b) && b;
    public static IEnumerable<JsonNode> Items(JsonNode? node, string key = "") => (key.Length == 0 ? node : At(node, key)) is JsonArray array ? array.OfType<JsonNode>() : [];
}
