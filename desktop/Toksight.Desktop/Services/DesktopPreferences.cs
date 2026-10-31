using System.Globalization;
using System.Text.Json;

namespace Toksight.Desktop.Services;

public sealed class DesktopPreferences
{
    public static string DataDirectory { get; } = Environment.GetEnvironmentVariable("TOKSIGHT_DESKTOP_STATE_DIR") is { Length: > 0 } overridePath
        ? Path.GetFullPath(overridePath) : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "toksight", "desktop");
    public string Language { get; set; } = CultureInfo.CurrentUICulture.Name.StartsWith("zh", StringComparison.OrdinalIgnoreCase) ? "zh-CN" : "en";
    public string Theme { get; set; } = "system";
    public string TimeZonePreference { get; set; } = "auto";
    public bool CalendarCompact { get; set; }
    [System.Text.Json.Serialization.JsonIgnore]
    public string TimeZone
    {
        get
        {
            if (TimeZonePreference != "auto") return TimeZonePreference;
            var id = TimeZoneInfo.Local.Id;
            return TimeZoneInfo.TryConvertWindowsIdToIanaId(id, out var iana) ? iana : id;
        }
    }
    public event Action? Changed;
    public string T(string zh, string en) => Language == "zh-CN" ? zh : en;
    public static DesktopPreferences Load()
    {
        try
        {
            var value = JsonSerializer.Deserialize<DesktopPreferences>(File.ReadAllText(Path.Combine(DataDirectory, "preferences.json"))) ?? new();
            if (value.Theme is not ("system" or "light" or "dark")) value.Theme = "system";
            if (value.Language is not ("zh-CN" or "en")) value.Language = new DesktopPreferences().Language;
            if (string.IsNullOrWhiteSpace(value.TimeZonePreference)) value.TimeZonePreference = "auto";
            if (value.TimeZonePreference != "auto")
            {
                try
                {
                    _ = TimeZoneInfo.FindSystemTimeZoneById(value.TimeZonePreference);
                    if (TimeZoneInfo.TryConvertWindowsIdToIanaId(value.TimeZonePreference, out var iana)) value.TimeZonePreference = iana;
                }
                catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException) { value.TimeZonePreference = "auto"; }
            }
            return value;
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { return new(); }
    }
    public void Save()
    {
        Directory.CreateDirectory(DataDirectory);
        var file = Path.Combine(DataDirectory, "preferences.json");
        File.WriteAllText(file + ".tmp", JsonSerializer.Serialize(this));
        File.Move(file + ".tmp", file, true);
        Changed?.Invoke();
    }
}
