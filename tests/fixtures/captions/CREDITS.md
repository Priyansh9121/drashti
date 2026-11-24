# Credits for the generated test speech

The clips in `gu/` and `hi/` are synthetic speech of placeholder sentences written for Drashti's tests: everyday
announcements, times and numbers. No real person speaks them and nothing in them was recorded. The captions bench
(`scripts/captions-bench.mjs`) plays them to Drashti's caption engines on CI. The voices' author asks that nobody uses
them to pass anyone off as the original speakers or to mislead people. Please respect that if you reuse them.

`manifest.json` lists each clip: its words (as spoken, and with digits where a number is said), which voice and
model revision spoke it, its seed, its size and its SHA-256.

## Gujarati (`gu/`): Indic Tiny TTS: Gujarati

- Model: **Indic Tiny TTS: Gujarati** by Sulabh Katiyar,
  <https://huggingface.co/sulabhkatiyar/indic-tiny-tts-gujarati>, revision
  `9d5f657f9e525ccd45a48b3f1c39b7302548ef6e`. Its acoustic model weights are licensed under the Creative Commons
  Attribution 4.0 International licence (CC-BY-4.0, <https://creativecommons.org/licenses/by/4.0/>). Its code is
  under the MIT licence.
- Voices: female (`gu_F`) and male (`gu_M`), trained on the Gujarati part of the **Rasa** dataset by AI4Bharat
  (CC-BY-4.0, <https://huggingface.co/datasets/ai4bharat/Rasa>): Praveen Srinivasa Varadhan, Ashwin Sankar, Giri Raju
  and Mitesh M. Khapra, "Rasa: Building Expressive Speech Synthesis Systems for Indian Languages in Low-resource
  Settings", INTERSPEECH 2024.
- Vocoder: the pretrained **Vocos** weights `charactr/vocos-mel-24khz` (revision
  `0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21`), MIT licence, trained by their authors on LibriTTS (CC-BY-4.0).

## Hindi (`hi/`): Indic Tiny TTS: Hindi

- Model: **Indic Tiny TTS: Hindi** by Sulabh Katiyar, <https://huggingface.co/sulabhkatiyar/indic-tiny-tts-hindi>,
  revision `1fb1b108ee6ffb73ee74bd68b283ec13eb39e957`. Its acoustic model weights are licensed under CC-BY-4.0
  (<https://creativecommons.org/licenses/by/4.0/>). Its code is under the MIT licence.
- Voices: female (`hi_F`) and male (`hi_M`), trained on the Hindi part of the **Rasa** dataset by AI4Bharat
  (CC-BY-4.0, as above).
- Vocoder: the same Vocos weights, MIT licence.

## What was done

Each model spoke each sentence once per voice: its ONNX graphs on ONNX Runtime 1.31.0, CPU, with a fixed seed (the same
seed gives the same bytes). Its 24 kHz output was then converted to 16 kHz mono 16-bit WAV with FFmpeg. Nothing else was
changed: no editing, mixing or added sound.

## English

Nothing is stored for English. When the bench runs, CI's Windows runner speaks the same 12 sentences (`english` in
`manifest.json`) with its own Windows voice. Those clips are used for timing only and are never kept or uploaded.
