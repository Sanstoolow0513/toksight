using Microsoft.UI.Xaml;

namespace Toksight.Desktop.Services;

public interface IDesktopPage
{
    Task ReloadAsync();
    void OnLeaving();
    FrameworkElement? ExportElement { get; }
    bool IsLoading { get; }
}
