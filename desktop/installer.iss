; Inno Setup 6.3+; invoke with /DSourceDir, /DOutputDir, /DAppVersion,
; /DAppArch and /DOutputBaseFilename. See doc/desktop.md.
#ifndef SourceDir
  #error SourceDir must point to a desktop publish directory
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#ifndef AppVersion
  #define AppVersion "1.3.0"
#endif
#ifndef AppArch
  #define AppArch "x64"
#endif
#ifndef OutputBaseFilename
  #define OutputBaseFilename "toksight-setup"
#endif
#if AppArch == "arm64"
  #define InstallArch "arm64"
#elif AppArch == "x64"
  #define InstallArch "x64compatible"
#else
  #error AppArch must be x64 or arm64
#endif

[Setup]
AppId={{4C052BE6-DB64-4E90-8D64-2962B909C2ED}
AppName=toksight
AppVersion={#AppVersion}
AppPublisher=toksight
DefaultDirName={localappdata}\Programs\toksight
DefaultGroupName=toksight
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed={#InstallArch}
ArchitecturesInstallIn64BitMode={#InstallArch}
MinVersion=10.0.19041
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\Toksight.Desktop.exe
CloseApplications=yes

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\toksight"; Filename: "{app}\Toksight.Desktop.exe"

[Run]
Filename: "{app}\Toksight.Desktop.exe"; Description: "Open toksight"; Flags: nowait postinstall skipifsilent
