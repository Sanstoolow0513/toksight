using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Toksight.Desktop.Services;

namespace Toksight.Desktop.Views;

public sealed partial class SettingsPage : UserControl, IDesktopPage
{
    private readonly DesktopApi _api;
    private readonly DesktopPreferences _preferences;
    private JsonNode? _backup;
    private CancellationTokenSource? _read;
    private long _revision;
    private bool _binding = true, _busy, _active = true, _loading;
    public bool IsLoading => _loading || _busy;
    public FrameworkElement? ExportElement => null;
    private string T(string zh, string en) => _preferences.T(zh, en);

    public SettingsPage(DesktopApi api, DesktopPreferences preferences)
    {
        _api = api; _preferences = preferences;
        InitializeComponent();
        Heading.Text = T("设置", "Settings");
        RetryButton.Content = T("重新读取", "Reload");
        AppearanceHeading.Text = T("外观与语言", "Appearance and language");
        ThemeCombo.Header = T("配色", "Theme"); LanguageCombo.Header = T("界面语言", "Language");
        SetChoices(ThemeCombo, [new("system", T("跟随系统", "System")), new("light", T("浅色", "Light")), new("dark", T("深色", "Dark"))], preferences.Theme);
        SetChoices(LanguageCombo, [new("zh-CN", "简体中文"), new("en", "English")], preferences.Language);
        TimezoneHeading.Text = T("统计时区", "Report time zone");
        TimezoneDescription.Text = T("日历、小时分布和日期范围按所选时区计算；原始时间戳不会修改。", "The calendar, hourly breakdown, and date ranges use this time zone. Original timestamps are preserved.");
        var zones = TimeZoneInfo.GetSystemTimeZones().Select(z => TimeZoneInfo.TryConvertWindowsIdToIanaId(z.Id, out var iana) ? iana : z.Id)
            .Append("UTC").Append(preferences.TimeZone).Where(z => !string.IsNullOrWhiteSpace(z)).Distinct().OrderBy(z => z, StringComparer.Ordinal).ToArray();
        var choices = new[] { new ManagementChoice("auto", T("跟随系统", "System time zone")) }
            .Concat(zones.Select(z => new ManagementChoice(z!, z!.Replace('_', ' ')))).ToArray();
        SetChoices(ZoneCombo, choices, preferences.TimeZonePreference);
        TimezonePreview.Text = preferences.TimeZone + " · " + ManagementUi.Date(DateTimeOffset.UtcNow.ToString("O"), preferences);
        DatabaseHeading.Text = T("数据库备份与合并", "Database backup and merge");
        DatabaseDescription.Text = T("导出完整的已提交 SQLite 快照。导入会验证备份并合并去重，不覆盖本机已有记录，也不会修改 Agent 文件。", "Export the full committed SQLite snapshot. Import validates the backup and merges records without overwriting existing local history or modifying Agent files.");
        ExportButton.Content = T("导出 SQLite", "Export SQLite"); ImportButton.Content = T("导入并合并", "Import and merge");
        BackupHeading.Text = T("GitHub 私有仓库备份", "Private GitHub repository backup");
        BackupDescription.Text = T("仅在你点击上传或恢复时联网。用量数据库包含会话标题和目录，因此仅支持你自己的私有仓库。", "Network access occurs only when you upload or restore. The usage database contains session titles and directories, so backups require your own private repository.");
        RepoInput.Header = T("私有仓库", "Private repository"); TokenInput.Header = T("GitHub 令牌", "GitHub token");
        SaveBackupButton.Content = T("保存备份设置", "Save backup settings"); ClearTokenButton.Content = T("清除已存令牌", "Clear saved token");
        DetectButton.Content = T("重新检测", "Check again"); UploadButton.Content = T("上传备份", "Upload backup"); RestoreButton.Content = T("恢复并合并", "Restore and merge");
        PrivacyNote.Text = T("数据采集只读 Agent 文件。价格下载、Kimi 额度查询和 GitHub 备份遵循各自设置与显式操作。", "Data collection only reads Agent files. Price downloads, Kimi quota queries, and GitHub backups follow their settings and explicit actions.");
        _binding = false; UpdateBusy();
    }

    private static void SetChoices(ComboBox combo, ManagementChoice[] choices, string? selected)
    {
        combo.ItemsSource = choices; combo.SelectedItem = choices.FirstOrDefault(c => c.Id == selected) ?? choices[0];
    }

    public async Task ReloadAsync()
    {
        if (_busy) return;
        _active = true; _read?.Cancel(); _read?.Dispose(); _read = new CancellationTokenSource();
        var token = _read.Token; var revision = ++_revision; _loading = true; UpdateBusy();
        try
        {
            var status = await _api.GetAsync("/api/sync/status", token);
            if (!_active || token.IsCancellationRequested || revision != _revision) return;
            ApplyStatus(status, preserveDraft: _backup != null);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { if (_active && revision == _revision) ManagementUi.Alert(Notice, ex.Message, true); }
        finally { if (revision == _revision) { _loading = false; UpdateBusy(); } }
    }

    public void OnLeaving() { _active = false; ++_revision; _read?.Cancel(); _loading = false; }

    private void ApplyStatus(JsonNode status, bool preserveDraft = false)
    {
        _binding = true;
        var oldRepo = J.Str(_backup, "repo");
        _backup = status;
        if (!preserveDraft || RepoInput.Text.Trim() == oldRepo) RepoInput.Text = J.Str(status, "repo");
        var source = J.Str(status, "tokenSource");
        TokenInput.PlaceholderText = source == "gh" ? T("使用 GitHub CLI 凭据", "Using GitHub CLI credentials")
            : source.Length > 0 && source != "config" ? T("使用环境变量：", "Using environment variable: ") + source
            : J.Bool(status, "tokenSaved") ? T("令牌已保存，留空可保留", "Token saved; leave empty to keep it") : T("输入仅限此仓库的令牌", "Token scoped to this repository");
        TokenHint.Text = source == "gh"
            ? T("GitHub CLI 凭据通常权限较宽；这里不会保存或显示 gh 的令牌。", "GitHub CLI credentials usually have broader permissions. The gh token is never saved or displayed here.")
            : source.Length > 0 && source != "config"
                ? T("环境变量中的令牌优先于已保存令牌。", "The environment token takes priority over the saved token.")
                : T("细粒度令牌需要该仓库的 Contents 读写和 Metadata 只读权限。已保存的令牌不会返回到界面。", "A fine-grained token needs Contents read/write and Metadata read access for this repository. Saved tokens are never returned to the UI.");
        var gh = status["gh"];
        GhStatus.Text = !J.Bool(gh, "installed") ? T("未安装 gh；可使用令牌配置。", "gh is not installed; a token can be used instead.")
            : !J.Bool(gh, "loggedIn") ? T("gh 尚未登录，可在终端运行 gh auth login。", "gh is signed out. Run gh auth login in a terminal.")
            : T("已登录", "Signed in") + (J.Str(gh, "user").Length > 0 ? " · " + J.Str(gh, "user") : "") + (source == "gh" ? T(" · 正在使用", " · In use") : "");
        RemoteStatus.Text = T("远端路径：", "Remote path: ") + J.Str(status, "repo", "—") + " / " + J.Str(status, "remotePath", "toksight/usage.sqlite");
        LastBackup.Text = T("上次备份：", "Last backup: ") + (status["lastBackup"] == null ? T("尚未备份", "Never")
            : ManagementUi.Date(J.Str(status["lastBackup"], "at"), _preferences) + " · " + ManagementUi.Bytes(J.Num(status["lastBackup"], "size")));
        LastRestore.Text = T("上次恢复：", "Last restore: ") + (status["lastRestore"] == null ? T("尚未恢复", "Never") : ManagementUi.Date(J.Str(status["lastRestore"], "at"), _preferences));
        _binding = false; UpdateBusy();
    }

    private void UpdateBusy()
    {
        if (BusyIndicator == null) return;
        var working = _busy || IsLoading;
        RetryButton.IsEnabled = !working;
        BusyIndicator.Visibility = working ? Visibility.Visible : Visibility.Collapsed;
        ExportButton.IsEnabled = !working; ImportButton.IsEnabled = !working;
        ThemeCombo.IsEnabled = !working; LanguageCombo.IsEnabled = !working; ZoneCombo.IsEnabled = !working;
        var source = J.Str(_backup, "tokenSource"); var external = source.Length > 0 && source != "config";
        var available = _backup != null && !working;
        RepoInput.IsEnabled = available; TokenInput.IsEnabled = available && !external;
        SaveBackupButton.IsEnabled = available && (RepoInput.Text.Trim() != J.Str(_backup, "repo") || TokenInput.Password.Trim().Length > 0);
        ClearTokenButton.Visibility = J.Bool(_backup, "tokenSaved") ? Visibility.Visible : Visibility.Collapsed;
        ClearTokenButton.IsEnabled = available;
        DetectButton.IsEnabled = available;
        var configured = J.Bool(_backup, "configured"); var saved = RepoInput.Text.Trim() == J.Str(_backup, "repo");
        var online = !J.Bool(_backup, "offline"); var backendBusy = J.Str(_backup, "busy").Length > 0;
        UploadButton.IsEnabled = RestoreButton.IsEnabled = available && configured && saved && online && !backendBusy;
        BackupActionHint.Text = !online ? T("当前是离线会话，备份和恢复不可用。", "Backup and restore are unavailable in this offline session.")
            : !configured ? T("先保存私有仓库和可用凭据。", "Save a private repository and valid credentials first.")
            : !saved ? T("请先保存修改后的仓库。", "Save the edited repository first.")
            : T("上传完整快照；恢复时先保留本机安全副本，再合并去重。", "Upload a full snapshot. Restore saves a local safety copy before merging and deduplicating.");
    }

    private async Task RunAsync(Func<Task<string?>> action, bool refreshStatus = true)
    {
        if (_busy || IsLoading) return;
        _busy = true; UpdateBusy(); Notice.IsOpen = false;
        try
        {
            var message = await action();
            if (_active && message != null) ManagementUi.Alert(Notice, message);
        }
        catch (Exception ex) { if (_active) ManagementUi.Alert(Notice, ex.Message, true); }
        finally
        {
            _busy = false; UpdateBusy();
            if (_active && refreshStatus) await ReloadAsync();
        }
    }

    private async void Export_Click(object sender, RoutedEventArgs args)
    {
        await RunAsync(async () =>
        {
            var file = await DesktopFiles.PickSaveAsync("toksight-backup.sqlite", ".sqlite");
            if (file == null) return null;
            var bytes = await _api.ExportDatabaseAsync();
            await File.WriteAllBytesAsync(file, bytes);
            return T("完整数据库已导出：", "Full database exported: ") + file;
        }, false);
    }

    private async void Import_Click(object sender, RoutedEventArgs args)
    {
        await RunAsync(async () =>
        {
            var file = await DesktopFiles.PickOpenDatabaseAsync();
            if (file == null) return null;
            if (new FileInfo(file).Length > 256L * 1024 * 1024) throw new InvalidOperationException(T("备份超过 256 MiB 限制。", "The backup exceeds the 256 MiB limit."));
            if (!await ManagementUi.ConfirmAsync(this, _preferences, T("导入并合并数据库？", "Import and merge this database?"),
                Path.GetFileName(file) + "\n\n" + T("备份将先校验，再合并进本机数据库。重复记录会去重，当前记录不会被删除。", "The backup is validated before merging into the local database. Duplicate records are deduplicated; current records are not deleted."), T("合并", "Merge"))) return null;
            return ManagementUi.MergeSummary(await _api.ImportDatabaseAsync(file), _preferences);
        });
    }

    private async void SaveBackup_Click(object sender, RoutedEventArgs args)
    {
        await RunAsync(async () =>
        {
            var input = new Dictionary<string, object?> { ["repo"] = RepoInput.Text.Trim() };
            // RunAsync disables the controls; token eligibility is based on the effective source.
            var source = J.Str(_backup, "tokenSource");
            if ((source.Length == 0 || source == "config") && TokenInput.Password.Trim().Length > 0) input["token"] = TokenInput.Password.Trim();
            var status = await _api.PostAsync("/api/sync/config", input);
            TokenInput.Password = ""; if (_active) ApplyStatus(status);
            return T("备份设置已保存。", "Backup settings saved.");
        });
    }

    private async void ClearToken_Click(object sender, RoutedEventArgs args)
    {
        await RunAsync(async () =>
        {
            var status = await _api.PostAsync("/api/sync/config", new { clearToken = true });
            TokenInput.Password = ""; if (_active) ApplyStatus(status, true);
            return T("已清除本机保存的令牌。环境变量或 gh 凭据不受影响。", "The locally saved token was cleared. Environment and gh credentials are unchanged.");
        });
    }

    private async void Detect_Click(object sender, RoutedEventArgs args)
    {
        await RunAsync(async () =>
        {
            var status = await _api.GetAsync("/api/sync/status?refresh=1");
            if (_active) ApplyStatus(status, true);
            return T("本机凭据状态已更新。", "Local credential status updated.");
        }, false);
    }

    private async void Upload_Click(object sender, RoutedEventArgs args)
    {
        await RunAsync(async () =>
        {
            var response = await _api.PostAsync("/api/sync/upload");
            if (_active) ApplyStatus(response, true);
            return J.Bool(response["result"], "unchanged") ? T("远端备份已是最新。", "The remote backup is already current.") : T("已上传到私有仓库。", "Backup uploaded to the private repository.");
        });
    }

    private async void Restore_Click(object sender, RoutedEventArgs args)
    {
        await RunAsync(async () =>
        {
            if (!await ManagementUi.ConfirmAsync(this, _preferences, T("从 GitHub 恢复并合并？", "Restore and merge from GitHub?"),
                J.Str(_backup, "repo") + " / " + J.Str(_backup, "remotePath") + "\n\n" +
                T("远端快照将校验后合并，本机现有记录会保留。恢复前会创建本机安全副本：", "The remote snapshot is validated and merged while retaining existing local records. A local safety copy is created first:") + "\n" + J.Str(_backup, "safetyBackup"), T("恢复并合并", "Restore and merge"))) return null;
            var response = await _api.PostAsync("/api/sync/restore");
            if (_active) ApplyStatus(response, true);
            return ManagementUi.MergeSummary(response["result"], _preferences);
        });
    }

    private void BackupInput_Changed(object sender, TextChangedEventArgs args) { if (!_binding) UpdateBusy(); }
    private async void Retry_Click(object sender, RoutedEventArgs args) { Notice.IsOpen = false; await ReloadAsync(); }
    private void Token_Changed(object sender, RoutedEventArgs args) { if (!_binding) UpdateBusy(); }
    private void Theme_Changed(object sender, SelectionChangedEventArgs args)
    {
        if (!_binding && ThemeCombo.SelectedItem is ManagementChoice choice) SavePreference(() => _preferences.Theme = choice.Id);
    }
    private void Language_Changed(object sender, SelectionChangedEventArgs args)
    {
        if (!_binding && LanguageCombo.SelectedItem is ManagementChoice choice) SavePreference(() => _preferences.Language = choice.Id);
    }
    private void Zone_Changed(object sender, SelectionChangedEventArgs args)
    {
        if (!_binding && ZoneCombo.SelectedItem is ManagementChoice choice) SavePreference(() => _preferences.TimeZonePreference = choice.Id);
    }
    private void SavePreference(Action update)
    {
        try { update(); _preferences.Save(); }
        catch (Exception ex) { ManagementUi.Alert(Notice, ex.Message, true); }
    }
}
