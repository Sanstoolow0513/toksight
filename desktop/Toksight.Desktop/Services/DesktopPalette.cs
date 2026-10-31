using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;

namespace Toksight.Desktop.Services;

public static class DesktopPalette
{
    // Code-created controls must resolve the window theme, not the application's default theme.
    public static Brush Brush(string key)
    {
        var theme = (App.MainWindow?.Content as FrameworkElement)?.ActualTheme ?? ElementTheme.Default;
        var name = new Windows.UI.ViewManagement.AccessibilitySettings().HighContrast ? "HighContrast" : theme == ElementTheme.Light ? "Light" : "Default";
        var dictionary = (ResourceDictionary)Application.Current.Resources.ThemeDictionaries[name];
        return (Brush)dictionary[key];
    }
}
