import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOURCES, TARGETS } from '../../../scripts/fetch-translate.mjs';
import { HELPER_PROTOCOL } from '../translation/translation-helper';

/*
 * Prepare translations' engine (alpha.22, a22-mt; the owner's "Yes, bundle all three"): drashti-translate built from
 * CTranslate2's and SentencePiece's official sources, each download pinned to its SHA-256 (scripts/fetch-translate.mjs);
 * their licences in LICENSES/translation/; the program alone in each installer; built in CI's full runs and in the
 * release build (never from a cache there), and started in each packaged app (scripts/check-ffmpeg.mjs).
 */

const root = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('the translation engine’s pinned sources and packaging (alpha.22)', () => {
  it('pins every source to an official GitHub download and its SHA-256', () => {
    expect(SOURCES.map((s) => s.name)).toEqual([
      'CTranslate2-4.9.1.tar.gz',
      'ruy-363f2522.tar.gz',
      'cpuinfo-082deffc.tar.gz',
      'cpu_features-8a494eb1.tar.gz',
      'spdlog-76fb40d9.tar.gz',
      'sentencepiece-0.2.1.tar.gz',
    ]);
    for (const s of SOURCES) {
      expect(s.url, s.name).toMatch(
        /^https:\/\/github\.com\/(OpenNMT\/CTranslate2|google\/ruy|pytorch\/cpuinfo|google\/cpu_features|gabime\/spdlog|google\/sentencepiece)\//u,
      );
      expect(s.sha256, s.name).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(Object.keys(TARGETS)).toEqual(['darwin-arm64', 'darwin-x64', 'win32-x64']);
  });

  it('keeps every licence text, named in the notice', () => {
    const notice = read('LICENSES/translation/README.md');
    for (const file of [
      'CTranslate2-LICENSE.txt',
      'ctranslate2-third-party-headers.txt',
      'ruy-LICENSE.txt',
      'cpuinfo-LICENSE.txt',
      'clog-LICENSE.txt',
      'cpu_features-LICENSE.txt',
      'spdlog-LICENSE.txt',
      'fmt-LICENSE.txt',
      'sentencepiece-LICENSE.txt',
      'protobuf-lite-LICENSE.txt',
      'abseil-LICENSE.txt',
      'darts-clone-LICENSE.txt',
      'IndicTransToolkit-LICENSE.txt',
      'indic-nlp-library-LICENSE.txt',
      'sacremoses-LICENSE.txt',
    ]) {
      expect(existsSync(join(root, 'LICENSES', 'translation', file)), file).toBe(true);
      expect(notice, file).toContain(file);
    }
    for (const pin of ['v4.9.1', '363f2522', '082deffc', '8a494eb1', '76fb40d9', 'v0.2.1'])
      expect(notice).toContain(pin);
  });

  it('keeps the notices of every MIT header CTranslate2 compiles in: half.hpp and json.hpp too (a22-review-mt A3)', () => {
    const headers = read('LICENSES/translation/ctranslate2-third-party-headers.txt');
    for (const words of [
      '=== include/half_float/half.hpp',
      'Copyright (c) 2012-2021 Christian Rau',
      '=== include/nlohmann/json.hpp',
      '2013-2022 Niels Lohmann',
      '2008-2009 Bj\u00f6rn Hoehrmann',
      '2009 Florian Loitsch',
      '2016-2021 Evan Nemerson',
      '2018 The Abseil Authors',
      'Permission is hereby granted, free of charge',
    ])
      expect(headers, words).toContain(words);
    const notice = read('LICENSES/translation/README.md');
    expect(notice).toContain('half.hpp');
    expect(notice).toContain('json.hpp');
  });

  it('puts the program alone in each installer, and starts it in each packaged app', () => {
    const builder = read('electron-builder.yml');
    expect(builder).toMatch(
      /- from: vendor\/translate\/darwin-\$\{arch\}\n\s+to: translate\n\s+filter: \[drashti-translate\]/u,
    );
    expect(builder).toMatch(
      /- from: vendor\/translate\/win32-\$\{arch\}\n\s+to: translate\n\s+filter: \[drashti-translate\.exe\]/u,
    );
    expect(read('scripts/check-ffmpeg.mjs')).toContain('checkTranslate(label, command, args)');
  });

  it('builds it in CI’s full runs and in the release, the release never from a cache', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('run: node scripts/fetch-translate.mjs\n');
    expect(ci).toContain('run: node scripts/fetch-translate.mjs --target darwin-x64');
    const release = read('.github/workflows/release.yml');
    expect(release).toContain('run: node scripts/fetch-translate.mjs\n');
    expect(release).toContain('run: node scripts/fetch-translate.mjs --target darwin-x64');
    expect(release).not.toContain('vendor/translate');
  });

  it('builds the helper from Drashti’s own source, which speaks the protocol the app expects', () => {
    const source = read('tools/translate/drashti-translate.cc');
    expect(source).toContain(`constexpr int kProtocol = ${String(HELPER_PROTOCOL)};`);
    expect(read('tools/translate/CMakeLists.txt')).toContain('set(WITH_MKL OFF');
  });

  it('has the Intel program refuse only under Rosetta: on a real Intel Mac it runs as any other', () => {
    const source = read('tools/translate/drashti-translate.cc');
    const gate = source.split('bool under_rosetta()')[1]?.split('struct Route')[0] ?? '';
    expect(gate).toMatch(/#if defined\(__APPLE__\) && defined\(__x86_64__\)/u);
    expect(gate).toContain(
      'sysctlbyname("sysctl.proc_translated", &translated, &size, nullptr, 0) == 0 && translated == 1',
    );
    expect(gate).toMatch(/#else\n\s+return false;\n#endif/u);
    expect(source.match(/under_rosetta\(\)/gu)).toHaveLength(2);
    expect(source).toContain('if (under_rosetta()) return fail(o, "translated");');
  });

  it('configures the Windows build for CMake 4, whose runners refuse the 3.0 and 3.1 minimums cpu_features and clog name', () => {
    // Full run 45221762761 (24 Nov 2026): "Compatibility with CMake < 3.5 has been removed" at cpu_features.
    expect(read('scripts/fetch-translate.mjs')).toContain("'-DCMAKE_POLICY_VERSION_MINIMUM=3.5'");
  });

  it('holds only the helper’s own code to -Werror: the libraries’ headers are system headers on a Mac', () => {
    // Full run 45221762761 (24 Nov 2026): CI's newer clang warns in CTranslate2's bundled half.hpp and json.hpp
    // (-Wdeprecated-literal-operator), which -Werror turned into a failed build.
    const script = read('scripts/fetch-translate.mjs');
    const helper = script.split("name: 'drashti-translate',")[1]?.split('});')[0] ?? '';
    expect(helper).toContain("'-Werror'");
    expect(helper).toContain("`-isystem${join(ct2, 'include')}`");
    expect(helper).not.toMatch(/`-I\$\{/u);
  });

  it('reads the tokenizer model itself, through a wide path on Windows, and refuses an empty path (a22-review-mt A6)', () => {
    // SentencePiece's own Load opens a narrow path on Windows (a user name outside the ANSI code page fails), and
    // reads standard input for an empty name: the helper's own protocol channel.
    const source = read('tools/translate/drashti-translate.cc');
    expect(source).not.toMatch(/\.spm\.Load\(/u);
    expect(source).toContain('LoadFromSerializedProto');
    expect(source).toMatch(/#ifdef _WIN32[\s\S]*MultiByteToWideChar\(CP_UTF8[\s\S]*_wfopen/u);
    expect(source).toContain('model->empty() || !spm || spm->empty()');
  });

  it('compiles ruy\u2019s x86 fast paths into the Intel Mac build (a22-review-mt A2)', () => {
    // ruy enables its AVX paths on its own only for Linux clang, GCC 9 and MSVC; Apple clang needs its switch, in every
    // file that includes ruy (ruy itself and CTranslate2), or every int8 product runs ruy\u2019s reference C++.
    const script = read('scripts/fetch-translate.mjs');
    expect(script.match(/x86 \? \['-DRUY_FORCE_ENABLE_X86_ENHANCEMENTS'\] : \[\]/gu)).toHaveLength(2);
  });
});
