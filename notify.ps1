# Shows a Windows notification. Used by fetch_data.bat when the morning Garmin fetch fails.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File notify.ps1 -Title "..." [-Message "..."] [-StatusFile data\fetch_status.json]
# Without -Message, the error is read from the status file written by fetch_garmin.py.
param(
    [string]$Title = "Running Log",
    [string]$Message = "",
    [string]$StatusFile = ""
)

if (-not $Message -and $StatusFile -and (Test-Path $StatusFile)) {
    $status = Get-Content -Raw -Encoding UTF8 $StatusFile | ConvertFrom-Json
    $Message = "$($status.error) See data\fetch_data.log."
}
if (-not $Message) { $Message = "See data\fetch_data.log." }

# Windows' own notification API (no extra modules needed)
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $template.GetElementsByTagName("text")
$texts.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
$texts.Item(1).AppendChild($template.CreateTextNode($Message)) | Out-Null

# Shown under PowerShell's name: a notification needs an app id that Windows knows
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($template))
