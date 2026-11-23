# Prepare translations' engine (third-party notice)

Since alpha.22, **Edit slides… › Translate… › Prepare translations** drafts translations between Gujarati, Hindi and English with an offline engine. A named reader checks every draft before it can show. The engine has two parts.

## drashti-translate

A separate program in the app's resources (`Resources/translate/` on a Mac, `resources\translate\` on Windows), built from `tools/translate/drashti-translate.cc` by `scripts/fetch-translate.mjs`. Drashti runs it as its own process, below the show's priority, with no network port. It is not linked into Drashti's own code. Neither project publishes a C++ program or library for these computers, so it is built from their official source releases. Each download is pinned to one SHA-256 in `scripts/fetch-translate.mjs` and checked before it is unpacked; nothing of it is ever committed to this repository.

| Part                                                                | Source                                                      | Licence                                | Text here                                                                                                                                                                                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CTranslate2 4.9.1 (OpenNMT)                                         | `https://github.com/OpenNMT/CTranslate2`, tag `v4.9.1`      | MIT                                    | `CTranslate2-LICENSE.txt`; its compiled headers' notices in `ctranslate2-third-party-headers.txt`: BS_thread_pool, avx/neon/avx512 mathfun, half.hpp and nlohmann's json.hpp (MIT, zlib, BSD-2) |
| ruy (Google), as CTranslate2's tag pins it                          | `https://github.com/google/ruy`, commit `363f2522`          | Apache-2.0                             | `ruy-LICENSE.txt`                                                                                                                                                                               |
| cpuinfo, as ruy pins it, with its bundled clog                      | `https://github.com/pytorch/cpuinfo`, commit `082deffc`     | BSD-2-Clause                           | `cpuinfo-LICENSE.txt`, `clog-LICENSE.txt`                                                                                                                                                       |
| cpu_features (Google, Intel computers only), as CTranslate2 pins it | `https://github.com/google/cpu_features`, commit `8a494eb1` | Apache-2.0                             | `cpu_features-LICENSE.txt`                                                                                                                                                                      |
| spdlog, as CTranslate2 pins it, with its bundled fmt                | `https://github.com/gabime/spdlog`, commit `76fb40d9`       | MIT                                    | `spdlog-LICENSE.txt`, `fmt-LICENSE.txt`                                                                                                                                                         |
| SentencePiece 0.2.1 (Google)                                        | `https://github.com/google/sentencepiece`, release `v0.2.1` | Apache-2.0                             | `sentencepiece-LICENSE.txt`                                                                                                                                                                     |
| SentencePiece's own protobuf-lite, absl and darts-clone             | in SentencePiece's release                                  | BSD-3-Clause, Apache-2.0, BSD-2-Clause | `protobuf-lite-LICENSE.txt`, `abseil-LICENSE.txt`, `darts-clone-LICENSE.txt`                                                                                                                    |

On a Mac the matrix products use Apple's Accelerate (part of macOS) as well. On Windows the C++ runtime is linked into the program.

## The text pipeline around the model

Drashti's own TypeScript (`src/main/translation/`) prepares each sentence and restores the result as IndicTrans2's tools do. It is a port of these, made so its output is the same as theirs:

| Ported from                                                                                                                              | Licence    | Text here                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| IndicTransToolkit 1.1.1 (`IndicProcessor`), Varun Gumma, AI4Bharat                                                                       | MIT        | `IndicTransToolkit-LICENSE.txt`                            |
| indic-nlp-library 0.92 (normaliser, tokeniser, detokeniser, script converter), Anoop Kunchukuttan                                        | MIT        | `indic-nlp-library-LICENSE.txt`                            |
| sacremoses 0.2.0 (English punctuation normaliser, tokeniser, detokeniser; its English non-breaking prefixes come from the Moses toolkit) | MIT        | `sacremoses-LICENSE.txt`                                   |
| Hugging Face Transformers 4.51.3 (the ten-line clean-up after decoding)                                                                  | Apache-2.0 | `sentencepiece-LICENSE.txt` holds the same Apache-2.0 text |

**The models are not bundled.** An admin imports the offline model pack (**Help › Caption and Translation Models…**): IndicTrans2's distilled models by AI4Bharat (MIT), converted for CTranslate2 (int8), each with its source SentencePiece model. Drashti never downloads them.
