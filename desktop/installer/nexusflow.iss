; NexusFlow Desktop Installer Script for Inno Setup
; Creates a user-level (no-admin-needed) installer.
;
; AppVersion is injected at build time via ISCC /DAppVersion=<version>
; (see desktop/build-installer.js, which reads it from the root package.json).
; The fallback below only applies when the script is compiled directly.

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif

[Setup]
AppName=NexusFlow
AppVersion={#AppVersion}
AppPublisher=Antigravity team
AppPublisherURL=https://github.com/mrpatronz/nexusflow
DefaultDirName={localappdata}\Programs\NexusFlow
DefaultGroupName=NexusFlow
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\nexusflow-desktop-win_x64.exe
Compression=lzma2
SolidCompression=yes
OutputDir=..\dist-installer-output
OutputBaseFilename=NexusFlowSetup
PrivilegesRequired=lowest
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist-installer\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\NexusFlow"; Filename: "{app}\nexusflow-desktop-win_x64.exe"
Name: "{userdesktop}\NexusFlow"; Filename: "{app}\nexusflow-desktop-win_x64.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\nexusflow-desktop-win_x64.exe"; Description: "{cm:LaunchProgram,NexusFlow}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\nexusflow-desktop-win_x64.exe"; Flags: nowait skipifnotsilent
