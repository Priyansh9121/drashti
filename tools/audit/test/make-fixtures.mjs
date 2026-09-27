// Builds a synthetic ProPresenter 6 / 7 data tree for testing the audit
// scripts. Every string here is placeholder text written for these tests;
// no real kirtan, scripture or mandir data is used.
//
//   node make-fixtures.mjs <root>
//
// Creates <root>/home (a fake macOS home) and <root>/win (a fake Windows
// profile) and prints a JSON description of what the scripts should find.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
if (!root) {
  console.error('usage: node make-fixtures.mjs <root>');
  process.exit(2);
}

function put(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}
const b64 = (s, enc = 'latin1') => Buffer.from(s, enc).toString('base64');
// file:///C:/... on Windows, file:///Users/... on macOS, percent-encoded.
const fileUrl = (p) => pathToFileURL(p).href;
const xmlAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Unicode code points for the placeholder word "sample" (Gujarati and Hindi).
const GU_SAMPLE = [0x0aa8, 0x0aae, 0x0ac2, 0x0aa8, 0x0acb]; // નમૂનો
const HI_SAMPLE = [0x0928, 0x092e, 0x0942, 0x0928, 0x093e]; // नमूना
const rtfU = (cps, uc0 = true) => (uc0 ? '\\uc0' : '') + cps.map((c) => `\\u${c}${uc0 ? ' ' : '?'}`).join('');

// ---------- PP6 (macOS) RTF, as Cocoa writes it ----------
const rtfGujarati = [
  '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2580',
  '\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fnil\\fcharset0 Gopika;\\f1\\fnil\\fcharset0 NotoSansGujarati;\\f2\\fswiss\\fcharset0 Helvetica;}',
  '{\\colortbl;\\red255\\green255\\blue255;}',
  '{\\*\\expandedcolortbl;;}',
  '\\pard\\pardirnatural\\qc\\partightenfactor0',
  '',
  '\\f0\\fs96 \\cf1 nmUnO lIq\\',
  `\\f1 ${rtfU(GU_SAMPLE)}\\`,
  '\\f2 Placeholder line one}',
].join('\n');
const rtfHindi = [
  '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2580',
  '{\\fonttbl\\f0\\fnil\\fcharset0 Kruti Dev 010;\\f1\\fnil\\fcharset0 Noto Sans Devanagari;}',
  '{\\colortbl;\\red255\\green255\\blue255;}',
  '\\pard\\qc',
  '\\f0\\fs96 \\cf1 uewuk\\',
  `\\f1 ${rtfU(HI_SAMPLE)}}`,
].join('\n');
// PP6 for Windows stores XAML (UTF-16) next to the RTF.
const xaml =
  '<FlowDocument xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" FontFamily="Shruti">' +
  '<Paragraph><Run FontFamily="Gopika">nmUnO</Run></Paragraph></FlowDocument>';

// ---------- PP7 RTF, as ProPresenter 7 for Windows writes it ----------
const rtf7 = [
  '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fnil\\fcharset0 Shruti;}{\\f1\\fnil Arial;}{\\f2\\fnil Unused Font;}}',
  `\\pard\\f0\\fs80 ${rtfU(GU_SAMPLE, false)}\\par`,
  '\\f1 Placeholder English line\\par}',
].join('\r\n');
const rtf7b = [
  '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fnil Mukta Vaani;}}',
  `\\pard\\f0 ${rtfU(GU_SAMPLE, false)}\\par}`,
].join('\r\n');

// ---------- minimal protobuf + zip writers ----------
function varint(n) {
  const out = [];
  while (n >= 128) {
    out.push((n % 128) + 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}
const field = (num, payload) =>
  Buffer.concat([varint((num << 3) | 2), varint(payload.length), Buffer.isBuffer(payload) ? payload : Buffer.from(payload)]);
const varintField = (num, value) => Buffer.concat([varint(num << 3), varint(value)]);

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, e.data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(e.data.length, 20);
    cen.writeUInt32LE(e.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + e.data.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

function pp7Document({ rtf, urls, winPaths }) {
  const chunks = [field(1, 'b5b7c8a2-0000-4000-8000-placeholder'), field(3, Buffer.concat([field(1, 'Verse 1'), field(5, field(2, Buffer.from(rtf, 'latin1')))]))];
  for (const url of urls) {
    // A URL message followed by a field whose tag byte is printable ("2"),
    // so a naive printable-run reader would over-read.
    chunks.push(field(4, Buffer.concat([field(1, url), field(6, 'x'), varintField(4, 2)])));
  }
  for (const p of winPaths) chunks.push(field(7, field(1, p)));
  return Buffer.concat(chunks);
}

function pp6Document({ rtfs, xamls = [], media = [], groups = 1 }) {
  const elements = rtfs
    .map(
      (r, i) => `            <RVTextElement displayName="Text ${i + 1}" UUID="00000000-0000-4000-8000-00000000000${i}">
              <RVRect3D rvXMLIvarName="position">{0 0 0 1920 1080}</RVRect3D>
              <NSString rvXMLIvarName="PlainText">${b64('placeholder')}</NSString>
              <NSString rvXMLIvarName="RTFData">${b64(r)}</NSString>${
                xamls[i] ? `\n              <NSString rvXMLIvarName="WinFlowData">${b64(xamls[i], 'utf16le')}</NSString>` : ''
              }
            </RVTextElement>`,
    )
    .join('\n');
  const mediaXml = media.map((m) => `          <RVMediaCue UUID="m" displayName="bg"><RVVideoElement source="${xmlAttr(m)}" /></RVMediaCue>`).join('\n');
  const slide = `      <RVDisplaySlide backgroundColor="0 0 0 1" enabled="true" UUID="s">
${mediaXml}
          <array rvXMLIvarName="displayElements">
${elements}
          </array>
      </RVDisplaySlide>`;
  const grp = Array.from({ length: groups }, (_, g) => `    <RVSlideGrouping name="Verse ${g + 1}" uuid="g${g}" color="0 0 1 1">
      <array rvXMLIvarName="slides">
${slide}
      </array>
    </RVSlideGrouping>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<RVPresentationDocument height="1080" width="1920" versionNumber="600" docType="0">
  <array rvXMLIvarName="groups">
${grp}
  </array>
</RVPresentationDocument>
`;
}

// ============================ macOS tree ============================
const home = join(root, 'home');
const macMedia = join(home, 'Movies', 'Drashti Test', 'loop.mp4');
const macStill = join(home, 'Movies', 'Drashti Test', 'still.jpg');
const macMissing = join(home, 'Movies', 'Drashti Test', 'gone away.mov');
const macLongMissing = join(home, 'Movies', 'A very long folder name that pushes the URL past one hundred and twenty seven bytes', 'missing-clip.mov');
put(macMedia, Buffer.alloc(2048, 1));
put(macStill, Buffer.alloc(512, 2));
const lib6 = join(home, 'Documents', 'ProPresenter6');
put(
  join(lib6, 'Test Sample.pro6'),
  pp6Document({ rtfs: [rtfGujarati, rtfHindi], xamls: [xaml, null], media: [fileUrl(macMedia), fileUrl(macMissing), 'C:\\Users\\Public\\Videos\\intro.mp4'], groups: 2 }),
);
put(join(lib6, 'Second & Last.pro6'), pp6Document({ rtfs: [rtfHindi], media: [fileUrl(macStill)] }));
const support6 = join(home, 'Library', 'Application Support', 'RenewedVision', 'ProPresenter6');
put(
  join(support6, 'PlaylistData', 'Default.pro6pl'),
  `<?xml version="1.0" encoding="utf-8"?>
<RVPlaylistDocument versionNumber="600" os="1">
  <RVPlaylistNode displayName="root" type="0">
    <array rvXMLIvarName="children">
      <RVPlaylistNode displayName="Sunday Sabha" type="3">
        <array rvXMLIvarName="children">
          <RVDocumentCue filePath="${xmlAttr(fileUrl(join(lib6, 'Test Sample.pro6')))}" displayName="Test Sample" />
          <RVDocumentCue filePath="${xmlAttr(fileUrl(join(lib6, 'Deleted Song.pro6')))}" displayName="Deleted Song" />
          <RVMediaCue displayName="still"><RVImageElement source="${xmlAttr(fileUrl(macStill))}" /></RVMediaCue>
        </array>
      </RVPlaylistNode>
    </array>
  </RVPlaylistNode>
</RVPlaylistDocument>
`,
);
put(join(support6, 'Templates', 'Lower Third.pro6'), pp6Document({ rtfs: [rtfGujarati] }));
put(
  join(home, 'Library', 'Preferences', 'com.renewedvision.ProPresenter6.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>applicationShowDirectory</key>
	<string>${lib6}</string>
	<key>RegistrationKey</key>
	<string>ZQXW-PLMO-KNIJ-BUHV</string>
	<key>SupportContact</key>
	<string>placeholder.person@example.org</string>
	<key>StreamDestination</key>
	<string>rtmp://a.rtmp.youtube.com/live2/plac-ehol-derk-ey01</string>
	<key>RemotePassword</key>
	<string>not-a-real-password-123</string>
	<key>AudioOutputDevice</key>
	<string>Built-in Output</string>
	<key>OldLibraryPath</key>
	<string>/Volumes/OldDrive/PP6 Library</string>
	<key>Outputs</key>
	<dict>
		<key>Audience</key>
		<dict>
			<key>DisplayID</key>
			<integer>2</integer>
			<key>Resolution</key>
			<string>1920x1080</string>
		</dict>
	</dict>
	<key>WindowFrame</key>
	<data>
	AAAAAAAA
	</data>
	<key>Escaped</key>
	<string>A &amp; B &lt;C&gt;</string>
	<key>EmptyValue</key>
	<string/>
	<key>Enabled</key>
	<true/>
</dict>
</plist>
`,
);
put(join(home, 'Library', 'Fonts', 'Gopika.ttf'), Buffer.from('placeholder font bytes'));
// A PP7 library on the Mac too (protobuf) and an exported bundle.
const lib7mac = join(home, 'Documents', 'ProPresenter', 'Libraries', 'Default');
put(
  join(lib7mac, 'Welcome.pro'),
  pp7Document({ rtf: rtf7, urls: [fileUrl(macMedia), fileUrl(macLongMissing)], winPaths: ['C:\\Users\\Public\\Videos\\intro.mp4'] }),
);
put(join(lib7mac, 'Export.probundle'), zip([{ name: 'Bundle Song.pro', data: pp7Document({ rtf: rtf7b, urls: [], winPaths: [] }) }]));
// A stray non-ProPresenter .pro file that must be ignored.
put(join(home, 'Documents', 'code', 'qtproject.pro'), 'TEMPLATE = app\n');

// ============================ Windows tree ============================
const win = join(root, 'win');
const winDocs = join(win, 'Users', 'Operator', 'Documents', 'ProPresenter');
const winMedia = join(winDocs, 'Media', 'Assets', 'loop.mp4');
put(winMedia, Buffer.alloc(1024, 3));
const winMissing = join(winDocs, 'Media', 'Assets', 'missing file.mov');
put(
  join(winDocs, 'Libraries', 'Default', 'Welcome.pro'),
  pp7Document({ rtf: rtf7, urls: [fileUrl(winMedia), fileUrl(winMissing), fileUrl(macLongMissing)], winPaths: ['Q:\\Nowhere\\intro.mp4'] }),
);
put(join(winDocs, 'Libraries', 'Default', 'Export.probundle'), zip([{ name: 'Bundle Song.pro', data: pp7Document({ rtf: rtf7b, urls: [], winPaths: [] }) }]));
put(join(winDocs, 'Configuration', 'Workspaces', 'Default'), pp7Document({ rtf: '', urls: [fileUrl(winMedia)], winPaths: [] }));
put(join(win, 'Users', 'Operator', 'AppData', 'Roaming', 'RenewedVision', 'ProPresenter', 'Preferences', 'General.pro'), field(1, 'placeholder preference'));
put(join(win, 'Users', 'Operator', 'Documents', 'ProPresenter6', 'Old Song.pro6'), pp6Document({ rtfs: [rtfHindi, rtfGujarati], xamls: [xaml, null], media: [fileUrl(winMissing)] }));

process.stdout.write(
  JSON.stringify(
    {
      home,
      win,
      macMedia,
      macStill,
      macMissing,
      macLongMissing,
      lib6,
      support6,
      lib7mac,
      winDocs,
      winMedia,
      winMissing,
      secrets: ['ZQXW-PLMO-KNIJ-BUHV', 'placeholder.person@example.org', 'plac-ehol-derk-ey01', 'not-a-real-password-123'],
    },
    null,
    2,
  ) + '\n',
);
