using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Toksight.Desktop.Services;

public sealed class DesktopApi : IDisposable
{
    private readonly HttpClient client;
    public DesktopPreferences Preferences { get; }
    public DesktopApi(Uri address, string token, DesktopPreferences preferences)
    {
        Preferences = preferences;
        client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false }) { BaseAddress = address, Timeout = TimeSpan.FromMinutes(3) };
        client.DefaultRequestHeaders.Add("X-Toksight-Desktop-Token", token);
        client.DefaultRequestHeaders.Add("Origin", address.GetLeftPart(UriPartial.Authority));
    }
    private async Task<JsonNode> ReadAsync(HttpResponseMessage response, CancellationToken ct)
    {
        var text = await response.Content.ReadAsStringAsync(ct);
        JsonNode? json;
        try { json = JsonNode.Parse(text); }
        catch (JsonException) { throw new InvalidOperationException($"HTTP {(int)response.StatusCode}: invalid service response"); }
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(J.Str(json, "error", $"HTTP {(int)response.StatusCode}"));
        return json ?? new JsonObject();
    }
    private static void ValidateRoute(string route)
    {
        if (!route.StartsWith("/api/", StringComparison.Ordinal) || route.Contains('\\')) throw new ArgumentException("Only local API routes are allowed", nameof(route));
    }
    public async Task<JsonNode> GetAsync(string route, CancellationToken cancellationToken = default)
    {
        ValidateRoute(route);
        using var response = await client.GetAsync(route, cancellationToken);
        return await ReadAsync(response, cancellationToken);
    }
    public async Task<JsonNode> PostAsync(string route, object? body = null, CancellationToken cancellationToken = default)
    {
        ValidateRoute(route);
        using var content = new StringContent(JsonSerializer.Serialize(body ?? new { }), Encoding.UTF8, "application/json");
        using var response = await client.PostAsync(route, content, cancellationToken);
        return await ReadAsync(response, cancellationToken);
    }
    public string ReportQuery(string period = "all", string? since = null, string? until = null, IEnumerable<string>? days = null)
    {
        var query = $"/api/data?period={Uri.EscapeDataString(period)}&timezone={Uri.EscapeDataString(Preferences.TimeZone)}";
        if (since is not null) query += $"&since={Uri.EscapeDataString(since)}";
        if (until is not null) query += $"&until={Uri.EscapeDataString(until)}";
        if (days is not null) query += $"&days={Uri.EscapeDataString(string.Join(',', days))}";
        return query;
    }
    public async Task<byte[]> ExportDatabaseAsync()
    {
        using var response = await client.GetAsync("/api/export/db");
        if (!response.IsSuccessStatusCode) await ReadAsync(response, default);
        return await response.Content.ReadAsByteArrayAsync();
    }
    public async Task<JsonNode> ImportDatabaseAsync(string file)
    {
        if (new FileInfo(file).Length > 256L * 1024 * 1024) throw new InvalidOperationException("Database is larger than 256 MB");
        await using var stream = File.OpenRead(file);
        using var content = new StreamContent(stream);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/vnd.sqlite3");
        using var response = await client.PostAsync("/api/import/db", content);
        return await ReadAsync(response, default);
    }
    public void Dispose() => client.Dispose();
}
