# The default opening photo

Drashti's default opening photo is **a photograph of Swamishri**, by **BAPS**. It is in the repository at `resources/opening/default.jpg`, and beside an installed Drashti in its resources' `opening` folder (`electron-builder.yml`, on the Mac and Windows both). With nothing chosen in **File › Opening…** (no photos and no lines, and no opening pack loaded), the opening shows it for its five seconds, coming in and slowly zooming, with no words, name or logo over it (`src/main/opening/opening-photo.ts`). An opening pack, or any photo or line chosen, replaces it.

It is built into Drashti by the owner's decision of 5 November 2026: an exception, for this one photo only, to the project's rule that no darshan pictures go into the repository, made knowing the repository is public. Drashti's tests never show it: every Drashti a test starts shows a placeholder picture the test run makes instead (`tests/e2e/opening-photo.ts`).

| What                                                 | Where it came from | Licence                                                                                  |
| ---------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| The default opening photo, a photograph of Swamishri | BAPS               | BAPS's photograph, under no open licence; built in by the owner's decision of 5 Nov 2026 |

The photograph is BAPS's, credited to BAPS here and in the README. It is not Drashti's own, and is under no open licence and not under Drashti's own terms.
