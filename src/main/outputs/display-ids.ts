import { execFile } from 'node:child_process';
import { z } from 'zod';
import type { DisplayInfo } from '../../shared/screens';
import { powershellEnv, powershellPath } from '../system/powershell';

/*
 * Each display's own identity (Session 55: "remembered by the display itself"), so a display goes straight back to
 * its job when it is plugged in again, into another port, or after a restart, and two projectors of one model are
 * told apart. The key is what the display says of itself in its EDID: its maker, its model and its serial number
 * ("edid:<maker>:<model>:n<serial>", or ":s<serial text>" when its numeric serial says nothing). Electron's own ids
 * follow the port on Windows and the connection on a Mac, and a display's name is its model's: neither holds.
 *
 * Read off the main thread, by a child process, never delaying the start: on a Mac, system_profiler's display list
 * (each display's CGDirectDisplayID, which is Electron's id there, with its EDID maker, model and serial number); on
 * Windows, a short PowerShell script asking the display configuration which monitor is on which desktop output, and
 * reading each monitor's EDID from the registry (both readable without being an administrator), tied to Electron's
 * displays by their place on the desktop and their size. A display with no serial number that tells it apart (some
 * cheap projectors give none, or the same one for every unit) has no key, and is found as before Session 55 (its id,
 * name, size and place: shared/display-match.ts). Mirroring shows here too: one output feeding two displays.
 */

// ---- a display's EDID ----------------------------------------------------------------------------------------

/** What a display's EDID says of who it is. */
export interface Edid {
  /** Its maker's code, in hex (Dell's is 10ac, Apple's 610); '' when not known. */
  vendor: string;
  /** Its model's code, in hex. */
  product: string;
  /** Its serial number as a number (bytes 12 to 15), in hex; '' when none. */
  serial: string;
  /** Its serial number as text (the descriptor 0xff), '' when none. */
  serialText: string;
  /** Its model's name (the descriptor 0xfc), '' when none. */
  name: string;
}

const EDID_HEADER = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];

/** The first 128 bytes of an EDID, given in hex: null when they are not one. */
export function parseEdid(hex: string): Edid | null {
  const clean = hex.replace(/[^0-9a-f]/giu, '');
  if (clean.length < 256) return null;
  const at = (i: number) => parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  if (!EDID_HEADER.every((v, i) => at(i) === v)) return null;
  const serial = (at(12) | (at(13) << 8) | (at(14) << 16) | (at(15) << 24)) >>> 0;
  let serialText = '';
  let name = '';
  for (const start of [54, 72, 90, 108]) {
    if (at(start) !== 0 || at(start + 1) !== 0 || at(start + 2) !== 0) continue;
    let text = '';
    for (let i = start + 5; i < start + 18; i++) {
      const c = at(i);
      if (c === 0x0a || c === 0) break;
      if (c >= 0x20 && c < 0x7f) text += String.fromCharCode(c);
    }
    if (at(start + 3) === 0xff) serialText = text.trim();
    if (at(start + 3) === 0xfc) name = text.trim();
  }
  return {
    vendor: ((at(8) << 8) | at(9)).toString(16),
    product: (at(10) | (at(11) << 8)).toString(16),
    serial: serial === 0 ? '' : serial.toString(16),
    serialText,
    name,
  };
}

/** A code given in hex ("10AC", "0x10ac"), as plain lower-case hex; null when it is none. */
function hexOf(value: string): string | null {
  const m = /^(?:0x)?([0-9a-f]{1,8})$/iu.exec(value.trim());
  if (!m?.[1]) return null;
  return parseInt(m[1], 16).toString(16);
}

/** Numeric serials that tell no display apart: none, and the ones cheap displays all give. */
const NO_SERIAL = new Set(['0', '1', '1010101', 'ffffffff']);
/** Serials as text that tell no display apart. */
const NO_SERIAL_TEXT = new Set([
  'serial',
  'serialnumber',
  'serial number',
  'none',
  'n/a',
  'na',
  'unknown',
  'default',
  '0123456789',
  '123456789',
  '1234567890',
  '12345678',
]);

function serialTextOf(text: string): string | null {
  const t = text.trim();
  if (t.length < 3 || /^(.)\1*$/u.test(t) || NO_SERIAL_TEXT.has(t.toLowerCase())) return null;
  return t;
}

/**
 * The key a display is known by: its maker, model and serial number (the number when it says something, else the
 * text). Null when it gives no serial number that tells it apart: it is then found as before Session 55.
 */
export function hardwareKey(e: Edid): string | null {
  const vendor = hexOf(e.vendor);
  const product = hexOf(e.product);
  if (vendor === null || product === null) return null;
  const serial = hexOf(e.serial);
  if (serial !== null && !NO_SERIAL.has(serial)) return `edid:${vendor}:${product}:n${serial}`;
  const text = serialTextOf(e.serialText);
  return text === null ? null : `edid:${vendor}:${product}:s${text}`;
}

// ---- what a reading says ---------------------------------------------------------------------------------------

/** What a reading found: each of Electron's displays' identity, and whether the computer mirrors its screen. */
export interface DisplayReading {
  /** Each display's key, by Electron's id (only those that have one). */
  ids: Map<number, string>;
  /** The names of the displays the computer shows the same picture on (mirroring); none when it does not. */
  mirroredOnto: string[];
}

/** One display as a reading lists it. */
interface Found {
  /** Electron's id for it, as the reading may give it (several ways of reading the same text). */
  ids: number[];
  name: string;
  edid: Edid | null;
  mirrored: boolean;
  internal: boolean;
}

/** A display as Electron has it, as much as tying a reading to it needs. */
export type TieDisplay = Pick<
  DisplayInfo,
  'id' | 'label' | 'bounds' | 'pixelWidth' | 'pixelHeight' | 'primary'
>;

// ---- a Mac: system_profiler SPDisplaysDataType -json ------------------------------------------------------------

const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** A display id as system_profiler writes it: in decimal, and (when it could be) in hex too. */
function macIds(raw: string): number[] {
  const t = raw.trim();
  const out: number[] = [];
  if (/^\d+$/u.test(t)) out.push(Number(t));
  const hex = /^(?:0x)?([0-9a-f]+)$/iu.exec(t)?.[1];
  if (hex !== undefined) {
    const n = parseInt(hex, 16);
    if (Number.isSafeInteger(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

/** "spdisplays_on", "spdisplays_yes": said so. */
const said = (v: unknown) => /(?:^|_)(?:on|yes)$/iu.test(text(v));

/** Every display system_profiler lists, under every graphics chip. */
export function parseMacDisplays(raw: unknown): Found[] {
  const out: Found[] = [];
  const chips = (raw as { SPDisplaysDataType?: unknown } | null)?.SPDisplaysDataType;
  if (!Array.isArray(chips)) return out;
  for (const chip of chips) {
    const displays = (chip as { spdisplays_ndrvs?: unknown } | null)?.spdisplays_ndrvs;
    if (!Array.isArray(displays)) continue;
    for (const entry of displays) {
      if (typeof entry !== 'object' || entry === null) continue;
      const d = entry as Record<string, unknown>;
      // Its serial number as text, when the list gives it (any other field naming a serial number).
      const serialText =
        Object.entries(d)
          .filter(([k]) => /serial/iu.test(k) && k !== '_spdisplays_display-serial-number')
          .map(([, v]) => text(v).trim())
          .find((v) => v !== '') ?? '';
      const vendor = text(d['_spdisplays_display-vendor-id']);
      const product = text(d['_spdisplays_display-product-id']);
      out.push({
        ids: macIds(text(d['_spdisplays_displayID'])),
        name: text(d['_name']),
        edid:
          vendor !== '' && product !== ''
            ? { vendor, product, serial: text(d['_spdisplays_display-serial-number']), serialText, name: '' }
            : null,
        mirrored: said(d['spdisplays_mirror']),
        internal:
          /internal/iu.test(text(d['spdisplays_connection_type'])) ||
          /built-?in/iu.test(text(d['spdisplays_display_type'])),
      });
    }
  }
  return out;
}

/** Each listed display tied to Electron's by its id (it is Electron's on a Mac), else by a name only it has. */
export function tieMac(found: readonly Found[], displays: readonly TieDisplay[]): Map<number, Found> {
  const tied = new Map<number, Found>();
  const left: Found[] = [];
  for (const f of found) {
    const d = displays.find((x) => f.ids.includes(x.id) && !tied.has(x.id));
    if (d) tied.set(d.id, f);
    else left.push(f);
  }
  for (const f of left) {
    if (f.name === '' || left.filter((x) => x.name === f.name).length !== 1) continue;
    const named = displays.filter((x) => x.label === f.name && !tied.has(x.id));
    const d = named.length === 1 ? named[0] : undefined;
    if (d) tied.set(d.id, f);
  }
  return tied;
}

// ---- Windows: the display configuration, and each monitor's EDID in the registry --------------------------------

const winTarget = z.object({
  path: z.string().max(512),
  name: z.string().max(256),
  internal: z.boolean(),
  edid: z.string().max(4096),
});
const winOutput = z.object({
  gdi: z.string().max(64),
  primary: z.boolean(),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
  targets: z.array(winTarget).max(16),
});
const winReading = z.object({ outputs: z.array(winOutput).max(32) });

/** One of the desktop's outputs as Windows has it: where it is, in pixels, and the monitors it feeds. */
export type WinOutput = z.infer<typeof winOutput>;

/** What the script printed, checked: null when it is not what it prints. */
export function parseWindowsOutputs(said: string): WinOutput[] | null {
  try {
    const parsed = winReading.safeParse(JSON.parse(said.trim()));
    return parsed.success ? parsed.data.outputs : null;
  } catch {
    return null;
  }
}

/** Within two pixels: Electron's size times its scale, rounded. */
const near = (a: number, b: number) => Math.abs(a - b) <= 2;

/**
 * Windows' outputs tied to Electron's displays: the primary to the primary; the rest by their size, and where
 * several have one size, by their order across the desktop (left to right, then top to bottom), which Electron's
 * layout in its own units keeps. One that cannot be told is left untied.
 */
export function tieWindows(
  outputs: readonly WinOutput[],
  displays: readonly TieDisplay[],
): Map<number, WinOutput> {
  const tied = new Map<number, WinOutput>();
  const primary = displays.find((d) => d.primary);
  const primaryOut = outputs.find((o) => o.primary);
  if (primary && primaryOut) tied.set(primary.id, primaryOut);
  const restD = displays.filter((d) => !tied.has(d.id));
  const restO = outputs.filter((o) => !(primaryOut === o && primary !== undefined));
  const byPlace =
    <T>(place: (t: T) => { x: number; y: number }) =>
    (a: T, b: T) =>
      place(a).x - place(b).x || place(a).y - place(b).y;
  const groups = new Map<string, TieDisplay[]>();
  for (const d of restD) {
    const key = `${String(d.pixelWidth)}x${String(d.pixelHeight)}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const taken = new Set<WinOutput>();
  for (const same of groups.values()) {
    const first = same[0];
    if (!first) continue;
    const outs = restO.filter(
      (o) => !taken.has(o) && near(o.width, first.pixelWidth) && near(o.height, first.pixelHeight),
    );
    if (outs.length !== same.length) continue;
    const ds = [...same].sort(byPlace((d: TieDisplay) => d.bounds));
    const os = [...outs].sort(byPlace((o: WinOutput) => o));
    ds.forEach((d, i) => {
      const o = os[i];
      if (!o) return;
      tied.set(d.id, o);
      taken.add(o);
    });
  }
  return tied;
}

/** The names of the displays an output feeds when it feeds more than one (Windows' Duplicate). */
function mirroredNames(outputs: readonly WinOutput[]): string[] {
  const names: string[] = [];
  for (const o of outputs) {
    if (o.targets.length < 2) continue;
    const external = o.targets.filter((t) => !t.internal);
    for (const t of external.length > 0 ? external : o.targets) names.push(t.name || 'a display');
  }
  return names;
}

/** The names of the displays a Mac mirrors onto. */
function macMirroredNames(found: readonly Found[]): string[] {
  const mirrored = found.filter((f) => f.mirrored);
  if (mirrored.length < 2) return [];
  const external = mirrored.filter((f) => !f.internal);
  return (external.length > 0 ? external : mirrored).map((f) => f.name || 'a display');
}

/** A reading from what each system said, tied to Electron's displays. */
export function macReading(found: readonly Found[], displays: readonly TieDisplay[]): DisplayReading {
  const ids = new Map<number, string>();
  for (const [id, f] of tieMac(found, displays)) {
    const key = f.edid ? hardwareKey(f.edid) : null;
    if (key !== null) ids.set(id, key);
  }
  return { ids, mirroredOnto: macMirroredNames(found) };
}

export function windowsReading(
  outputs: readonly WinOutput[],
  displays: readonly TieDisplay[],
): DisplayReading {
  const ids = new Map<number, string>();
  for (const [id, o] of tieWindows(outputs, displays)) {
    // A mirrored output shows one picture on several displays: no one display's identity is its.
    if (o.targets.length !== 1) continue;
    const edid = o.targets[0] ? parseEdid(o.targets[0].edid) : null;
    const key = edid ? hardwareKey(edid) : null;
    if (key !== null) ids.set(id, key);
  }
  return { ids, mirroredOnto: mirroredNames(outputs) };
}

/**
 * The PowerShell script (Windows): each output on the desktop (its place and size in pixels, whether it is the
 * primary), and each monitor on it (its device path, name, whether it is built in, and its EDID from the
 * registry), printed as one line of JSON. Read only; the structures are those the audit script reads mandir
 * computers with (tools/audit/audit-windows.ps1).
 */
export const WINDOWS_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;
public static class DrashtiDisplayIds {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra;
    public int dmFields; public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation;
    public int dmDisplayFixedOutput; public short dmColor; public short dmDuplex; public short dmYResolution;
    public short dmTTOption; public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight;
    public int dmDisplayFlags; public int dmDisplayFrequency; public int dmICMMethod; public int dmICMIntent;
    public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2;
    public int dmPanningWidth; public int dmPanningHeight;
  }
  [StructLayout(LayoutKind.Sequential)] public struct LUID { public uint LowPart; public int HighPart; }
  [StructLayout(LayoutKind.Sequential)] public struct RATIONAL { public uint Numerator; public uint Denominator; }
  [StructLayout(LayoutKind.Sequential)] public struct REGION2D { public uint cx; public uint cy; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)]
  public struct PATH_SOURCE_INFO { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint statusFlags; }
  [StructLayout(LayoutKind.Sequential)]
  public struct PATH_TARGET_INFO {
    public LUID adapterId; public uint id; public uint modeInfoIdx; public uint outputTechnology; public uint rotation;
    public uint scaling; public RATIONAL refreshRate; public uint scanLineOrdering; public int targetAvailable;
    public uint statusFlags;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PATH_INFO { public PATH_SOURCE_INFO sourceInfo; public PATH_TARGET_INFO targetInfo; public uint flags; }
  [StructLayout(LayoutKind.Sequential)]
  public struct VIDEO_SIGNAL_INFO {
    public ulong pixelRate; public RATIONAL hSyncFreq; public RATIONAL vSyncFreq; public REGION2D activeSize;
    public REGION2D totalSize; public uint videoStandard; public uint scanLineOrdering;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct SOURCE_MODE { public uint width; public uint height; public uint pixelFormat; public POINT position; }
  [StructLayout(LayoutKind.Explicit)]
  public struct MODE_UNION {
    [FieldOffset(0)] public VIDEO_SIGNAL_INFO targetMode;
    [FieldOffset(0)] public SOURCE_MODE sourceMode;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct MODE_INFO { public uint infoType; public uint id; public LUID adapterId; public MODE_UNION mode; }
  [StructLayout(LayoutKind.Sequential)]
  public struct DEVICE_INFO_HEADER { public uint type; public uint size; public LUID adapterId; public uint id; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct TARGET_DEVICE_NAME {
    public DEVICE_INFO_HEADER header; public uint flags; public uint outputTechnology; public ushort edidManufactureId;
    public ushort edidProductCodeId; public uint connectorInstance;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string monitorFriendlyDeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string monitorDevicePath;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct SOURCE_DEVICE_NAME {
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

  static string Quote(string s) {
    StringBuilder b = new StringBuilder("\"");
    foreach (char c in s ?? "") {
      if (c == '\\' || c == '"') { b.Append('\\'); b.Append(c); }
      else if (c < ' ' || c > '~') b.Append("\\u" + ((int)c).ToString("x4"));
      else b.Append(c);
    }
    return b.Append('"').ToString();
  }

  static string Edid(string path) {
    try {
      string[] parts = path.Replace("\\\\?\\", "").Split('#');
      if (parts.Length < 3) return "";
      using (RegistryKey k = Registry.LocalMachine.OpenSubKey("SYSTEM\\CurrentControlSet\\Enum\\" + parts[0] + "\\" + parts[1] + "\\" + parts[2] + "\\Device Parameters")) {
        byte[] edid = k == null ? null : k.GetValue("EDID") as byte[];
        if (edid == null) return "";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < edid.Length && i < 128; i++) b.Append(edid[i].ToString("x2"));
        return b.ToString();
      }
    } catch (Exception) { return ""; }
  }

  static bool Internal(uint t) { return t == 6 || t == 11 || t == 13 || t == 0x80000000; }

  public static string Read() {
    List<string> order = new List<string>();
    Dictionary<string, string> head = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    Dictionary<string, List<string>> targets = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
    for (uint i = 0; i < 64; i++) {
      DISPLAY_DEVICE dd = new DISPLAY_DEVICE();
      dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
      if (!EnumDisplayDevices(null, i, ref dd, 0)) break;
      if ((dd.StateFlags & 0x1) == 0) continue;
      DEVMODE dm = new DEVMODE();
      dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
      if (!EnumDisplaySettingsEx(dd.DeviceName, -1, ref dm, 0)) continue;
      order.Add(dd.DeviceName);
      head[dd.DeviceName] = "\"gdi\":" + Quote(dd.DeviceName) + ",\"primary\":" + ((dd.StateFlags & 0x4) != 0 ? "true" : "false") +
        ",\"x\":" + dm.dmPositionX + ",\"y\":" + dm.dmPositionY + ",\"width\":" + dm.dmPelsWidth + ",\"height\":" + dm.dmPelsHeight;
      targets[dd.DeviceName] = new List<string>();
    }
    uint np, nm;
    if (GetDisplayConfigBufferSizes(2, out np, out nm) == 0) {
      PATH_INFO[] paths = new PATH_INFO[np];
      MODE_INFO[] modes = new MODE_INFO[nm];
      if (QueryDisplayConfig(2, ref np, paths, ref nm, modes, IntPtr.Zero) == 0) {
        for (int p = 0; p < np; p++) {
          SOURCE_DEVICE_NAME src = new SOURCE_DEVICE_NAME();
          src.header.type = 1;
          src.header.size = (uint)Marshal.SizeOf(typeof(SOURCE_DEVICE_NAME));
          src.header.adapterId = paths[p].sourceInfo.adapterId;
          src.header.id = paths[p].sourceInfo.id;
          if (DisplayConfigGetDeviceInfo(ref src) != 0 || !targets.ContainsKey(src.viewGdiDeviceName)) continue;
          TARGET_DEVICE_NAME tgt = new TARGET_DEVICE_NAME();
          tgt.header.type = 2;
          tgt.header.size = (uint)Marshal.SizeOf(typeof(TARGET_DEVICE_NAME));
          tgt.header.adapterId = paths[p].targetInfo.adapterId;
          tgt.header.id = paths[p].targetInfo.id;
          string path = "", name = "";
          uint tech = paths[p].targetInfo.outputTechnology;
          if (DisplayConfigGetDeviceInfo(ref tgt) == 0) {
            path = tgt.monitorDevicePath ?? "";
            name = tgt.monitorFriendlyDeviceName ?? "";
            tech = tgt.outputTechnology;
          }
          targets[src.viewGdiDeviceName].Add("{\"path\":" + Quote(path) + ",\"name\":" + Quote(name) + ",\"internal\":" +
            (Internal(tech) ? "true" : "false") + ",\"edid\":" + Quote(path.Length > 0 ? Edid(path) : "") + "}");
        }
      }
    }
    List<string> outputs = new List<string>();
    foreach (string gdi in order) outputs.Add("{" + head[gdi] + ",\"targets\":[" + String.Join(",", targets[gdi].ToArray()) + "]}");
    return "{\"outputs\":[" + String.Join(",", outputs.ToArray()) + "]}";
  }
}
'@
[DrashtiDisplayIds]::Read()
`;

// ---- reading ----------------------------------------------------------------------------------------------------

/** Run a program and give what it printed, or null when it failed or took longer than `timeoutMs`. */
export type RunFile = (file: string, args: readonly string[], timeoutMs: number) => Promise<string | null>;

const runFile: RunFile = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        resolve(error ? null : stdout);
      },
    );
  });

/** Read a Mac's displays: system_profiler's list (a second or so), or null when it cannot be read. */
export async function readMac(
  displays: readonly TieDisplay[],
  run: RunFile = runFile,
): Promise<DisplayReading | null> {
  const said = await run('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json'], 20_000);
  if (said === null) return null;
  try {
    return macReading(parseMacDisplays(JSON.parse(said)), displays);
  } catch {
    return null;
  }
}

/**
 * Windows PowerShell running the script given whole as -EncodedCommand (its text in UTF-16, in base64), so no quote
 * or backslash in it is ever read another way on the command line; what it printed, or null.
 */
const runEncoded = (script: string): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(
      powershellPath(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { timeout: 30_000, windowsHide: true, env: powershellEnv(), maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        resolve(error ? null : stdout);
      },
    );
  });

/** Read Windows' displays: the script (a few seconds: PowerShell starts and builds its part), or null. */
export async function readWindows(
  displays: readonly TieDisplay[],
  run: (script: string) => Promise<string | null> = runEncoded,
): Promise<DisplayReading | null> {
  const said = await run(WINDOWS_SCRIPT);
  const outputs = said === null ? null : parseWindowsOutputs(said);
  return outputs === null ? null : windowsReading(outputs, displays);
}

/** This system's reader, or none (Linux: the tests' CI checks; nothing to read there). */
export function systemReader(
  platform: NodeJS.Platform = process.platform,
): ((displays: readonly TieDisplay[]) => Promise<DisplayReading | null>) | null {
  if (platform === 'darwin') return (displays) => readMac(displays);
  if (platform === 'win32') return (displays) => readWindows(displays);
  return null;
}

/**
 * Tests only (never a packaged Drashti): the tests' pretend displays (electron-outputs.ts, from `firstId`) given
 * pretend identities by their place among them, as the test says ("" for none); the computer's own displays none;
 * mirroring as the test says. No child process.
 */
export function standInReader(
  serials: () => readonly string[],
  firstId: number,
  mirroredOnto: () => readonly string[] = () => [],
): (displays: readonly TieDisplay[]) => Promise<DisplayReading> {
  return (displays) => {
    const ids = new Map<number, string>();
    const list = serials();
    for (const d of displays) {
      const serial = d.id >= firstId ? list[d.id - firstId] : undefined;
      if (serial) ids.set(d.id, `test:${serial}`);
    }
    return Promise.resolve({ ids, mirroredOnto: [...mirroredOnto()] });
  };
}

// ---- the identities as Drashti keeps them -----------------------------------------------------------------------

export interface DisplayIdsDeps {
  /** Read every display (off the main thread); null when it could not be read. Never throws (a throw is none). */
  read(displays: readonly TieDisplay[]): Promise<DisplayReading | null>;
  /** The displays now, as Electron has them. */
  displays(): TieDisplay[];
  log?(message: string): void;
}

/** One display's identity as read, with what Electron said of that display then. */
interface Known {
  key: string;
  label: string;
  pixelWidth: number;
  pixelHeight: number;
}

/**
 * Each display's identity, as last read: read at the start and again after every change of the displays, one
 * reading at a time (a change during one reads once more after it). A display is given its identity only while it
 * is still as it was read (its id, name and size): one plugged in since is not known until it has been read. Two
 * displays read with the same identity (units that all give one serial number) are given none.
 */
export class DisplayIds {
  private known = new Map<number, Known>();
  private mirrored: string[] = [];
  private reads = 0;
  private current: Promise<void> | null = null;
  private queued: Promise<void> | null = null;
  private saidNone = false;

  constructor(private readonly deps: DisplayIdsDeps) {}

  /** Read again; settles once a reading begun after this call has ended. */
  refresh(): Promise<void> {
    if (!this.current) {
      this.current = this.read().finally(() => {
        this.current = null;
      });
      return this.current;
    }
    this.queued ??= this.current.then(() => {
      this.queued = null;
      return this.refresh();
    });
    return this.queued;
  }

  /** At least one reading has ended (with an answer or none). */
  ready(): boolean {
    return this.reads > 0;
  }

  /** This display's identity, while it is as it was read; null for none. */
  identityOf(d: Pick<DisplayInfo, 'id' | 'label' | 'pixelWidth' | 'pixelHeight'>): string | null {
    const k = this.known.get(d.id);
    return k?.label === d.label && k.pixelWidth === d.pixelWidth && k.pixelHeight === d.pixelHeight
      ? k.key
      : null;
  }

  /** The displays the computer mirrors its screen onto, as last read (none when it does not). */
  mirroredOnto(): string[] {
    return this.mirrored;
  }

  private async read(): Promise<void> {
    const displays = this.deps.displays();
    let reading: DisplayReading | null;
    try {
      reading = await this.deps.read(displays);
    } catch {
      reading = null;
    }
    this.reads++;
    if (!reading) {
      // Kept as they were: a reading that fails now and then never loses what was read.
      if (!this.saidNone)
        this.deps.log?.('Displays: their own identities could not be read; found as before');
      this.saidNone = true;
      return;
    }
    const counts = new Map<string, number>();
    for (const key of reading.ids.values()) counts.set(key, (counts.get(key) ?? 0) + 1);
    const known = new Map<number, Known>();
    for (const [id, key] of reading.ids) {
      const d = displays.find((x) => x.id === id);
      if (!d || (counts.get(key) ?? 0) > 1) continue;
      known.set(id, { key, label: d.label, pixelWidth: d.pixelWidth, pixelHeight: d.pixelHeight });
    }
    this.known = known;
    this.mirrored = reading.mirroredOnto;
    this.deps.log?.(
      `Displays: ${String(known.size)} of ${String(displays.length)} known by their own identity${
        reading.mirroredOnto.length > 0 ? `; mirroring onto ${reading.mirroredOnto.join(', ')}` : ''
      }`,
    );
  }
}
