# PDF drawing

Drashti draws a PDF's pages as pictures (Session 15: PDF, PowerPoint and Keynote as pictures) with **pdf.js**, installed from npm (`pdfjs-dist`) and bundled into the app at build time. The hidden window that draws is `src/renderer/src/pictures/`; the main process's side is `src/main/pictures/`.

| What                                                                                   | Copyright                           | Licence                                                           | Text                           |
| -------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------- | ------------------------------ |
| pdf.js (`pdfjs-dist`): the code that reads and draws a PDF                             | Mozilla Foundation and contributors | Apache 2.0                                                        | `pdf.js-Apache-2.0.txt`        |
| The standard fonts pdf.js ships for PDFs that name a font without embedding it (Foxit) | PDFium Authors                      | BSD-style                                                         | `Foxit-fonts.txt`              |
| The same, Liberation Sans                                                              | Red Hat and others                  | SIL Open Font License 1.1                                         | `Liberation-fonts-OFL-1.1.txt` |
| Its WebAssembly image decoders: OpenJPEG (JPEG 2000), JBIG2 (PDFium) and qcms (colour) | Their authors (see each file)       | BSD 2-clause, BSD-style, MIT; pdf.js glue under Apache 2.0 or MIT | `wasm-LICENSE_*.txt`           |

The fonts and decoders are copied into the build as they are (`out/renderer/pdfjs/`) with their own licence files beside them, and reach the drawing window through Drashti's bridge, never by fetching.
