<#
.SYNOPSIS
    Drashti audit kit: ProPresenter 7 Windows PC (read-only).

.DESCRIPTION
    A read-only inventory of this PC for the move from ProPresenter to Drashti.
    It reads system information and ProPresenter's own files, then writes
    audit-report.md and audit.json into a new folder named after this PC.

    It never changes settings, never edits, moves or deletes your files, and
    needs no installs, no extra modules and no administrator rights. The
    optional -Collect step only COPIES files to the destination you give it.

    Run it with (see README.md):
      powershell -NoProfile -ExecutionPolicy Bypass -File .\audit-windows.ps1

.PARAMETER OutDir
    Put the report folder inside this folder (default: next to this script).
.PARAMETER Collect
    Also COPY ProPresenter data folders and non-default fonts here (for example E:\).
.PARAMETER NoMedia
    With -Collect: leave out video, image and audio files.
.PARAMETER SearchRoot
    Also look for ProPresenter folders and files under these folders.
.PARAMETER SkipSystem
    Skip the hardware, display, audio and device sections (testing).
.PARAMETER NoDefaultLocations
    Only look under -SearchRoot, not in the usual places (testing).
#>
[CmdletBinding()]
param(
    [string]$OutDir,
    [string]$Collect,
    [switch]$NoMedia,
    [string[]]$SearchRoot,
    [switch]$SkipSystem,
    [switch]$NoDefaultLocations
)

$ErrorActionPreference = 'Continue'
$ScriptVersion = '1.1.0'
$Schema = 'drashti-audit/1'
$Inv = [System.Globalization.CultureInfo]::InvariantCulture
$OnWindows = ($PSVersionTable.PSVersion.Major -le 5) -or ($IsWindows -eq $true)
$MediaExtRe = '^(mp4|m4v|mov|qt|avi|wmv|mkv|mpg|mpeg|mts|m2ts|ts|webm|flv|3gp|mxf|dv|jpg|jpeg|png|gif|bmp|tif|tiff|heic|webp|psd|mp3|wav|aif|aiff|m4a|aac|flac|ogg|wma|caf)$'
$SkipExtRe = '^(sqlite|sqlite-wal|sqlite-shm|db|log|txt|json|plist|ttf|otf|ttc|otc|fon|woff|woff2|pdf|exe|dll|msi|zip|lnk|ini|dmp|etl|tmp)$'
$PpDocRe = '\.(pro6|pro5|pro4|pro6pl|pro6x|pro6plx|pro6template|probundle|proplaylist)$'
$LegacyFontRe = 'gopika|terafont|lmg[-_ ]|shree[-_ ]?(guj|dev)|shreelipi|shree lipi|kruti ?dev|devlys|chanakya|aps[-_ ]?dv|akruti|sulekh'
$SensitiveRe = 'licen[cs]e|regist|serial|unlock|activat|passw|passcode|pwd|secret|token|api[_ -]?key|auth|credential|stream[_ -]?key|streamkey|private[_ -]?key|rtmp|e-?mail|ccli'
$TrustedInstallerSid = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'

$script:Errors = New-Object System.Collections.ArrayList
function Add-AuditError([string]$Section, [string]$Message) {
    $clean = ($Message -replace '[\r\n\t]+', ' ')
    [void]$script:Errors.Add([ordered]@{ section = $Section; message = $clean })
    Write-Host "   ! ${Section}: $clean" -ForegroundColor Yellow
}
function Write-Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Note([string]$Text) { Write-Host "   $Text" }

function Get-CimSafe([string]$Class, [string]$Namespace = 'root\cimv2') {
    try {
        return @(Get-CimInstance -Namespace $Namespace -ClassName $Class -ErrorAction Stop)
    } catch {
        return @(Get-WmiObject -Namespace $Namespace -Class $Class -ErrorAction Stop)
    }
}

function Format-Bytes($Bytes) {
    $b = [double]$Bytes
    $units = @('B', 'KB', 'MB', 'GB', 'TB')
    $i = 0
    while ($b -ge 1024 -and $i -lt 4) { $b = $b / 1024; $i++ }
    if ($i -eq 0) { return ('{0} {1}' -f [int64]$b, $units[$i]) }
    return ([string]::Format($Inv, '{0:0.0} {1}', $b, $units[$i]))
}

function Protect-Value([string]$Key, [string]$Value) {
    if ($Key -match $SensitiveRe) { return '[REDACTED]' }
    if ($null -eq $Value) { return $null }
    if ($Value -match 'rtmps?://') { return '[REDACTED-STREAM-URL]' }
    if ($Value -match '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}') { return '[REDACTED-EMAIL]' }
    if ($Value -match '(^|[^A-Za-z0-9])[A-Za-z0-9]{4,6}(-[A-Za-z0-9]{4,6}){3,}([^A-Za-z0-9]|$)') { return '[REDACTED-KEY]' }
    return $Value
}

function Get-Kind([string]$Path) {
    $l = $Path.ToLowerInvariant().Replace('/', '\')
    if ($l -match '\\preferences(\\|$)|\\configuration(\\|$)') { return 'configuration' }
    if ($l -match 'playlist') { return 'playlists' }
    if ($l -match 'template|\\themes(\\|$)') { return 'themes' }
    if ($l -match 'media|\\videos(\\|$)|\\pictures(\\|$)|\\music(\\|$)|assets') { return 'media' }
    if ($l -match '\\appdata\\|\\programdata\\') { return 'app-data' }
    return 'library'
}

function Get-UsedIn([string]$Path) {
    $l = $Path.ToLowerInvariant().Replace('\', '/')
    if ($l -match 'template|/themes/') { return 'themes/templates' }
    if ($l -match 'stage') { return 'stage display' }
    if ($l -match '/configuration/|messages|clocks|props\.pro6|mask\.pro6|/preferences/') { return 'configuration' }
    if ($l -match 'playlist|\.pro6pl$') { return 'playlists' }
    return 'presentations'
}

# ---------------------------------------------------------------------------
# Output folder
# ---------------------------------------------------------------------------
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $OutDir) { $OutDir = $ScriptDir }
if (-not (Test-Path -LiteralPath $OutDir -PathType Container)) { Write-Host "Output folder not found: $OutDir" -ForegroundColor Red; exit 2 }
$OutDir = (Resolve-Path -LiteralPath $OutDir).ProviderPath
if ($Collect) {
    if (-not (Test-Path -LiteralPath $Collect -PathType Container)) { Write-Host "Collect destination not found: $Collect" -ForegroundColor Red; exit 2 }
    $Collect = (Resolve-Path -LiteralPath $Collect).ProviderPath
}
$MachineName = $env:COMPUTERNAME
if (-not $MachineName) { $MachineName = [Environment]::MachineName }
$SafeName = ($MachineName -replace '[^A-Za-z0-9._-]', '-') -replace '-+', '-'
$SafeName = $SafeName.Trim('-')
if (-not $SafeName) { $SafeName = 'pc' }
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$ReportDir = Join-Path $OutDir ($SafeName + '_' + $Stamp)
try { New-Item -ItemType Directory -Path $ReportDir -ErrorAction Stop | Out-Null }
catch { Write-Host "Cannot create $ReportDir. Use -OutDir to pick a folder you can write to." -ForegroundColor Red; exit 1 }

Write-Host "Drashti audit $ScriptVersion (read-only) on $MachineName"
Write-Host "Report folder: $ReportDir"
$T0 = Get-Date

# ---------------------------------------------------------------------------
# Native helper (C# 5, .NET Framework 4.x): display modes and fast parsers
# ---------------------------------------------------------------------------
$HelperSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace DrashtiAudit
{
    public class ScreenInfo
    {
        public string GdiName = "";
        public string AdapterName = "";
        public string MonitorName = "";
        public string Connection = "";
        public bool Primary;
        public int PixelWidth;
        public int PixelHeight;
        public double RefreshHz;
        public int X;
        public int Y;
        public int BitsPerPixel;
        public int Rotation;
        public int SignalWidth;
        public int SignalHeight;
        public int Dpi;
        public int Targets;
    }

    public static class Displays
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct DISPLAY_DEVICE
        {
            public int cb;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
            public int StateFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct DEVMODE
        {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
            public short dmSpecVersion;
            public short dmDriverVersion;
            public short dmSize;
            public short dmDriverExtra;
            public int dmFields;
            public int dmPositionX;
            public int dmPositionY;
            public int dmDisplayOrientation;
            public int dmDisplayFixedOutput;
            public short dmColor;
            public short dmDuplex;
            public short dmYResolution;
            public short dmTTOption;
            public short dmCollate;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
            public short dmLogPixels;
            public int dmBitsPerPel;
            public int dmPelsWidth;
            public int dmPelsHeight;
            public int dmDisplayFlags;
            public int dmDisplayFrequency;
            public int dmICMMethod;
            public int dmICMIntent;
            public int dmMediaType;
            public int dmDitherType;
            public int dmReserved1;
            public int dmReserved2;
            public int dmPanningWidth;
            public int dmPanningHeight;
        }

        [StructLayout(LayoutKind.Sequential)] public struct LUID { public uint LowPart; public int HighPart; }
        [StructLayout(LayoutKind.Sequential)] public struct RATIONAL { public uint Numerator; public uint Denominator; }
        [StructLayout(LayoutKind.Sequential)] public struct REGION2D { public uint cx; public uint cy; }
        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct PATH_SOURCE_INFO { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint statusFlags; }

        [StructLayout(LayoutKind.Sequential)]
        public struct PATH_TARGET_INFO
        {
            public LUID adapterId;
            public uint id;
            public uint modeInfoIdx;
            public uint outputTechnology;
            public uint rotation;
            public uint scaling;
            public RATIONAL refreshRate;
            public uint scanLineOrdering;
            public int targetAvailable;
            public uint statusFlags;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct PATH_INFO { public PATH_SOURCE_INFO sourceInfo; public PATH_TARGET_INFO targetInfo; public uint flags; }

        [StructLayout(LayoutKind.Sequential)]
        public struct VIDEO_SIGNAL_INFO
        {
            public ulong pixelRate;
            public RATIONAL hSyncFreq;
            public RATIONAL vSyncFreq;
            public REGION2D activeSize;
            public REGION2D totalSize;
            public uint videoStandard;
            public uint scanLineOrdering;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct SOURCE_MODE { public uint width; public uint height; public uint pixelFormat; public POINT position; }

        [StructLayout(LayoutKind.Explicit)]
        public struct MODE_UNION
        {
            [FieldOffset(0)] public VIDEO_SIGNAL_INFO targetMode;
            [FieldOffset(0)] public SOURCE_MODE sourceMode;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MODE_INFO { public uint infoType; public uint id; public LUID adapterId; public MODE_UNION mode; }

        [StructLayout(LayoutKind.Sequential)]
        public struct DEVICE_INFO_HEADER { public uint type; public uint size; public LUID adapterId; public uint id; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct TARGET_DEVICE_NAME
        {
            public DEVICE_INFO_HEADER header;
            public uint flags;
            public uint outputTechnology;
            public ushort edidManufactureId;
            public ushort edidProductCodeId;
            public uint connectorInstance;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string monitorFriendlyDeviceName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string monitorDevicePath;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct SOURCE_DEVICE_NAME
        {
            public DEVICE_INFO_HEADER header;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string viewGdiDeviceName;
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern bool EnumDisplayDevices(string lpDevice, uint iDevNum, ref DISPLAY_DEVICE lpDisplayDevice, uint dwFlags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern bool EnumDisplaySettingsEx(string lpszDeviceName, int iModeNum, ref DEVMODE lpDevMode, uint dwFlags);
        [DllImport("user32.dll")]
        static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPaths, out uint numModes);
        [DllImport("user32.dll")]
        static extern int QueryDisplayConfig(uint flags, ref uint numPaths, [Out] PATH_INFO[] paths, ref uint numModes, [Out] MODE_INFO[] modes, IntPtr topology);
        [DllImport("user32.dll")]
        static extern int DisplayConfigGetDeviceInfo(ref TARGET_DEVICE_NAME packet);
        [DllImport("user32.dll")]
        static extern int DisplayConfigGetDeviceInfo(ref SOURCE_DEVICE_NAME packet);
        [DllImport("user32.dll")]
        static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
        [DllImport("shcore.dll")]
        static extern int GetDpiForMonitor(IntPtr monitor, int dpiType, out uint dpiX, out uint dpiY);
        [DllImport("user32.dll")]
        static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

        static string Tech(uint t)
        {
            switch (t)
            {
                case 0xFFFFFFFF: return "other";
                case 0: return "VGA";
                case 1: return "S-Video";
                case 2: return "composite";
                case 3: return "component";
                case 4: return "DVI";
                case 5: return "HDMI";
                case 6: return "LVDS (internal)";
                case 8: return "D-Jpn";
                case 9: return "SDI";
                case 10: return "DisplayPort";
                case 11: return "DisplayPort (internal)";
                case 12: return "UDI";
                case 13: return "UDI (internal)";
                case 14: return "SDTV dongle";
                case 15: return "Miracast";
                case 16: return "indirect (wired)";
                case 17: return "indirect (virtual)";
                case 18: return "DisplayPort over USB";
                case 0x80000000: return "internal";
                default: return "unknown (" + t + ")";
            }
        }

        public static List<ScreenInfo> Read(List<string> problems)
        {
            List<ScreenInfo> list = new List<ScreenInfo>();
            Dictionary<string, ScreenInfo> byGdi = new Dictionary<string, ScreenInfo>(StringComparer.OrdinalIgnoreCase);
            for (uint i = 0; i < 64; i++)
            {
                DISPLAY_DEVICE dd = new DISPLAY_DEVICE();
                dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
                if (!EnumDisplayDevices(null, i, ref dd, 0)) break;
                if ((dd.StateFlags & 0x1) == 0) continue;
                ScreenInfo s = new ScreenInfo();
                s.GdiName = dd.DeviceName;
                s.AdapterName = dd.DeviceString;
                s.Primary = (dd.StateFlags & 0x4) != 0;
                DEVMODE dm = new DEVMODE();
                dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
                if (EnumDisplaySettingsEx(dd.DeviceName, -1, ref dm, 0))
                {
                    s.PixelWidth = dm.dmPelsWidth;
                    s.PixelHeight = dm.dmPelsHeight;
                    s.RefreshHz = dm.dmDisplayFrequency;
                    s.X = dm.dmPositionX;
                    s.Y = dm.dmPositionY;
                    s.BitsPerPixel = dm.dmBitsPerPel;
                    s.Rotation = dm.dmDisplayOrientation * 90;
                }
                DISPLAY_DEVICE mon = new DISPLAY_DEVICE();
                mon.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
                if (EnumDisplayDevices(dd.DeviceName, 0, ref mon, 0)) s.MonitorName = mon.DeviceString;
                list.Add(s);
                byGdi[s.GdiName] = s;
            }
            try
            {
                uint np, nm;
                const uint QDC_ONLY_ACTIVE_PATHS = 2;
                if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, out np, out nm) == 0)
                {
                    PATH_INFO[] paths = new PATH_INFO[np];
                    MODE_INFO[] modes = new MODE_INFO[nm];
                    if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, ref np, paths, ref nm, modes, IntPtr.Zero) == 0)
                    {
                        for (int p = 0; p < np; p++)
                        {
                            SOURCE_DEVICE_NAME src = new SOURCE_DEVICE_NAME();
                            src.header.type = 1;
                            src.header.size = (uint)Marshal.SizeOf(typeof(SOURCE_DEVICE_NAME));
                            src.header.adapterId = paths[p].sourceInfo.adapterId;
                            src.header.id = paths[p].sourceInfo.id;
                            if (DisplayConfigGetDeviceInfo(ref src) != 0) continue;
                            TARGET_DEVICE_NAME tgt = new TARGET_DEVICE_NAME();
                            tgt.header.type = 2;
                            tgt.header.size = (uint)Marshal.SizeOf(typeof(TARGET_DEVICE_NAME));
                            tgt.header.adapterId = paths[p].targetInfo.adapterId;
                            tgt.header.id = paths[p].targetInfo.id;
                            string friendly = "";
                            string tech = Tech(paths[p].targetInfo.outputTechnology);
                            if (DisplayConfigGetDeviceInfo(ref tgt) == 0)
                            {
                                friendly = tgt.monitorFriendlyDeviceName ?? "";
                                tech = Tech(tgt.outputTechnology);
                            }
                            ScreenInfo s;
                            if (!byGdi.TryGetValue(src.viewGdiDeviceName, out s))
                            {
                                s = new ScreenInfo();
                                s.GdiName = src.viewGdiDeviceName;
                                list.Add(s);
                                byGdi[s.GdiName] = s;
                            }
                            s.Targets++;
                            if (s.Targets == 1)
                            {
                                if (friendly.Length > 0) s.MonitorName = friendly;
                                s.Connection = tech;
                            }
                            else
                            {
                                s.MonitorName = s.MonitorName + " + " + (friendly.Length > 0 ? friendly : "display");
                                s.Connection = s.Connection + " + " + tech;
                            }
                            RATIONAL r = paths[p].targetInfo.refreshRate;
                            if (r.Denominator > 0 && s.Targets == 1) s.RefreshHz = Math.Round((double)r.Numerator / r.Denominator, 3);
                            uint ti = paths[p].targetInfo.modeInfoIdx;
                            if (ti < nm && modes[ti].infoType == 2 && s.Targets == 1)
                            {
                                s.SignalWidth = (int)modes[ti].mode.targetMode.activeSize.cx;
                                s.SignalHeight = (int)modes[ti].mode.targetMode.activeSize.cy;
                            }
                        }
                    }
                }
            }
            catch (Exception e) { problems.Add("DisplayConfig: " + e.Message); }
            IntPtr old = IntPtr.Zero;
            bool changed = false;
            try { old = SetThreadDpiAwarenessContext(new IntPtr(-4)); changed = old != IntPtr.Zero; } catch (Exception) { }
            try
            {
                foreach (ScreenInfo s in list)
                {
                    if (s.PixelWidth <= 0) continue;
                    POINT pt = new POINT();
                    pt.X = s.X + s.PixelWidth / 2;
                    pt.Y = s.Y + s.PixelHeight / 2;
                    IntPtr h = MonitorFromPoint(pt, 2);
                    uint dx, dy;
                    if (h != IntPtr.Zero && GetDpiForMonitor(h, 0, out dx, out dy) == 0) s.Dpi = (int)dx;
                }
            }
            catch (Exception e) { problems.Add("DPI: " + e.Message); }
            finally
            {
                if (changed) { try { SetThreadDpiAwarenessContext(old); } catch (Exception) { } }
            }
            return list;
        }
    }

    // Record layouts (same as the Mac script's intermediate lines):
    //   FONT, name, file, latin, gujarati, devanagari, other, encoding
    //   FONTDECL, name, file
    //   MEDIA, path, file, "" | "approx"
    //   DOC, path, file
    //   STAT, file, "xml" | "protobuf", slides, groups, textElements, playlistNodes, mediaCues
    public static class Analyzer
    {
        public static List<string[]> Records = new List<string[]>();
        static readonly Encoding Latin1 = Encoding.GetEncoding(28591);
        static readonly Encoding Utf8 = new UTF8Encoding(false, false);
        const string UrlSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#[]@!$&'()*+,;=%";
        const string SkipWords = "|colortbl|stylesheet|info|pict|expandedcolortbl|listtable|listoverridetable|header|footer|headerl|headerr|headerf|footerl|footerr|footerf|rsidtbl|generator|xmlnstbl|themedata|colorschememapping|latentstyles|datastore|fldinst|object|nonshppict|shppict|revtbl|filetbl|pgdsctbl|mmathPr|NeXTGraphic|";
        static readonly Regex RxRtfIvar = new Regex("rvXMLIvarName=\"RTFData\">([^<]*)<", RegexOptions.Compiled);
        static readonly Regex RxRtfAttr = new Regex("\\sRTFData=\"([^\"]*)\"", RegexOptions.Compiled);
        static readonly Regex RxFlowIvar = new Regex("rvXMLIvarName=\"WinFlowData\">([^<]*)<", RegexOptions.Compiled);
        static readonly Regex RxFlowAttr = new Regex("\\sWinFlowData=\"([^\"]*)\"", RegexOptions.Compiled);
        static readonly Regex RxSource = new Regex("\\ssource=\"([^\"]*)\"", RegexOptions.Compiled);
        static readonly Regex RxFilePath = new Regex("\\sfilePath=\"([^\"]*)\"", RegexOptions.Compiled);
        static readonly Regex RxFontFamily = new Regex("FontFamily=\"([^\"{][^\"]*)\"", RegexOptions.Compiled);
        static readonly Regex RxLooksLikePath = new Regex("^(file:|/|~/|[A-Za-z]:[\\\\/]|\\\\\\\\)", RegexOptions.Compiled);
        static readonly Regex RxHasExtension = new Regex("\\.[A-Za-z0-9]+$", RegexOptions.Compiled);

        public static void Reset() { Records = new List<string[]>(); }
        static void Add(params string[] r) { Records.Add(r); }
        static bool IsAlpha(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
        static void Inc(Dictionary<string, int> d, string k) { int v; d.TryGetValue(k, out v); d[k] = v + 1; }
        static int Get(Dictionary<string, int> d, string k) { int v; d.TryGetValue(k, out v); return v; }

        public static string UrlToPath(string u)
        {
            string p = u;
            if (p.StartsWith("file://localhost/", StringComparison.OrdinalIgnoreCase)) p = p.Substring(16);
            else if (p.StartsWith("file:///", StringComparison.OrdinalIgnoreCase)) p = p.Substring(7);
            else if (p.StartsWith("file://", StringComparison.OrdinalIgnoreCase)) p = "//" + p.Substring(7);
            else if (p.StartsWith("file:", StringComparison.OrdinalIgnoreCase)) p = p.Substring(5);
            else return p;
            try { p = Uri.UnescapeDataString(p); } catch (Exception) { }
            if (p.Length >= 3 && p[0] == '/' && IsAlpha(p[1]) && p[2] == ':') p = p.Substring(1);
            if (p.StartsWith("//~/")) p = p.Substring(2);
            if (p.Length >= 2 && IsAlpha(p[0]) && p[1] == ':') p = p.Replace('/', '\\');
            else if (p.StartsWith("//")) p = p.Replace('/', '\\');
            return p;
        }

        static void Count(Dictionary<string, int> la, Dictionary<string, int> gu, Dictionary<string, int> hi, Dictionary<string, int> ot, Dictionary<string, int> ne, string f, int cp)
        {
            if (cp >= 0x0A80 && cp <= 0x0AFF) Inc(gu, f);
            else if (cp >= 0x0900 && cp <= 0x097F) Inc(hi, f);
            else if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) Inc(la, f);
            else if (cp > 127) Inc(ot, f);
            else Inc(ne, f);
        }

        public static void ScanRtf(string s, string file)
        {
            Dictionary<string, string> ft = new Dictionary<string, string>();
            Dictionary<string, int> la = new Dictionary<string, int>(), gu = new Dictionary<string, int>(), hi = new Dictionary<string, int>(), ot = new Dictionary<string, int>(), ne = new Dictionary<string, int>();
            List<string> cf = new List<string>();
            cf.Add("0");
            int n = s.Length, i = 0, d = 0, skip = 0, ftd = 0, uc = 1, pend = 0;
            string fidx = null;
            StringBuilder fname = new StringBuilder();
            while (i < n)
            {
                char c = s[i];
                if (c == '{')
                {
                    d++;
                    while (cf.Count <= d) cf.Add("0");
                    cf[d] = cf[d - 1];
                    i++;
                    continue;
                }
                if (c == '}')
                {
                    if (ftd > 0 && d == ftd) ftd = 0;
                    if (skip > 0 && d == skip) skip = 0;
                    if (d > 0) d--;
                    i++;
                    continue;
                }
                if (c == '\\')
                {
                    char nc = i + 1 < n ? s[i + 1] : '\0';
                    if (IsAlpha(nc))
                    {
                        int j = i + 1;
                        while (j < n && IsAlpha(s[j])) j++;
                        string w = s.Substring(i + 1, j - i - 1);
                        int k = j;
                        if (k < n && s[k] == '-') k++;
                        while (k < n && s[k] >= '0' && s[k] <= '9') k++;
                        string prm = s.Substring(j, k - j);
                        if (k < n && s[k] == ' ') k++;
                        i = k;
                        if (skip > 0) continue;
                        if (w == "fonttbl") { ftd = d; continue; }
                        if (SkipWords.IndexOf("|" + w + "|", StringComparison.Ordinal) >= 0) { skip = d; continue; }
                        if (ftd > 0) { if (w == "f") { fidx = prm; fname.Length = 0; } continue; }
                        if (w == "f") { cf[d] = prm; continue; }
                        if (w == "uc") { int.TryParse(prm, out uc); continue; }
                        if (w == "u")
                        {
                            int cp;
                            if (int.TryParse(prm, out cp)) { if (cp < 0) cp += 65536; Count(la, gu, hi, ot, ne, cf[d], cp); }
                            pend = uc;
                            continue;
                        }
                        continue;
                    }
                    if (nc == '\'')
                    {
                        if (skip == 0)
                        {
                            if (ftd > 0) fname.Append("\\'").Append(s.Substring(i + 2, Math.Min(2, Math.Max(0, n - i - 2))));
                            else if (pend > 0) pend--;
                            else Count(la, gu, hi, ot, ne, cf[d], 128);
                        }
                        i += 4;
                        continue;
                    }
                    if (nc == '*') { if (skip == 0) skip = d; i += 2; continue; }
                    if (skip == 0 && (nc == '\\' || nc == '{' || nc == '}'))
                    {
                        if (ftd > 0) fname.Append(nc);
                        else if (pend > 0) pend--;
                        else Count(la, gu, hi, ot, ne, cf[d], 0);
                    }
                    i += 2;
                    continue;
                }
                if (c == '\n' || c == '\r') { i++; continue; }
                if (skip > 0) { i++; continue; }
                if (ftd > 0)
                {
                    if (c == ';') { if (fidx != null) ft[fidx] = fname.ToString().Trim(); fidx = null; fname.Length = 0; }
                    else fname.Append(c);
                    i++;
                    continue;
                }
                if (pend > 0) { pend--; i++; continue; }
                if (IsAlpha(c)) Inc(la, cf[d]);
                else if (c > 127) Inc(ot, cf[d]);
                else if (c != ' ') Inc(ne, cf[d]);
                i++;
            }
            foreach (KeyValuePair<string, string> kv in ft)
            {
                if (kv.Value.Length == 0) continue;
                string k = kv.Key;
                int total = Get(la, k) + Get(gu, k) + Get(hi, k) + Get(ot, k) + Get(ne, k);
                if (total > 0) Add("FONT", kv.Value, file, Get(la, k).ToString(), Get(gu, k).ToString(), Get(hi, k).ToString(), Get(ot, k).ToString(), "rtf");
                else Add("FONTDECL", kv.Value, file);
            }
        }

        static void ScanRtfBase64(string b64, string file)
        {
            if (b64.Length < 8) return;
            try { ScanRtf(Latin1.GetString(Convert.FromBase64String(b64)), file); } catch (FormatException) { }
        }

        static void ScanXaml(string b64, string file)
        {
            if (b64.Length < 8) return;
            byte[] bytes;
            try { bytes = Convert.FromBase64String(b64); } catch (FormatException) { return; }
            string text;
            if (bytes.Length >= 2 && ((bytes[0] == 0xFF && bytes[1] == 0xFE) || bytes[1] == 0)) text = Encoding.Unicode.GetString(bytes);
            else text = Utf8.GetString(bytes);
            foreach (Match m in RxFontFamily.Matches(text)) Add("FONT", m.Groups[1].Value.Trim(), file, "", "", "", "", "xaml");
        }

        static int CountOf(string t, string pat)
        {
            int n = 0, p = 0;
            while ((p = t.IndexOf(pat, p, StringComparison.Ordinal)) >= 0) { n++; p += pat.Length; }
            return n;
        }

        public static void ScanXml(string t, string file)
        {
            int slides = CountOf(t, "<RVDisplaySlide"), groups = CountOf(t, "<RVSlideGrouping"), texts = CountOf(t, "<RVTextElement");
            int nodes = CountOf(t, "<RVPlaylistNode"), cues = CountOf(t, "<RVMediaCue");
            foreach (Match m in RxRtfIvar.Matches(t)) ScanRtfBase64(m.Groups[1].Value, file);
            foreach (Match m in RxRtfAttr.Matches(t)) ScanRtfBase64(m.Groups[1].Value, file);
            foreach (Match m in RxFlowIvar.Matches(t)) ScanXaml(m.Groups[1].Value, file);
            foreach (Match m in RxFlowAttr.Matches(t)) ScanXaml(m.Groups[1].Value, file);
            foreach (Match m in RxSource.Matches(t)) XmlPath(m.Groups[1].Value, file, "MEDIA");
            foreach (Match m in RxFilePath.Matches(t)) XmlPath(m.Groups[1].Value, file, "DOC");
            Add("STAT", file, "xml", slides.ToString(), groups.ToString(), texts.ToString(), nodes.ToString(), cues.ToString());
        }

        static void XmlPath(string raw, string file, string tag)
        {
            if (raw.Length == 0) return;
            string v = System.Net.WebUtility.HtmlDecode(raw);
            if (RxLooksLikePath.IsMatch(v)) Add(tag, UrlToPath(v), file, "");
        }

        // Length of a protobuf length-delimited field whose data starts at i, or -1.
        static int LengthBefore(byte[] b, int i)
        {
            if (i < 2 || b[i - 1] >= 128) return -1;
            int k = i - 1;
            while (k - 1 >= 0 && b[k - 1] >= 128 && (i - k) < 4) k--;
            if (k < 1) return -1;
            bool tagOk = (b[k - 1] < 128 && (b[k - 1] & 7) == 2) || (k >= 2 && b[k - 1] < 128 && b[k - 2] >= 128 && (b[k - 2] & 7) == 2);
            if (!tagOk) return -1;
            long v = 0, m = 1;
            for (int t = k; t <= i - 1; t++) { v += (b[t] & 127) * m; m *= 128; }
            return v > int.MaxValue ? -1 : (int)v;
        }

        static bool Printable(byte[] b, int i, int len)
        {
            for (int t = i; t < i + len; t++) if (b[t] < 32 || b[t] == 127) return false;
            return true;
        }

        public static void ScanBinary(byte[] b, string file)
        {
            int n = b.Length, nr = 0;
            for (int i = 0; i + 5 < n; i++)
            {
                if (b[i] == 123 && b[i + 1] == 92 && b[i + 2] == 114 && b[i + 3] == 116 && b[i + 4] == 102)
                {
                    int d = 0, j = i;
                    bool esc = false;
                    for (; j < n; j++)
                    {
                        byte c = b[j];
                        if (esc) esc = false;
                        else if (c == 92) esc = true;
                        else if (c == 123) d++;
                        else if (c == 125) { d--; if (d == 0) break; }
                    }
                    if (j >= n) j = n - 1;
                    ScanRtf(Latin1.GetString(b, i, j - i + 1), file);
                    nr++;
                    i = j;
                }
            }
            bool[] used = new bool[n];
            for (int i = 1; i + 7 < n; i++)
            {
                if (b[i] == 102 && b[i + 1] == 105 && b[i + 2] == 108 && b[i + 3] == 101 && b[i + 4] == 58 && b[i + 5] == 47 && b[i + 6] == 47)
                {
                    int len = LengthBefore(b, i);
                    int end;
                    if (len >= 8 && i + len <= n && Printable(b, i, len))
                    {
                        Add("MEDIA", UrlToPath(Utf8.GetString(b, i, len)), file, "");
                        end = i + len;
                    }
                    else
                    {
                        int j = i;
                        while (j < n && b[j] < 128 && UrlSafe.IndexOf((char)b[j]) >= 0) j++;
                        Add("MEDIA", UrlToPath(Utf8.GetString(b, i, j - i)), file, "approx");
                        end = j;
                    }
                    for (int t = i; t < end; t++) used[t] = true;
                    i = end - 1;
                }
            }
            for (int i = 2; i + 3 < n; i++)
            {
                if (used[i]) continue;
                byte c = b[i];
                if (((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) && b[i + 1] == 58 && (b[i + 2] == 92 || b[i + 2] == 47))
                {
                    int len = LengthBefore(b, i);
                    if (len >= 6 && i + len <= n && Printable(b, i, len))
                    {
                        string p = Utf8.GetString(b, i, len);
                        if (RxHasExtension.IsMatch(p)) { Add("MEDIA", p.Replace('/', '\\'), file, ""); i += len - 1; }
                    }
                }
            }
            Add("STAT", file, "protobuf", "", "", nr.ToString(), "", "");
        }
    }
}
'@

$HaveHelper = $false
try {
    if (-not ('DrashtiAudit.Analyzer' -as [type])) { Add-Type -TypeDefinition $HelperSource -Language CSharp -ErrorAction Stop }
    $HaveHelper = $true
} catch {
    Add-AuditError 'helper' ("Could not compile the built-in helper; using slower fallbacks. " + $_.Exception.Message)
}
try { Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop } catch { }

# ---------------------------------------------------------------------------
# 1. Machine
# ---------------------------------------------------------------------------
Write-Step '1/8 Machine and Windows'
$Machine = [ordered]@{
    computerName      = $MachineName
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    platform          = $(if ($OnWindows) { 'windows' } else { 'not windows (test run)' })
}
if ($OnWindows -and -not $SkipSystem) {
    try {
        $os = @(Get-CimSafe 'Win32_OperatingSystem')[0]
        $Machine.osName = [string]$os.Caption
        $Machine.osVersion = [string]$os.Version
        $Machine.osBuild = [string]$os.BuildNumber
        $Machine.osArchitecture = [string]$os.OSArchitecture
        $Machine.electron44Supported = ([int]$os.BuildNumber -ge 10240) -and ([string]$os.OSArchitecture -match '64')
    } catch { Add-AuditError 'machine' $_.Exception.Message }
    try {
        $cv = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
        $Machine.osDisplayVersion = [string]$(if ($cv.DisplayVersion) { $cv.DisplayVersion } else { $cv.ReleaseId })
        $Machine.osUpdateRevision = [string]$cv.UBR
        $Machine.osEdition = [string]$cv.EditionID
    } catch { Add-AuditError 'machine' $_.Exception.Message }
    try {
        $cpus = @(Get-CimSafe 'Win32_Processor')
        $Machine.cpu = [string]$cpus[0].Name.Trim()
        $Machine.cpuCount = $cpus.Count
        $Machine.cpuPhysicalCores = [int]($cpus | Measure-Object -Property NumberOfCores -Sum).Sum
        $Machine.cpuLogicalCores = [int]($cpus | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
        $Machine.cpuMaxClockMHz = [int]$cpus[0].MaxClockSpeed
    } catch { Add-AuditError 'machine' $_.Exception.Message }
    try {
        $cs = @(Get-CimSafe 'Win32_ComputerSystem')[0]
        $Machine.manufacturer = [string]$cs.Manufacturer
        $Machine.model = [string]$cs.Model
        $Machine.memoryBytes = [int64]$cs.TotalPhysicalMemory
    } catch { Add-AuditError 'machine' $_.Exception.Message }
}

# ---------------------------------------------------------------------------
# 2. GPUs and displays
# ---------------------------------------------------------------------------
Write-Step '2/8 GPUs and displays'
$Gpus = New-Object System.Collections.ArrayList
$Screens = New-Object System.Collections.ArrayList
$Monitors = New-Object System.Collections.ArrayList
if ($OnWindows -and -not $SkipSystem) {
    try {
        $vram = @{}
        $classKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
        foreach ($k in @(Get-ChildItem -LiteralPath $classKey -ErrorAction SilentlyContinue)) {
            $p = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
            if ($p -and $p.DriverDesc -and $p.'HardwareInformation.qwMemorySize') { $vram[[string]$p.DriverDesc] = [int64]$p.'HardwareInformation.qwMemorySize' }
        }
        $i = 0
        foreach ($g in @(Get-CimSafe 'Win32_VideoController')) {
            $mem = $null
            if ($vram.ContainsKey([string]$g.Name)) { $mem = $vram[[string]$g.Name] } elseif ($g.AdapterRAM) { $mem = [int64]$g.AdapterRAM }
            $driverDate = $null
            if ($g.DriverDate -is [datetime]) { $driverDate = $g.DriverDate.ToString('yyyy-MM-dd') } elseif ($g.DriverDate) { $driverDate = ([string]$g.DriverDate).Substring(0, [Math]::Min(8, ([string]$g.DriverDate).Length)) }
            [void]$Gpus.Add([ordered]@{
                index = $i; name = [string]$g.Name; vendor = [string]$g.AdapterCompatibility; vramBytes = $mem
                driverVersion = [string]$g.DriverVersion; driverDate = $driverDate; status = [string]$g.Status
                currentMode = $(if ($g.CurrentHorizontalResolution) { '{0} x {1} @ {2} Hz' -f $g.CurrentHorizontalResolution, $g.CurrentVerticalResolution, $g.CurrentRefreshRate } else { $null })
            })
            $i++
        }
    } catch { Add-AuditError 'gpus' $_.Exception.Message }

    if ($HaveHelper) {
        try {
            $problems = New-Object 'System.Collections.Generic.List[string]'
            foreach ($s in [DrashtiAudit.Displays]::Read($problems)) {
                $scale = $null
                if ($s.Dpi -gt 0) { $scale = [Math]::Round($s.Dpi / 96.0, 2) }
                [void]$Screens.Add([ordered]@{
                    displayId = $s.GdiName; name = $s.MonitorName; adapter = $s.AdapterName; connection = $s.Connection
                    pixelWidth = $s.PixelWidth; pixelHeight = $s.PixelHeight; refreshHz = $s.RefreshHz
                    x = $s.X; y = $s.Y; scaleFactor = $scale; dpi = $s.Dpi; main = $s.Primary; builtIn = ($s.Connection -match 'internal')
                    mirrored = ($s.Targets -gt 1); rotation = $s.Rotation; bitsPerPixel = $s.BitsPerPixel
                    signalWidth = $s.SignalWidth; signalHeight = $s.SignalHeight; targets = $s.Targets
                })
            }
            foreach ($p in $problems) { Add-AuditError 'displays' $p }
        } catch { Add-AuditError 'displays' $_.Exception.Message }
    }
    if ($Screens.Count -eq 0) {
        try {
            Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
            $screenType = 'System.Windows.Forms.Screen' -as [type]
            foreach ($sc in $screenType::AllScreens) {
                [void]$Screens.Add([ordered]@{
                    displayId = $sc.DeviceName; name = $null; adapter = $null; connection = $null
                    pixelWidth = $sc.Bounds.Width; pixelHeight = $sc.Bounds.Height; refreshHz = $null
                    x = $sc.Bounds.X; y = $sc.Bounds.Y; scaleFactor = $null; dpi = $null; main = $sc.Primary; builtIn = $null
                    mirrored = $null; rotation = $null; bitsPerPixel = $sc.BitsPerPixel; signalWidth = $null; signalHeight = $null; targets = $null
                })
            }
        } catch { Add-AuditError 'displays' ('Fallback screen list failed: ' + $_.Exception.Message) }
    }
    try {
        foreach ($m in @(Get-CimSafe 'WmiMonitorID' 'root\wmi')) {
            $name = ''
            if ($m.UserFriendlyName) { $name = (-join ($m.UserFriendlyName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ })).Trim() }
            $maker = ''
            if ($m.ManufacturerName) { $maker = (-join ($m.ManufacturerName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ })).Trim() }
            [void]$Monitors.Add([ordered]@{ name = $name; manufacturerCode = $maker; yearOfManufacture = [int]$m.YearOfManufacture; active = [bool]$m.Active; instance = ([string]$m.InstanceName -replace '\\[^\\]*$', '') })
        }
    } catch { Add-AuditError 'displays' ('Monitor names unavailable: ' + $_.Exception.Message) }
    Write-Note ("{0} active screen(s), {1} monitor(s)" -f $Screens.Count, $Monitors.Count)
} else { Write-Note '(skipped)' }

# ---------------------------------------------------------------------------
# 3. Audio, capture, SDI, MIDI and Stream Deck devices; related software
# ---------------------------------------------------------------------------
# What Drashti needs from this PC (Session 16): a graphics chip that decodes video (and, on the computer
# that streams, its encoder), and PowerPoint's automation to turn decks into pictures. Only read.
$Needs = [ordered]@{
    graphics             = ((@($Gpus) | ForEach-Object { $_.name }) -join '; ')
    basicDisplayOnly     = $false
    streamEncoders       = ''
    powerPointAutomation = $false
}
$encoders = New-Object System.Collections.ArrayList
foreach ($g in @($Gpus)) {
    $n = [string]$g.name
    if ($n -match 'NVIDIA') { [void]$encoders.Add('NVENC') }
    elseif ($n -match 'Intel') { [void]$encoders.Add('Quick Sync') }
    elseif ($n -match 'AMD|Radeon') { [void]$encoders.Add('AMF') }
}
$Needs.streamEncoders = (@($encoders) | Select-Object -Unique) -join ', '
$Needs.basicDisplayOnly = (@($Gpus).Count -gt 0) -and (@(@($Gpus) | Where-Object { [string]$_.name -notmatch 'Basic Display|Basic Render|Remote Display|Hyper-V' }).Count -eq 0)
if ($OnWindows) {
    try { $Needs.powerPointAutomation = [bool](Test-Path -LiteralPath 'Registry::HKEY_CLASSES_ROOT\PowerPoint.Application\CurVer') } catch { }
}

Write-Step '3/8 Audio, capture, SDI, MIDI and Stream Deck devices'
$Audio = New-Object System.Collections.ArrayList
$Devices = New-Object System.Collections.ArrayList
$Drivers = New-Object System.Collections.ArrayList
$Software = New-Object System.Collections.ArrayList
$RelatedRe = 'propresenter|renewed ?vision|blackmagic|desktop video|decklink|ultrastudio|atem|aja|ndi|newtek|stream ?deck|elgato|companion|bitfocus|obs studio|vmix|wirecast|resolume|spout|loopmidi|rtpmidi|midi|touchosc|dante|vb-audio|voicemeeter|asio|focusrite|magewell|avermedia|epiphan|powerpoint|vlc|easyworship|openlp|freeshow|mediashout|videohub|hyperdeck'
if ($OnWindows -and -not $SkipSystem) {
    try {
        foreach ($flow in @('Render', 'Capture')) {
            $base = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\$flow"
            $best = $null; $bestStamp = ''
            $rows = New-Object System.Collections.ArrayList
            foreach ($ep in @(Get-ChildItem -LiteralPath $base -ErrorAction Stop)) {
                $ep0 = Get-ItemProperty -LiteralPath $ep.PSPath -ErrorAction SilentlyContinue
                $state = [int]$ep0.DeviceState
                if ($state -band 4) { continue }
                $props = Get-ItemProperty -LiteralPath (Join-Path $ep.PSPath 'Properties') -ErrorAction SilentlyContinue
                $desc = [string]$props.'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
                $iface = [string]$props.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'
                $stateName = switch ($state) { 1 { 'active' } 2 { 'disabled' } 8 { 'unplugged' } default { "state $state" } }
                $stamp = ''
                $role = $ep0.'Role:0'
                if ($role -is [byte[]] -and $role.Length -ge 16) {
                    $parts = for ($t = 0; $t -lt 16; $t += 2) { '{0:D5}' -f [BitConverter]::ToUInt16($role, $t) }
                    $stamp = ($parts[0], $parts[1], $parts[3], $parts[4], $parts[5], $parts[6], $parts[7]) -join ''
                }
                $row = [ordered]@{ name = $(if ($iface) { "$desc ($iface)" } else { $desc }); direction = $(if ($flow -eq 'Render') { 'output' } else { 'input' }); state = $stateName; probableDefault = $false }
                [void]$rows.Add($row)
                if ($state -eq 1 -and $stamp -gt $bestStamp) { $bestStamp = $stamp; $best = $row }
            }
            if ($best) { $best.probableDefault = $true }
            foreach ($r in $rows) { [void]$Audio.Add($r) }
        }
    } catch { Add-AuditError 'audio' $_.Exception.Message }
    try {
        foreach ($sd in @(Get-CimSafe 'Win32_SoundDevice')) {
            [void]$Devices.Add([ordered]@{ category = 'audio-adapter'; name = [string]$sd.Name; vendor = [string]$sd.Manufacturer; product = [string]$sd.Status; source = 'Win32_SoundDevice' })
        }
    } catch { Add-AuditError 'audio' $_.Exception.Message }
    foreach ($asio in @('HKLM:\SOFTWARE\ASIO', 'HKLM:\SOFTWARE\WOW6432Node\ASIO')) {
        foreach ($k in @(Get-ChildItem -LiteralPath $asio -ErrorAction SilentlyContinue)) {
            [void]$Drivers.Add([ordered]@{ category = 'asio-driver'; name = $k.PSChildName; vendor = $null; product = $null; source = $asio })
        }
    }
    try {
        foreach ($d in @(Get-CimSafe 'Win32_PnPEntity')) {
            $name = [string]$d.Name; $maker = [string]$d.Manufacturer; $id = [string]$d.PNPDeviceID; $cls = [string]$d.PNPClass
            $s = ($name + ' ' + $maker + ' ' + $id).ToLowerInvariant()
            $cat = $null
            if ($s -match 'stream ?deck' -or ($id -match 'VID_0FD9' -and $cls -eq 'HIDClass')) { $cat = 'stream-deck' }
            elseif ($s -match 'blackmagic|decklink|ultrastudio|intensity|web presenter|atem|\baja\b|kona|io 4k|t-tap|u-tap|magewell|epiphan|avermedia|cam ?link|game capture|hd60|4k60 pro|capture|grabber|matrox|bluefish|deltacast|ven_bdbd|vid_1edb|ven_f1d0') { $cat = 'capture-sdi' }
            elseif ($s -match 'midi|launchpad|launchkey|apc ?(mini|40|key)|x-?touch|nanokontrol|nanokey|korg|akai|novation|arturia|m-audio|irig|keystation|bcf2000|bcr2000') { $cat = 'midi' }
            elseif ($cls -eq 'Camera' -or $cls -eq 'Image') { $cat = 'camera' }
            elseif ($cls -eq 'Monitor') { $cat = 'monitor' }
            if ($cat) { [void]$Devices.Add([ordered]@{ category = $cat; name = $name; vendor = $maker; product = ($id -replace '\\[^\\]*$', ''); source = "PnP ($cls)" }) }
        }
    } catch { Add-AuditError 'devices' $_.Exception.Message }
    try {
        $vidCat = 'Registry::HKEY_CLASSES_ROOT\CLSID\{860BB310-5D01-11d0-BD3B-00A0C911CE86}\Instance'
        foreach ($k in @(Get-ChildItem -LiteralPath $vidCat -ErrorAction SilentlyContinue)) {
            $fn = (Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue).FriendlyName
            if ($fn) { [void]$Devices.Add([ordered]@{ category = 'video-input'; name = [string]$fn; vendor = $null; product = $null; source = 'DirectShow video capture' }) }
        }
        $drv32 = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Drivers32' -ErrorAction SilentlyContinue
        if ($drv32) {
            foreach ($prop in $drv32.PSObject.Properties) {
                if ($prop.Name -match '^midi') { [void]$Drivers.Add([ordered]@{ category = 'midi-driver'; name = "$($prop.Name) = $($prop.Value)"; vendor = $null; product = $null; source = 'Drivers32' }) }
            }
        }
    } catch { Add-AuditError 'devices' $_.Exception.Message }
    foreach ($u in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')) {
        foreach ($k in @(Get-ChildItem -LiteralPath $u -ErrorAction SilentlyContinue)) {
            $p = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
            if ($p -and $p.DisplayName -and ([string]$p.DisplayName -match $RelatedRe -or [string]$p.Publisher -match 'renewed|blackmagic|aja|newtek|elgato|bitfocus|magewell|focusrite')) {
                [void]$Software.Add([ordered]@{ name = [string]$p.DisplayName; version = [string]$p.DisplayVersion; path = [string]$p.InstallLocation; publisher = [string]$p.Publisher })
            }
        }
    }
    Write-Note ("{0} audio endpoint(s), {1} notable device(s), {2} related program(s)" -f $Audio.Count, $Devices.Count, $Software.Count)
} else { Write-Note '(skipped)' }

# ---------------------------------------------------------------------------
# 4. ProPresenter installs and preferences
# ---------------------------------------------------------------------------
Write-Step '4/8 ProPresenter installs and preferences'
$PpInstalls = New-Object System.Collections.ArrayList
$Prefs = New-Object System.Collections.ArrayList
$PrefPaths = New-Object System.Collections.ArrayList
$PrefFiles = New-Object System.Collections.ArrayList
$Running = New-Object System.Collections.ArrayList
if ($OnWindows) {
    foreach ($u in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')) {
        foreach ($k in @(Get-ChildItem -LiteralPath $u -ErrorAction SilentlyContinue)) {
            $p = Get-ItemProperty -LiteralPath $k.PSPath -ErrorAction SilentlyContinue
            if ($p -and [string]$p.DisplayName -match 'ProPresenter') {
                [void]$PpInstalls.Add([ordered]@{ name = [string]$p.DisplayName; version = [string]$p.DisplayVersion; build = $null; bundleId = $null; architectures = $null; path = [string]$p.InstallLocation; source = 'installed programs' })
            }
        }
    }
    foreach ($pf in @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ }) {
        foreach ($exe in @(Get-ChildItem -LiteralPath (Join-Path $pf 'Renewed Vision') -Recurse -Filter '*ProPresenter*.exe' -ErrorAction SilentlyContinue)) {
            $vi = $exe.VersionInfo
            [void]$PpInstalls.Add([ordered]@{ name = $exe.BaseName; version = [string]$vi.ProductVersion; build = [string]$vi.FileVersion; bundleId = $null; architectures = $null; path = $exe.FullName; source = 'program file' })
        }
    }
    foreach ($proc in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'propresenter' })) {
        if (-not ($Running -contains $proc.ProcessName)) { [void]$Running.Add($proc.ProcessName) }
    }
    $regRoots = @('HKCU:\Software\Renewed Vision', 'HKCU:\Software\RenewedVision', 'HKLM:\SOFTWARE\Renewed Vision', 'HKLM:\SOFTWARE\WOW6432Node\Renewed Vision', 'HKLM:\SOFTWARE\RenewedVision')
    foreach ($root in $regRoots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        [void]$PrefFiles.Add(($root -replace '^HKCU:', 'HKCU') -replace '^HKLM:', 'HKLM')
        $keys = @(Get-Item -LiteralPath $root -ErrorAction SilentlyContinue) + @(Get-ChildItem -LiteralPath $root -Recurse -ErrorAction SilentlyContinue)
        foreach ($k in $keys) {
            if (-not $k) { continue }
            $keyName = ([string]$k.Name -replace '^HKEY_CURRENT_USER', 'HKCU') -replace '^HKEY_LOCAL_MACHINE', 'HKLM'
            foreach ($vn in $k.GetValueNames()) {
                try {
                    $kind = [string]$k.GetValueKind($vn)
                    $data = $k.GetValue($vn, $null, 'DoNotExpandEnvironmentNames')
                    $full = $keyName + '\' + $(if ($vn) { $vn } else { '(Default)' })
                    if ($data -is [byte[]]) { $val = "[binary data, $($data.Length) bytes]" }
                    elseif ($data -is [string[]]) { $val = ($data -join '; ') }
                    else { $val = [string]$data }
                    $safe = Protect-Value $full $val
                    [void]$Prefs.Add([ordered]@{ file = 'registry'; key = $full; type = $kind; value = $safe })
                    if ($safe -eq $val -and $data -is [string] -and $val -match '^([A-Za-z]:\\|\\\\|file:)') {
                        $pth = [Environment]::ExpandEnvironmentVariables($val)
                        if ($pth -match '^file:' -and $HaveHelper) { $pth = [DrashtiAudit.Analyzer]::UrlToPath($pth) }
                        [void]$PrefPaths.Add([ordered]@{ key = $full; path = $pth; exists = $false; type = $null })
                    }
                } catch { Add-AuditError 'preferences' ("$keyName\${vn}: " + $_.Exception.Message) }
            }
        }
    }
}
Write-Note ("{0} install record(s), {1} registry value(s)" -f $PpInstalls.Count, $Prefs.Count)

# ---------------------------------------------------------------------------
# 5. Where ProPresenter keeps its data
# ---------------------------------------------------------------------------
Write-Step '5/8 Finding ProPresenter data (preferences first, then Documents, AppData and a search)'
$Candidates = New-Object System.Collections.ArrayList
$GenericDirs = @{}
foreach ($g in @($env:USERPROFILE, $env:PUBLIC, $env:SystemDrive + '\', 'C:\Users')) { if ($g) { $GenericDirs[$g.TrimEnd('\').ToLowerInvariant()] = $true } }
foreach ($f in @('Desktop', 'MyDocuments', 'MyVideos', 'MyPictures', 'MyMusic', 'CommonDocuments')) {
    try { $gp = [Environment]::GetFolderPath($f); if ($gp) { $GenericDirs[$gp.TrimEnd('\').ToLowerInvariant()] = $true } } catch { }
}
if ($env:USERPROFILE) { $GenericDirs[(Join-Path $env:USERPROFILE 'Downloads').ToLowerInvariant()] = $true }
function Test-Generic([string]$Path) {
    $l = $Path.TrimEnd('\', '/').ToLowerInvariant()
    if ($GenericDirs.ContainsKey($l)) { return $true }
    if ($l -match '^[a-z]:$') { return $true }
    return $false
}
function Test-Excluded([string]$Path) {
    $l = $Path.ToLowerInvariant()
    if ($l.StartsWith($ReportDir.ToLowerInvariant())) { return $true }
    if ($Collect -and $l.StartsWith($Collect.ToLowerInvariant())) { return $true }
    if ($l -match '\$recycle\.bin|\\windows\\|\\program files|-collect(\\|/)|system volume information') { return $true }
    return $false
}
function Add-Candidate([string]$Path, [string]$Via) {
    if (-not $Path) { return }
    if (Test-Excluded $Path) { return }
    [void]$Candidates.Add([ordered]@{ path = $Path; kind = (Get-Kind $Path); via = $Via })
}
function Add-Hit([string]$File, [string]$Via) {
    $dir = Split-Path -Parent $File
    if (Test-Generic $dir) { Add-Candidate $File ($Via + ' (loose file)') } else { Add-Candidate $dir $Via }
}
function Test-PpFile([System.IO.FileInfo]$F) {
    if ($F.Name -match $PpDocRe) { return $true }
    if ($F.Extension -eq '.pro' -and $F.FullName -match 'propresenter|renewed ?vision') { return $true }
    return $false
}

$PrefPathsChecked = New-Object System.Collections.ArrayList
foreach ($pp in $PrefPaths) {
    $pth = $pp.path
    if (Test-Path -LiteralPath $pth -PathType Container) {
        $pp.exists = $true; $pp.type = 'folder'
        if (-not (Test-Generic $pth)) { Add-Candidate $pth 'preferences' }
    } elseif (Test-Path -LiteralPath $pth -PathType Leaf) {
        $pp.exists = $true; $pp.type = 'file'
    }
    [void]$PrefPathsChecked.Add($pp)
}

$SearchDirs = New-Object System.Collections.ArrayList
if (-not $NoDefaultLocations -and $OnWindows) {
    $docs = [Environment]::GetFolderPath('MyDocuments')
    $bases = @($docs, [Environment]::GetFolderPath('CommonDocuments'), [Environment]::GetFolderPath('MyVideos'), [Environment]::GetFolderPath('MyPictures'), [Environment]::GetFolderPath('MyMusic'))
    if ($env:OneDrive) { $bases += (Join-Path $env:OneDrive 'Documents') }
    if ($env:USERPROFILE) { $bases += (Join-Path $env:USERPROFILE 'Documents') }
    foreach ($b in ($bases | Where-Object { $_ } | Select-Object -Unique)) {
        foreach ($d in @(Get-ChildItem -LiteralPath $b -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'propresenter|renewed' })) { Add-Candidate $d.FullName 'default location' }
    }
    foreach ($b in @($env:APPDATA, $env:LOCALAPPDATA, $env:ProgramData) | Where-Object { $_ }) {
        foreach ($d in @(Get-ChildItem -LiteralPath $b -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^renewed ?vision|propresenter' })) { Add-Candidate $d.FullName 'default location' }
    }
    foreach ($drv in @([System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady })) {
        foreach ($d in @(Get-ChildItem -LiteralPath $drv.RootDirectory.FullName -Directory -Recurse -Depth 1 -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'propresenter|renewed ?vision' })) { Add-Candidate $d.FullName 'drive search' }
    }
    foreach ($b in @($docs, [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDocuments')) | Where-Object { $_ } | Select-Object -Unique) { [void]$SearchDirs.Add(@($b, 6)) }
}
foreach ($r in @($SearchRoot | Where-Object { $_ })) {
    if (-not (Test-Path -LiteralPath $r -PathType Container)) { Add-AuditError 'search-root' "Not a folder: $r"; continue }
    $rr = (Resolve-Path -LiteralPath $r).ProviderPath
    $named = @(Get-ChildItem -LiteralPath $rr -Directory -Recurse -Depth 4 -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^propresenter|^renewed ?vision' })
    foreach ($d in $named) { Add-Candidate $d.FullName 'search root' }
    [void]$SearchDirs.Add(@($rr, 10))
}
foreach ($sd in $SearchDirs) {
    foreach ($f in @(Get-ChildItem -LiteralPath $sd[0] -File -Recurse -Depth $sd[1] -ErrorAction SilentlyContinue)) {
        if (Test-PpFile $f) { Add-Hit $f.FullName 'search' }
    }
}

# Fold nested folders into their parent and drop duplicates.
$Locations = New-Object System.Collections.ArrayList
foreach ($c in ($Candidates | Sort-Object { $_.path.ToLowerInvariant() })) {
    $last = $null
    if ($Locations.Count -gt 0) { $last = $Locations[$Locations.Count - 1] }
    $cl = $c.path.TrimEnd('\', '/').ToLowerInvariant()
    if ($last) {
        $ll = $last.path.TrimEnd('\', '/').ToLowerInvariant()
        if ($cl -eq $ll -or $cl.StartsWith($ll + '\') -or $cl.StartsWith($ll + '/')) {
            if ($last.via -notmatch [regex]::Escape($c.via)) { $last.via = $last.via + ', ' + $c.via }
            continue
        }
    }
    [void]$Locations.Add([ordered]@{ path = $c.path.TrimEnd('\', '/'); kind = $c.kind; via = $c.via })
}
Write-Note ("{0} location(s)" -f $Locations.Count)

# ---------------------------------------------------------------------------
# 6. Inventory: file counts and sizes
# ---------------------------------------------------------------------------
Write-Step '6/8 Counting files and sizes'
$AllFiles = New-Object System.Collections.ArrayList
$LocStats = New-Object System.Collections.ArrayList
$LocSubs = New-Object System.Collections.ArrayList
$ExtAgg = @{}
foreach ($loc in $Locations) {
    $files = @()
    if (Test-Path -LiteralPath $loc.path -PathType Container) {
        $files = @(Get-ChildItem -LiteralPath $loc.path -File -Recurse -Force -ErrorAction SilentlyContinue)
    } elseif (Test-Path -LiteralPath $loc.path -PathType Leaf) {
        $files = @(Get-Item -LiteralPath $loc.path -Force -ErrorAction SilentlyContinue)
    }
    $locBytes = [int64]0; $count = 0; $mcount = 0; $locMediaBytes = [int64]0
    $subs = [ordered]@{}
    foreach ($f in $files) {
        $count++; $locBytes += $f.Length
        $ext = $f.Extension.TrimStart('.').ToLowerInvariant()
        if (-not $ext) { $ext = '(none)' }
        if ($ext -match $MediaExtRe) { $mcount++; $locMediaBytes += $f.Length }
        if (-not $ExtAgg.ContainsKey($ext)) { $ExtAgg[$ext] = @(0, [int64]0) }
        $ExtAgg[$ext][0]++; $ExtAgg[$ext][1] += $f.Length
        $rel = $f.FullName.Substring([Math]::Min($f.FullName.Length, $loc.path.Length)).TrimStart('\', '/')
        $top = '(files at top level)'
        $cut = $rel.IndexOfAny([char[]]@('\', '/'))
        if ($cut -gt 0) { $top = $rel.Substring(0, $cut) }
        if (-not $subs.Contains($top)) { $subs[$top] = @(0, [int64]0) }
        $subs[$top][0]++; $subs[$top][1] += $f.Length
        [void]$AllFiles.Add(@($loc.path, $f.FullName, [int64]$f.Length, $ext))
    }
    [void]$LocStats.Add([ordered]@{ path = $loc.path; kind = $loc.kind; foundVia = $loc.via; fileCount = $count; bytes = $locBytes; mediaFileCount = $mcount; mediaBytes = $locMediaBytes })
    foreach ($k in $subs.Keys) { [void]$LocSubs.Add([ordered]@{ location = $loc.path; subfolder = $k; fileCount = $subs[$k][0]; bytes = $subs[$k][1] }) }
}
$ExtStats = New-Object System.Collections.ArrayList
foreach ($k in $ExtAgg.Keys) { [void]$ExtStats.Add([ordered]@{ extension = $k; fileCount = $ExtAgg[$k][0]; bytes = $ExtAgg[$k][1] }) }
$ExtStats = @($ExtStats | Sort-Object { $_.bytes } -Descending)
Write-Note ("{0} file(s)" -f $AllFiles.Count)

# ---------------------------------------------------------------------------
# 7. Fonts installed beyond the Windows defaults
# ---------------------------------------------------------------------------
Write-Step '7/8 Fonts installed beyond the Windows defaults'
$FontsNonDefault = New-Object System.Collections.ArrayList
$InstalledNames = @{}
if ($OnWindows) {
    $fontNamesByFile = @{}
    foreach ($fk in @('HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts', 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts')) {
        $props = Get-ItemProperty -LiteralPath $fk -ErrorAction SilentlyContinue
        if (-not $props) { continue }
        foreach ($pr in $props.PSObject.Properties) {
            if ($pr.Name -match '^PS') { continue }
            $nm = ($pr.Name -replace '\s*\((TrueType|OpenType|All res|VGA res)\)\s*$', '').Trim()
            foreach ($part in ($nm -split '\s*&\s*')) { if ($part) { $InstalledNames[$part.ToLowerInvariant()] = $true } }
            $file = [string]$pr.Value
            if ($file -and -not [System.IO.Path]::IsPathRooted($file)) { $file = Join-Path (Join-Path $env:windir 'Fonts') $file }
            if ($file) { $fontNamesByFile[$file.ToLowerInvariant()] = $nm }
        }
    }
    try {
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
        $coll = New-Object System.Drawing.Text.InstalledFontCollection
        foreach ($fam in $coll.Families) { $InstalledNames[$fam.Name.ToLowerInvariant()] = $true }
    } catch { Add-AuditError 'fonts' ('Installed font families unavailable: ' + $_.Exception.Message) }
    $sysFonts = Join-Path $env:windir 'Fonts'
    foreach ($f in @(Get-ChildItem -LiteralPath $sysFonts -File -ErrorAction SilentlyContinue)) {
        if ($f.Extension -notmatch '^\.(ttf|otf|ttc|otc|fon|fnt|pfb|pfm)$') { continue }
        $owner = $null
        try { $owner = (Get-Acl -LiteralPath $f.FullName -ErrorAction Stop).GetOwner([System.Security.Principal.SecurityIdentifier]).Value } catch { $owner = $null }
        if ($owner -eq $TrustedInstallerSid) { continue }
        $names = $fontNamesByFile[$f.FullName.ToLowerInvariant()]
        [void]$FontsNonDefault.Add([ordered]@{ location = 'system'; file = $f.FullName; names = $names; bytes = $f.Length; installedByPackage = $(if ($owner) { "owner $owner" } else { 'owner unknown' }) })
    }
    if ($env:LOCALAPPDATA) {
        foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts') -File -ErrorAction SilentlyContinue)) {
            $names = $fontNamesByFile[$f.FullName.ToLowerInvariant()]
            [void]$FontsNonDefault.Add([ordered]@{ location = 'user'; file = $f.FullName; names = $names; bytes = $f.Length; installedByPackage = $null })
        }
    }
}
Write-Note ("{0} non-default font file(s)" -f $FontsNonDefault.Count)

# ---------------------------------------------------------------------------
# 8. Read ProPresenter documents: fonts in slide text, media references
# ---------------------------------------------------------------------------
Write-Step '8/8 Reading ProPresenter documents (fonts and media references)'
function Read-AllBytesShared([string]$Path) {
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
    try {
        $buf = New-Object byte[] $fs.Length
        $off = 0
        while ($off -lt $buf.Length) { $n = $fs.Read($buf, $off, $buf.Length - $off); if ($n -le 0) { break }; $off += $n }
        return , $buf
    } finally { $fs.Dispose() }
}
function Get-XmlText([byte[]]$Bytes) {
    $start = 0
    if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) { $start = 3 }
    return [System.Text.Encoding]::UTF8.GetString($Bytes, $start, $Bytes.Length - $start)
}
$Fallback = New-Object System.Collections.ArrayList
function Invoke-Scan([byte[]]$Bytes, [string]$File, [string]$Kind) {
    if ($HaveHelper) {
        if ($Kind -eq 'xml') { [DrashtiAudit.Analyzer]::ScanXml((Get-XmlText $Bytes), $File) } else { [DrashtiAudit.Analyzer]::ScanBinary($Bytes, $File) }
        return
    }
    $latin = [System.Text.Encoding]::GetEncoding(28591).GetString($Bytes)
    $texts = @()
    if ($Kind -eq 'xml') {
        foreach ($m in [regex]::Matches($latin, 'RTFData(?:">|=")([A-Za-z0-9+/=\s]+)')) { try { $texts += [System.Text.Encoding]::GetEncoding(28591).GetString([Convert]::FromBase64String($m.Groups[1].Value)) } catch { } }
    } else { $texts = @($latin) }
    foreach ($t in $texts) {
        foreach ($m in [regex]::Matches($t, '\\f\d+(?:\\[a-z]+-?\d* ?)*\s*([^;{}\\]+);')) { [void]$Fallback.Add(@('FONT', $m.Groups[1].Value.Trim(), $File, '', '', '', '', 'rtf (approx)')) }
    }
    foreach ($m in [regex]::Matches($latin, 'file://[A-Za-z0-9\-._~:/?#\[\]@!$&''()*+,;=%]+')) { [void]$Fallback.Add(@('MEDIA', [Uri]::UnescapeDataString(($m.Value -replace '^file:///?', '')), $File, 'approx')) }
    [void]$Fallback.Add(@('STAT', $File, $Kind, '', '', '', '', ''))
}
if ($HaveHelper) { [DrashtiAudit.Analyzer]::Reset() }
$Candidates2 = @($AllFiles | Where-Object { ($_[3] -eq '(none)' -or ($_[3] -notmatch $MediaExtRe -and $_[3] -notmatch $SkipExtRe)) })
$total = $Candidates2.Count
Write-Note "$total file(s) to read"
$n = 0
foreach ($entry in $Candidates2) {
    $n++
    if ($n % 250 -eq 0) { Write-Note "... $n / $total" }
    $file = $entry[1]
    if ($entry[2] -gt 52428800) { Add-AuditError 'documents' "Skipped (over 50 MB): $file"; continue }
    try { $data = Read-AllBytesShared $file } catch { Add-AuditError 'documents' ("Could not read ${file}: " + $_.Exception.Message); continue }
    if ($data.Length -lt 2) { continue }
    if ($data[0] -eq 0x50 -and $data[1] -eq 0x4B) {
        try {
            $ms = New-Object System.IO.MemoryStream(, $data)
            $zip = New-Object System.IO.Compression.ZipArchive($ms, [System.IO.Compression.ZipArchiveMode]::Read)
            foreach ($ze in $zip.Entries) {
                $kind = $null
                if ($ze.Name -match '\.(pro6|pro5|pro4|pro6pl)$') { $kind = 'xml' } elseif ($ze.Name -match '\.pro$') { $kind = 'binary' }
                if (-not $kind -or $ze.Length -gt 52428800) { continue }
                $zs = $ze.Open()
                try { $mem = New-Object System.IO.MemoryStream; $zs.CopyTo($mem); Invoke-Scan $mem.ToArray() $file $kind } finally { $zs.Dispose() }
            }
            $zip.Dispose()
        } catch { Add-AuditError 'documents' ("Could not open bundle ${file}: " + $_.Exception.Message) }
        continue
    }
    $isXml = ($data[0] -eq 0x3C) -or ($data.Length -ge 4 -and $data[0] -eq 0xEF -and $data[1] -eq 0xBB -and $data[2] -eq 0xBF -and $data[3] -eq 0x3C)
    try { Invoke-Scan $data $file $(if ($isXml) { 'xml' } else { 'binary' }) } catch { Add-AuditError 'documents' ("Could not read ${file}: " + $_.Exception.Message) }
}
$Records = New-Object System.Collections.ArrayList
if ($HaveHelper) { foreach ($r in [DrashtiAudit.Analyzer]::Records) { [void]$Records.Add($r) } }
foreach ($r in $Fallback) { [void]$Records.Add($r) }

# Document totals
$DocTotals = [ordered]@{ filesRead = 0; presentations = 0; playlists = 0; themesAndTemplates = 0; configuration = 0; bundles = 0; otherFiles = 0; xmlFiles = 0; protobufFiles = 0; slidesPP6 = 0; groupsPP6 = 0; textElements = 0; playlistNodesPP6 = 0; mediaCuesPP6 = 0 }
function ToInt([string]$s) { $v = 0; [void][int]::TryParse($s, [ref]$v); return $v }
foreach ($r in $Records) {
    if ($r[0] -ne 'STAT') { continue }
    $DocTotals.filesRead++
    $l = $r[1].ToLowerInvariant().Replace('\', '/')
    if ($l -match '\.(pro6x|pro6plx|probundle|proplaylist)$') { $DocTotals.bundles++ }
    elseif ($l -match 'template|/themes/') { $DocTotals.themesAndTemplates++ }
    elseif ($l -match 'playlist|\.pro6pl$') { $DocTotals.playlists++ }
    elseif ($l -match '/configuration/|stagedisplay|messages|clocks|props\.pro6|mask\.pro6|/preferences/') { $DocTotals.configuration++ }
    elseif ($l -match '\.(pro6|pro5|pro4|pro)$') { $DocTotals.presentations++ }
    else { $DocTotals.otherFiles++ }
    if ($r[2] -eq 'xml') { $DocTotals.xmlFiles++ } else { $DocTotals.protobufFiles++ }
    $DocTotals.slidesPP6 += (ToInt $r[3]); $DocTotals.groupsPP6 += (ToInt $r[4]); $DocTotals.textElements += (ToInt $r[5])
    $DocTotals.playlistNodesPP6 += (ToInt $r[6]); $DocTotals.mediaCuesPP6 += (ToInt $r[7])
}

# Fonts used in slide text
$nondefNames = @{}
foreach ($f in $FontsNonDefault) {
    if ($f.names) { foreach ($part in ([string]$f.names -split '\s*&\s*')) { $nondefNames[$part.ToLowerInvariant()] = $true } }
    $nondefNames[[System.IO.Path]::GetFileNameWithoutExtension($f.file).ToLowerInvariant()] = $true
}
$FontAgg = [ordered]@{}
$DeclOnly = [ordered]@{}
foreach ($r in $Records) {
    if ($r[0] -eq 'FONT') {
        $k = $r[1].ToLowerInvariant()
        if (-not $FontAgg.Contains($k)) { $FontAgg[$k] = [ordered]@{ name = $r[1]; n = 0; files = @{}; la = 0; gu = 0; hi = 0; ot = 0; enc = New-Object System.Collections.ArrayList; used = New-Object System.Collections.ArrayList } }
        $a = $FontAgg[$k]
        $a.n++; $a.files[$r[2]] = $true
        $a.la += (ToInt $r[3]); $a.gu += (ToInt $r[4]); $a.hi += (ToInt $r[5]); $a.ot += (ToInt $r[6])
        if (-not ($a.enc -contains $r[7])) { [void]$a.enc.Add($r[7]) }
        $u = Get-UsedIn $r[2]
        if (-not ($a.used -contains $u)) { [void]$a.used.Add($u) }
    } elseif ($r[0] -eq 'FONTDECL') {
        $DeclOnly[$r[1].ToLowerInvariant()] = $r[1]
    }
}
$FontsUsed = New-Object System.Collections.ArrayList
foreach ($k in $FontAgg.Keys) {
    $a = $FontAgg[$k]
    $base = $k -replace '[- ](bold|italic|regular|light|medium|semibold|black|heavy|oblique|bolditalic|bold italic)$', ''
    if ($nondefNames.ContainsKey($k) -or $nondefNames.ContainsKey($base)) { $inst = 'added font' }
    elseif ($InstalledNames.ContainsKey($k) -or $InstalledNames.ContainsKey($base)) { $inst = 'yes' }
    elseif ($InstalledNames.Count -gt 0) { $inst = 'NO' } else { $inst = 'unknown' }
    if ($a.gu -gt 0 -or $a.hi -gt 0) {
        $parts = @()
        if ($a.gu -gt 0) { $parts += 'Gujarati (Unicode)' }
        if ($a.hi -gt 0) { $parts += 'Devanagari (Unicode)' }
        $script = $parts -join ' + '
    } elseif ($a.la + $a.ot -gt 0) { $script = 'Latin/other bytes only' } else { $script = 'not counted' }
    [void]$FontsUsed.Add([ordered]@{
        name = $a.name; textElements = $a.n; files = $a.files.Count; latinLetters = $a.la; gujaratiChars = $a.gu; devanagariChars = $a.hi; otherChars = $a.ot
        scriptSeen = $script; installed = $inst; knownLegacyFont = [bool]($k -match $LegacyFontRe); encodings = ($a.enc -join ','); usedIn = ($a.used -join ', ')
    })
}
$FontsUsed = @($FontsUsed | Sort-Object { $_.textElements } -Descending)
$FontsDeclared = New-Object System.Collections.ArrayList
foreach ($k in $DeclOnly.Keys) { if (-not $FontAgg.Contains($k)) { [void]$FontsDeclared.Add([ordered]@{ name = $DeclOnly[$k] }) } }

# Media and document references, with existence checks
function Get-RefList([string]$Tag) {
    $agg = [ordered]@{}
    foreach ($r in $Records) {
        if ($r[0] -ne $Tag -or -not $r[1]) { continue }
        $k = $r[1]
        if (-not $agg.Contains($k)) { $agg[$k] = [ordered]@{ path = $k; exists = $false; problem = $null; references = 0; firstReferencedBy = $r[2]; approximate = $(if ($r[3]) { $r[3] } else { $null }) } }
        $agg[$k].references++
    }
    $out = New-Object System.Collections.ArrayList
    foreach ($k in $agg.Keys) {
        $e = $agg[$k]
        $p = $e.path
        $exists = $false
        try { $exists = Test-Path -LiteralPath $p } catch { $exists = $false }
        if ($exists) { $e.exists = $true }
        elseif ($p -match '^(/|~)') { $e.problem = 'Mac path' }
        elseif ($p -match '^([A-Za-z]):' -and -not (Test-Path -LiteralPath ($Matches[1] + ':\'))) { $e.problem = "drive not connected: $($Matches[1]):" }
        else { $e.problem = 'missing' }
        [void]$out.Add($e)
    }
    return , @($out | Sort-Object { [int]$_.exists }, { $_.path })
}
$MediaRefs = Get-RefList 'MEDIA'
$DocRefs = Get-RefList 'DOC'
Write-Note ("{0} font(s) in slide text, {1} media reference(s), {2} missing" -f $FontsUsed.Count, $MediaRefs.Count, @($MediaRefs | Where-Object { -not $_.exists }).Count)

# ---------------------------------------------------------------------------
# Collect (optional): COPY data folders and fonts to the destination
# ---------------------------------------------------------------------------
$CollectStatus = 'not requested'
$CollectDir = $null
$CollectItems = New-Object System.Collections.ArrayList
function Copy-Tree([string]$Src, [string]$Dst) {
    $robo = Get-Command robocopy.exe -ErrorAction SilentlyContinue
    if ($robo) {
        $args2 = @($Src, $Dst, '/E', '/COPY:DT', '/DCOPY:T', '/R:1', '/W:1', '/XJ', '/NP', '/NFL', '/NDL', '/NJH', '/NJS')
        if ($NoMedia) { $args2 += '/XF'; $args2 += ($MediaExtRe.Trim('^', '$', '(', ')').Split('|') | ForEach-Object { "*.$_" }) }
        & $robo.Source @args2 | Out-Null
        if ($LASTEXITCODE -ge 8) { Add-AuditError 'collect' "robocopy reported errors copying $Src (exit $LASTEXITCODE)" }
        return
    }
    foreach ($f in @(Get-ChildItem -LiteralPath $Src -File -Recurse -Force -ErrorAction SilentlyContinue)) {
        $ext = $f.Extension.TrimStart('.').ToLowerInvariant()
        if ($NoMedia -and $ext -match $MediaExtRe) { continue }
        $rel = $f.FullName.Substring($Src.Length).TrimStart('\', '/')
        $target = Join-Path $Dst $rel
        $parent = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -LiteralPath $f.FullName -Destination $target -ErrorAction SilentlyContinue
    }
}
function Get-MirrorPath([string]$Base, [string]$Path) {
    $rel = $Path -replace '^([A-Za-z]):', '$1' -replace '^[\\/]+', ''
    return (Join-Path $Base $rel)
}
if ($Collect) {
    Write-Step "Collect: copying ProPresenter data and fonts to $Collect"
    $CollectDir = Join-Path $Collect ($SafeName + '_' + $Stamp + '-collect')
    $refuse = $false
    foreach ($loc in $Locations) {
        $lp = $loc.path.TrimEnd('\', '/').ToLowerInvariant()
        if ($CollectDir.ToLowerInvariant().StartsWith($lp + '\') -or $CollectDir.ToLowerInvariant().StartsWith($lp + '/')) { $refuse = $true; Add-AuditError 'collect' "The destination is inside $($loc.path). Choose another destination." }
    }
    $need = [int64]0
    foreach ($e in $AllFiles) { if (-not ($NoMedia -and $e[3] -match $MediaExtRe)) { $need += $e[2] } }
    foreach ($f in $FontsNonDefault) { $need += [int64]$f.bytes }
    $free = $null
    try { $free = (New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($Collect))).AvailableFreeSpace } catch { $free = $null }
    Write-Note ("About {0} to copy; {1} free on the destination." -f (Format-Bytes $need), $(if ($null -ne $free) { Format-Bytes $free } else { 'unknown' }))
    if ($refuse) { $CollectStatus = 'refused' }
    elseif ($null -ne $free -and ($need * 1.05 + 104857600) -gt $free) {
        Add-AuditError 'collect' ("Not enough free space on {0} (need about {1}, free {2}). Try -NoMedia or a bigger drive." -f $Collect, (Format-Bytes $need), (Format-Bytes $free))
        $CollectStatus = 'not enough space'
    } else {
        New-Item -ItemType Directory -Path (Join-Path $CollectDir 'data') -Force | Out-Null
        foreach ($loc in $Locations) {
            $dst = Get-MirrorPath (Join-Path $CollectDir 'data') $loc.path
            if (Test-Path -LiteralPath $loc.path -PathType Container) {
                New-Item -ItemType Directory -Path $dst -Force | Out-Null
                Copy-Tree $loc.path $dst
                $srcCount = @($AllFiles | Where-Object { $_[0] -eq $loc.path }).Count
                $dstCount = @(Get-ChildItem -LiteralPath $dst -File -Recurse -Force -ErrorAction SilentlyContinue).Count
                [void]$CollectItems.Add([ordered]@{ source = $loc.path; copy = $dst; sourceFiles = $srcCount; copiedFiles = $dstCount })
            } elseif (Test-Path -LiteralPath $loc.path -PathType Leaf) {
                New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
                Copy-Item -LiteralPath $loc.path -Destination $dst -ErrorAction SilentlyContinue
                [void]$CollectItems.Add([ordered]@{ source = $loc.path; copy = $dst; sourceFiles = 1; copiedFiles = $(if (Test-Path -LiteralPath $dst) { 1 } else { 0 }) })
            }
        }
        if ($FontsNonDefault.Count -gt 0) {
            foreach ($f in $FontsNonDefault) {
                $fd = Join-Path (Join-Path $CollectDir 'fonts') $f.location
                New-Item -ItemType Directory -Path $fd -Force | Out-Null
                $dst = Join-Path $fd ([System.IO.Path]::GetFileName($f.file))
                Copy-Item -LiteralPath $f.file -Destination $dst -ErrorAction SilentlyContinue
                [void]$CollectItems.Add([ordered]@{ source = $f.file; copy = $dst; sourceFiles = 1; copiedFiles = $(if (Test-Path -LiteralPath $dst) { 1 } else { 0 }) })
            }
        }
        if ($OnWindows) {
            $regDir = Join-Path $CollectDir 'registry'
            foreach ($rk in @('HKCU\Software\Renewed Vision', 'HKLM\SOFTWARE\Renewed Vision', 'HKLM\SOFTWARE\WOW6432Node\Renewed Vision')) {
                if (Test-Path -LiteralPath ('Registry::' + ($rk -replace '^HKCU', 'HKEY_CURRENT_USER' -replace '^HKLM', 'HKEY_LOCAL_MACHINE'))) {
                    New-Item -ItemType Directory -Path $regDir -Force | Out-Null
                    $regFile = Join-Path $regDir (($rk -replace '[\\ ]', '_') + '.reg')
                    & reg.exe export $rk $regFile /y | Out-Null
                }
            }
        }
        $readme = @(
            "Drashti audit: collected copies from $MachineName ($Stamp)",
            '',
            'These are COPIES of ProPresenter data and fonts. Nothing was moved or changed',
            'on the source PC.',
            '',
            'Treat this drive as sensitive. The copies can still contain secrets: licence',
            'or registration details, stream keys, passwords and personal data inside',
            "ProPresenter's settings, registry exports and documents. The audit report",
            'redacts those; these raw copies do not.',
            '',
            'On the Drashti development Mac, put this folder in migration-samples/ at the',
            'workspace root, which is outside the app/ git repository, and never commit it.',
            'data\      mirrors the original paths (drive letter first).',
            'fonts\     holds font files that are not part of Windows.',
            'registry\  holds exports of the ProPresenter registry keys.'
        ) -join "`r`n"
        [System.IO.File]::WriteAllText((Join-Path $CollectDir 'READ-ME-FIRST.txt'), $readme, (New-Object System.Text.UTF8Encoding $false))
        $CollectStatus = 'done'
        Write-Note ("Copied {0} item(s) to {1}" -f $CollectItems.Count, $CollectDir)
    }
}

# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
Write-Step 'Writing the report'
$Report = [ordered]@{
    schema         = $Schema
    tool           = [ordered]@{ name = 'audit-windows.ps1'; version = $ScriptVersion }
    platform       = 'windows'
    generatedAt    = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', $Inv)
    options        = [ordered]@{ collect = $(if ($Collect) { $Collect } else { $null }); noMedia = [bool]$NoMedia; skipSystem = [bool]$SkipSystem; noDefaultLocations = [bool]$NoDefaultLocations; searchRoots = @($SearchRoot | Where-Object { $_ }); helper = $HaveHelper }
    machine        = $Machine
    gpus           = @($Gpus)
    drashti        = $Needs
    displays       = @($Monitors)
    activeScreens  = @($Screens)
    audioDevices   = @($Audio)
    devices        = @($Devices)
    drivers        = @($Drivers)
    relatedSoftware = @($Software)
    propresenter   = [ordered]@{
        installs               = @($PpInstalls)
        running                = @($Running | ForEach-Object { [ordered]@{ process = $_ } })
        preferenceFiles        = @($PrefFiles | ForEach-Object { [ordered]@{ path = $_ } })
        preferences            = @($Prefs)
        preferencePaths        = @($PrefPathsChecked)
        locations              = @($LocStats)
        locationSubfolders     = @($LocSubs)
        filesByExtension       = @($ExtStats)
        documents              = $DocTotals
        fontsUsedInSlideText   = @($FontsUsed)
        fontsDeclaredButUnused = @($FontsDeclared)
        mediaReferences        = @($MediaRefs)
        documentReferences     = @($DocRefs)
    }
    fontsBeyondDefaults = @($FontsNonDefault)
    collect        = [ordered]@{ status = $CollectStatus; folder = $CollectDir; items = @($CollectItems) }
    errors         = @($script:Errors)
}
$utf8 = New-Object System.Text.UTF8Encoding $false
$json = ConvertTo-Json -InputObject $Report -Depth 12
[System.IO.File]::WriteAllText((Join-Path $ReportDir 'audit.json'), $json, $utf8)

function Format-Cell($Value) {
    if ($null -eq $Value) { return '' }
    if ($Value -is [bool]) { if ($Value) { return 'yes' } else { return 'no' } }
    if ($Value -is [double]) { return $Value.ToString($Inv) }
    return (([string]$Value) -replace '[\r\n\t]+', ' ') -replace '\|', '\|'
}
function Add-Table([System.Text.StringBuilder]$Sb, $Rows, [string[]]$Headers, [string[]]$Props, [int]$Max = 0) {
    $arr = @($Rows)
    if ($arr.Count -eq 0) { [void]$Sb.AppendLine('_None found._'); return }
    [void]$Sb.AppendLine('| ' + ($Headers -join ' | ') + ' |')
    [void]$Sb.AppendLine('|' + ((@($Headers) | ForEach-Object { ' --- ' }) -join '|') + '|')
    $i = 0
    foreach ($r in $arr) {
        if ($Max -gt 0 -and $i -ge $Max) { break }
        $cells = foreach ($p in $Props) { Format-Cell $r[$p] }
        [void]$Sb.AppendLine('| ' + (@($cells) -join ' | ') + ' |')
        $i++
    }
    if ($Max -gt 0 -and $arr.Count -gt $Max) { [void]$Sb.AppendLine(''); [void]$Sb.AppendLine("_...and $($arr.Count - $Max) more rows (see audit.json)._") }
}
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("# Drashti audit: $MachineName")
[void]$sb.AppendLine('')
[void]$sb.AppendLine("Generated $(Get-Date -Format 'yyyy-MM-dd HH:mm') by audit-windows.ps1 $ScriptVersion. This audit is read-only: nothing on this PC was changed. Licence keys, stream keys, passwords and e-mail addresses are redacted.")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Summary')
[void]$sb.AppendLine('')
[void]$sb.AppendLine("- **Windows:** $($Machine.osName) $($Machine.osDisplayVersion) (build $($Machine.osBuild).$($Machine.osUpdateRevision)), $($Machine.osArchitecture)")
[void]$sb.AppendLine("- **Hardware:** $($Machine.manufacturer) $($Machine.model), $($Machine.cpu), $(if ($Machine.memoryBytes) { Format-Bytes $Machine.memoryBytes } else { '?' }) RAM")
if ($Machine.Contains('electron44Supported')) {
    if ($Machine.electron44Supported) { [void]$sb.AppendLine('- **Drashti (Electron 44) support:** yes, 64-bit Windows 10 or later') }
    else { [void]$sb.AppendLine('- **Drashti (Electron 44) support:** NO. Electron 44 needs 64-bit Windows 10 or later. See the README for options.') }
}
if ($OnWindows -and -not $SkipSystem) {
    if ($Needs.basicDisplayOnly) { [void]$sb.AppendLine("- **Graphics for video:** NO graphics chip driver ($($Needs.graphics)). Drashti needs a graphics chip that decodes video: see the admin guide, section 1.") }
    elseif ($Needs.graphics) { [void]$sb.AppendLine("- **Graphics for video:** $($Needs.graphics); the stream's encoder would be $(if ($Needs.streamEncoders) { $Needs.streamEncoders } else { 'x264, on the processor (no graphics encoder found)' }). The performance check's video cases tell for sure.") }
    else { [void]$sb.AppendLine('- **Graphics for video:** none found') }
    if ($Needs.powerPointAutomation) { [void]$sb.AppendLine('- **Decks as pictures:** yes, PowerPoint is here (Drashti asks it to save each deck as PDF)') }
    else { [void]$sb.AppendLine('- **Decks as pictures:** no PowerPoint here: PowerPoint files must be saved as PDF first') }
}
[void]$sb.AppendLine("- **Screens:** $($Screens.Count) active")
if ($PpInstalls.Count -gt 0) { [void]$sb.AppendLine("- **ProPresenter:** " + ((@($PpInstalls) | ForEach-Object { "$($_.name) $($_.version)" } | Select-Object -Unique) -join '; ')) }
else { [void]$sb.AppendLine('- **ProPresenter:** no install found') }
[void]$sb.AppendLine("- **ProPresenter files read:** $($DocTotals.filesRead) ($($DocTotals.presentations) presentations, $($DocTotals.playlists) playlists, $($DocTotals.themesAndTemplates) themes/templates, $($DocTotals.textElements) text elements)")
[void]$sb.AppendLine("- **Fonts in slide text:** $($FontsUsed.Count) ($(@($FontsUsed | Where-Object { $_.knownLegacyFont }).Count) known legacy non-Unicode, $(@($FontsUsed | Where-Object { $_.installed -eq 'NO' }).Count) not installed)")
[void]$sb.AppendLine("- **Media referenced:** $($MediaRefs.Count) ($(@($MediaRefs | Where-Object { -not $_.exists }).Count) missing)")
[void]$sb.AppendLine("- **Problems during the audit:** $($script:Errors.Count)")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Machine')
[void]$sb.AppendLine('')
Add-Table $sb @($Machine.Keys | ForEach-Object { [ordered]@{ item = $_; value = $Machine[$_] } }) @('Item', 'Value') @('item', 'value')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## GPUs')
[void]$sb.AppendLine('')
Add-Table $sb $Gpus @('GPU', 'Vendor', 'Memory', 'Driver', 'Driver date', 'Current mode') @('name', 'vendor', 'vramBytes', 'driverVersion', 'driverDate', 'currentMode')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Displays')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('Active screens and their current modes (positions in physical pixels):')
[void]$sb.AppendLine('')
Add-Table $sb $Screens @('Screen', 'Monitor', 'Connection', 'Width', 'Height', 'Refresh Hz', 'X', 'Y', 'Scale', 'Primary', 'Mirrored', 'Rotation', 'Signal', 'Adapter') @('displayId', 'name', 'connection', 'pixelWidth', 'pixelHeight', 'refreshHz', 'x', 'y', 'scaleFactor', 'main', 'mirrored', 'rotation', 'signalWidth', 'adapter')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('Monitors Windows knows about:')
[void]$sb.AppendLine('')
Add-Table $sb $Monitors @('Name', 'Maker code', 'Year', 'Active') @('name', 'manufacturerCode', 'yearOfManufacture', 'active')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Audio devices')
[void]$sb.AppendLine('')
Add-Table $sb $Audio @('Device', 'Direction', 'State', 'Probable default') @('name', 'direction', 'state', 'probableDefault')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Capture, SDI, MIDI and Stream Deck devices')
[void]$sb.AppendLine('')
Add-Table $sb @($Devices | Where-Object { $_.category -ne 'monitor' }) @('Category', 'Name', 'Vendor', 'Device ID', 'Source') @('category', 'name', 'vendor', 'product', 'source')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('Drivers (ASIO and MIDI):')
[void]$sb.AppendLine('')
Add-Table $sb $Drivers @('Category', 'Name', 'Source') @('category', 'name', 'source')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Related software')
[void]$sb.AppendLine('')
Add-Table $sb $Software @('Program', 'Version', 'Publisher', 'Location') @('name', 'version', 'publisher', 'path')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## ProPresenter')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('### Installs')
[void]$sb.AppendLine('')
Add-Table $sb $PpInstalls @('Name', 'Version', 'File version', 'Path', 'Found via') @('name', 'version', 'build', 'path', 'source')
if ($Running.Count -gt 0) { [void]$sb.AppendLine(''); [void]$sb.AppendLine("Running during the audit: $($Running -join ', ')") }
[void]$sb.AppendLine('')
[void]$sb.AppendLine('### Paths named in ProPresenter settings')
[void]$sb.AppendLine('')
Add-Table $sb $PrefPathsChecked @('Setting', 'Path', 'Exists', 'Type') @('key', 'path', 'exists', 'type')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('### Settings about outputs, audio, media and libraries (redacted)')
[void]$sb.AppendLine('')
Add-Table $sb @($Prefs | Where-Object { $_.key -match 'output|display|screen|stage|audio|sound|device|resolution|librar|media|playlist|theme|template|folder|path|director|shortcut|hotkey|keyboard|midi|remote|network|port|sdi|decklink|ndi|mask|edge|font|video|live|record|stream|support' }) @('Setting', 'Type', 'Value') @('key', 'type', 'value') 400
[void]$sb.AppendLine('')
[void]$sb.AppendLine('Every setting value (redacted) is in audit.json.')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('### Data locations')
[void]$sb.AppendLine('')
Add-Table $sb @($LocStats | ForEach-Object { [ordered]@{ kind = $_.kind; path = $_.path; files = $_.fileCount; size = (Format-Bytes $_.bytes); media = $_.mediaFileCount; via = $_.foundVia } }) @('Kind', 'Path', 'Files', 'Size', 'Media files', 'Found via') @('kind', 'path', 'files', 'size', 'media', 'via')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('Sub-folders:')
[void]$sb.AppendLine('')
Add-Table $sb @($LocSubs | ForEach-Object { [ordered]@{ location = $_.location; subfolder = $_.subfolder; files = $_.fileCount; size = (Format-Bytes $_.bytes) } }) @('Location', 'Sub-folder', 'Files', 'Size') @('location', 'subfolder', 'files', 'size') 300
[void]$sb.AppendLine('')
[void]$sb.AppendLine('### Files by type')
[void]$sb.AppendLine('')
Add-Table $sb @($ExtStats | ForEach-Object { [ordered]@{ ext = $_.extension; files = $_.fileCount; size = (Format-Bytes $_.bytes) } }) @('Extension', 'Files', 'Size') @('ext', 'files', 'size') 60
[void]$sb.AppendLine('')
[void]$sb.AppendLine('### Documents')
[void]$sb.AppendLine('')
Add-Table $sb @($DocTotals.Keys | ForEach-Object { [ordered]@{ item = $_; count = $DocTotals[$_] } }) @('Item', 'Count') @('item', 'count')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('### Fonts used in slide text')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('Counts come from the RTF inside each text element. "Gujarati (Unicode)" or "Devanagari (Unicode)" means real Unicode text was seen in that font. A Gujarati or Hindi font with "Latin/other bytes only" is probably a legacy (non-Unicode) font that the importer must convert.')
[void]$sb.AppendLine('')
Add-Table $sb $FontsUsed @('Font', 'Text elements', 'Files', 'Used in', 'Latin letters', 'Gujarati chars', 'Devanagari chars', 'Other chars', 'Script seen', 'Installed', 'Known legacy font') @('name', 'textElements', 'files', 'usedIn', 'latinLetters', 'gujaratiChars', 'devanagariChars', 'otherChars', 'scriptSeen', 'installed', 'knownLegacyFont')
if ($FontsDeclared.Count -gt 0) { [void]$sb.AppendLine(''); [void]$sb.AppendLine('Declared in font tables but with no text: ' + ((@($FontsDeclared) | ForEach-Object { $_.name }) -join ', ')) }
[void]$sb.AppendLine('')
[void]$sb.AppendLine('### Media referenced by ProPresenter documents')
[void]$sb.AppendLine('')
$missing = @($MediaRefs | Where-Object { -not $_.exists })
$refTotal = 0
foreach ($m in $MediaRefs) { $refTotal += [int]$m.references }
[void]$sb.AppendLine("$refTotal references to $($MediaRefs.Count) files; $($missing.Count) missing.")
[void]$sb.AppendLine('')
[void]$sb.AppendLine('Missing files:')
[void]$sb.AppendLine('')
Add-Table $sb $missing @('Path', 'Problem', 'References', 'First referenced by') @('path', 'problem', 'references', 'firstReferencedBy') 300
[void]$sb.AppendLine('')
[void]$sb.AppendLine('### Presentations referenced by playlists')
[void]$sb.AppendLine('')
$dmissing = @($DocRefs | Where-Object { -not $_.exists })
[void]$sb.AppendLine("$($DocRefs.Count) referenced; $($dmissing.Count) missing.")
[void]$sb.AppendLine('')
Add-Table $sb $dmissing @('Missing path', 'Problem', 'References', 'First referenced by') @('path', 'problem', 'references', 'firstReferencedBy') 200
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Fonts installed beyond the Windows defaults')
[void]$sb.AppendLine('')
Add-Table $sb $FontsNonDefault @('Where', 'File', 'Font names', 'Bytes', 'Owner') @('location', 'file', 'names', 'bytes', 'installedByPackage')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Collect')
[void]$sb.AppendLine('')
[void]$sb.AppendLine("Status: $CollectStatus")
if ($CollectItems.Count -gt 0) {
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine("Folder: ``$CollectDir``")
    [void]$sb.AppendLine('')
    Add-Table $sb $CollectItems @('Source', 'Copy', 'Source files', 'Copied files') @('source', 'copy', 'sourceFiles', 'copiedFiles')
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('**Treat the collected copies as sensitive.** They are raw copies and can still contain licence details, stream keys and passwords.')
}
[void]$sb.AppendLine('')
[void]$sb.AppendLine('## Problems during the audit')
[void]$sb.AppendLine('')
Add-Table $sb $script:Errors @('Section', 'Message') @('section', 'message')
[void]$sb.AppendLine('')
[void]$sb.AppendLine('---')
[void]$sb.AppendLine('Next: fill in SETUP-CHECKLIST.md and send this folder (audit-report.md and audit.json) to the Drashti developer.')
[System.IO.File]::WriteAllText((Join-Path $ReportDir 'audit-report.md'), $sb.ToString(), $utf8)

if ($CollectDir -and (Test-Path -LiteralPath $CollectDir)) {
    $auditCopy = Join-Path (Join-Path $CollectDir 'audit') (Split-Path -Leaf $ReportDir)
    New-Item -ItemType Directory -Path $auditCopy -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $ReportDir 'audit.json') -Destination $auditCopy
    Copy-Item -LiteralPath (Join-Path $ReportDir 'audit-report.md') -Destination $auditCopy
}

Write-Host ''
Write-Host ("Done in {0}s." -f [int]((Get-Date) - $T0).TotalSeconds)
Write-Host "Report: $(Join-Path $ReportDir 'audit-report.md')"
Write-Host "Data:   $(Join-Path $ReportDir 'audit.json')"
if ($CollectDir) { Write-Host "Copies: $CollectDir (treat as sensitive)" }
exit 0
