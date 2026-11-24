# PDF copy crop writer

pdf-lib 1.17.1 (MIT), https://github.com/Hopding/pdf-lib, writes only the CropBox on the newly assembled PDF copy in the hidden export renderer. Its dependency notices are included here:

- @pdf-lib/standard-fonts 1.0.0: MIT (standard-fonts-MIT.txt).
- @pdf-lib/upng 1.0.1: MIT (upng-MIT.txt).
- pako 1.0.11: MIT (pako-MIT.txt) and the zlib port notice (pako-Zlib.txt).
- tslib 1.14.1 (pdf-lib's helper) and 2.8.1: 0BSD (tslib-0BSD.txt and tslib-CopyrightNotice.txt and tslib-1-CopyrightNotice.txt).

The licence texts are copied from the installed packages. The zlib notice is transcribed without comment markers from pako/lib/zlib/deflate.js. No library code is vendored here. The renderer build bundles the writer from node_modules into out/renderer, which electron-builder packages through out/**/*; electron-builder also copies this entire LICENSES directory to licenses on Mac and Windows.
