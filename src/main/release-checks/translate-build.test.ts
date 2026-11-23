import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

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

  it('keeps each project’s own licence file word for word, the port’s too (the owner’s QA22-MT-1 and QA22-MT-3)', () => {
    // Each digest is the upstream file's own (line ends as LF, as this repository keeps text): CTranslate2
    // 4.9.1 and its pinned ruy, cpuinfo (and its clog), cpu_features and spdlog (and its fmt 8.1.1);
    // SentencePiece 0.2.1 and its own protobuf-lite, absl and darts-clone; the ported IndicTransToolkit 1.1.1,
    // indic-nlp-library 0.92 and sacremoses 0.2.0 (their wheels' licence files), the IndicTrans2 models'
    // repositories (AI4Bharat: the tokenizer's decode) and Hugging Face Transformers 4.51.3 (the clean-up after
    // decoding).
    const verbatim: Record<string, string> = {
      'CTranslate2-LICENSE.txt': '54aa79d9fe3c09e67a16dcd95b9e88676405a6ec174efda31036983cf7672ecb',
      'ruy-LICENSE.txt': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
      'cpuinfo-LICENSE.txt': '8e7e60636c3aa0cb03571a1a841ce5697f9551ff92b3c426c2561613d15ade70',
      'clog-LICENSE.txt': '68a14c3e79add023eecd83d611e73f05b8bf1d16852efeb7eb4033a96736da9e',
      'cpu_features-LICENSE.txt': 'af272c1b4dd08dd61d43e001d3134119d03ca7a2b057a64f7355fdf27fbea3dd',
      'spdlog-LICENSE.txt': '71cc245f2f8cf17920d815277cb52628b49866f3ba1ae1dcb865771c408caa51',
      'fmt-LICENSE.txt': '825c9324e70f8c839c8ba910543dd4a7daee243b86ef960594c11381a19980b8',
      'sentencepiece-LICENSE.txt': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
      'protobuf-lite-LICENSE.txt': '6e5e117324afd944dcf67f36cf329843bc1a92229a8cd9bb573d7a83130fea7d',
      'abseil-LICENSE.txt': 'd3e2f59e1d71176dfdb555ece6a41f7a5aa0f52ff21211010ace314f57695f6b',
      'darts-clone-LICENSE.txt': '155f59997298ee336602c49f9c1110f268ac394ca2197eb02647a3555935ad52',
      'IndicTransToolkit-LICENSE.txt': '3be0a01dffc3eda371f1532a50116384d3b51695dbe30068c67419aa0923a715',
      'indic-nlp-library-LICENSE.txt': '021fdfaed932285b958a25bc2e63b7b6e5097937320c3afc06f6ff480fb3de12',
      'sacremoses-LICENSE.txt': 'efe03a5e303b216ad2008b100da2ac2fbe6aa3ca442f2cfb931227f996fd2ebe',
      'IndicTrans2-LICENSE.txt': '383258420065a19d9fef0daf00d10792d3f8a5ccf783d94a91f5d6755386615b',
      'transformers-LICENSE.txt': '77fd4710def9ec3c0f6225800e0235f15a425abd4a8b03559127fcd782612049',
    };
    const notice = read('LICENSES/translation/README.md');
    for (const [file, digest] of Object.entries(verbatim)) {
      const path = join(root, 'LICENSES', 'translation', file);
      expect(existsSync(path), file).toBe(true);
      expect(existsSync(path) ? sha256(path) : 'missing', file).toBe(digest);
      expect(notice, file).toContain(`\`${file}\``);
    }
    // Every other file in the folder is the README or one of Drashti's two lists of compiled-in notices.
    const others = readdirSync(join(root, 'LICENSES', 'translation')).filter((f) => !(f in verbatim));
    expect(others.sort()).toEqual([
      'README.md',
      'ctranslate2-submodules-copyrights.txt',
      'ctranslate2-third-party-headers.txt',
    ]);
  });

  it('lists every copyright line of the pinned submodules’ compiled files, word for word (QA22-MT-3)', () => {
    // From every file the two Mac builds compile (the compiler's own list of sources and headers) and the
    // Windows build's own files (cpuinfo's x86/windows, spdlog's wincolor sink): each under its project's
    // licence file.
    const lines = read('LICENSES/translation/ctranslate2-submodules-copyrights.txt');
    for (const words of [
      '=== ruy, commit 363f2522 (Apache-2.0, ruy-LICENSE.txt)',
      'Copyright 2019 Google LLC. All Rights Reserved.',
      'Copyright 2020 Google LLC. All Rights Reserved.',
      'Copyright 2021 Google LLC. All Rights Reserved.',
      'Copyright 2022 Google LLC. All Rights Reserved.',
      'Copyright 2020 The TensorFlow Authors. All Rights Reserved.',
      '=== cpuinfo, commit 082deffc (BSD-2-Clause, cpuinfo-LICENSE.txt)',
      'Copyright (c) Facebook, Inc. and its affiliates.',
      '=== clog, bundled in cpuinfo (BSD-2-Clause, clog-LICENSE.txt)',
      '=== cpu_features, commit 8a494eb1 (Apache-2.0, cpu_features-LICENSE.txt)',
      'Copyright 2017 Google LLC',
      'Copyright 2021 Google LLC',
      'Copyright 2020 Intel Corporation',
      'Copyright 2018 IBM.',
      '=== spdlog, commit 76fb40d9 (MIT, spdlog-LICENSE.txt)',
      'Copyright(c) 2015-present, Gabi Melman & spdlog contributors.',
      'Copyright(c) 2016-2018 Gabi Melman.',
      '=== fmt 8.1.1, bundled in spdlog (MIT, fmt-LICENSE.txt)',
      'Copyright (c) 2012 - present, Victor Zverovich',
      'Copyright (c) 2012 - 2016, Victor Zverovich',
    ])
      expect(lines, words).toContain(words);
  });

  it('ships the whole LICENSES folder in every installer, the translation notices with it', () => {
    // The packaged list: electron-builder copies LICENSES/ to the app's resources as it is, with no filter.
    expect(read('electron-builder.yml')).toMatch(
      /\nextraResources:\n {2}- from: LICENSES\n {4}to: licenses\n(?! {4})/u,
    );
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

  it('holds the helper’s own code to /W4 /WX on Windows, the libraries’ headers as external (a22-review-mt A13)', () => {
    // As on a Mac: our file's warnings are errors, the libraries' are not ours to fix (MSVC warned C4834 in half.hpp
    // in run 45249372868). SYSTEM gives MSVC their folders as /external:I; /external:W0 keeps them quiet.
    const cmake = read('tools/translate/CMakeLists.txt');
    expect(cmake).toContain('cmake_minimum_required(VERSION 3.25)');
    expect(cmake).toContain('add_subdirectory(${CT2_SOURCE} ctranslate2 EXCLUDE_FROM_ALL SYSTEM)');
    expect(cmake).toContain('add_subdirectory(${SPM_SOURCE} sentencepiece EXCLUDE_FROM_ALL SYSTEM)');
    expect(cmake).toContain('target_include_directories(drashti-translate SYSTEM PRIVATE');
    expect(cmake).toContain(
      'target_compile_options(drashti-translate PRIVATE /W4 /WX /utf-8 /external:anglebrackets /external:W0)',
    );
    expect(cmake).not.toContain('/W3');
    // MSVC deprecates _wfopen (C4996, an error under /WX); _wfsopen shares the file as _wfopen does.
    const source = read('tools/translate/drashti-translate.cc');
    expect(source).not.toMatch(/\b_wfopen\(/u);
    expect(source).toContain('_wfsopen(wide.c_str(), L"rb", _SH_DENYNO)');
  });

  it('reads the tokenizer model itself, through a wide path on Windows, and refuses an empty path (a22-review-mt A6)', () => {
    // SentencePiece's own Load opens a narrow path on Windows (a user name outside the ANSI code page fails), and
    // reads standard input for an empty name: the helper's own protocol channel.
    const source = read('tools/translate/drashti-translate.cc');
    expect(source).not.toMatch(/\.spm\.Load\(/u);
    expect(source).toContain('LoadFromSerializedProto');
    expect(source).toMatch(/#ifdef _WIN32[\s\S]*MultiByteToWideChar\(CP_UTF8[\s\S]*_wfsopen/u);
    expect(source).toContain('model->empty() || !spm || spm->empty()');
  });

  it('compiles ruy\u2019s x86 fast paths into the Intel Mac build (a22-review-mt A2)', () => {
    // ruy enables its AVX paths on its own only for Linux clang, GCC 9 and MSVC; Apple clang needs its switch, in every
    // file that includes ruy (ruy itself and CTranslate2), or every int8 product runs ruy\u2019s reference C++.
    const script = read('scripts/fetch-translate.mjs');
    expect(script).toContain("const x86Ruy = x86 ? ['-DRUY_FORCE_ENABLE_X86_ENHANCEMENTS'] : [];");
    const ruyJobs = script.split('// ruy, every library source')[1]?.split('// cpu_features')[0] ?? '';
    const ct2Defines = script.split('const ct2Defines = [')[1]?.split('];')[0] ?? '';
    expect(ruyJobs).toContain('...x86Ruy');
    expect(ct2Defines).toContain('...x86Ruy');
  });

  it('checks a number\u2019s range before converting it, never after (a22-review-mt A11)', () => {
    // "beam": 1e300 cast to long first is undefined behaviour.
    const source = read('tools/translate/drashti-translate.cc');
    const integer = source.split('std::optional<long> integer(')[1]?.split('\n}')[0] ?? '';
    expect(integer).toContain(
      'if (!(v >= static_cast<double>(lo) && v <= static_cast<double>(hi)) || v != std::floor(v))',
    );
    expect(integer.indexOf('std::floor')).toBeLessThan(integer.indexOf('static_cast<long>(v)'));
  });
});
