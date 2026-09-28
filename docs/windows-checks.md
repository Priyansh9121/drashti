# Windows hand checks for the parallel run

Automated tests run on a Windows runner with one virtual display, no taskbar interaction, no notifications and no real screens. These checks cover what they can't see. Do them on the mandir's Windows PC, with the real screens connected, during the first parallel-run evenings (PLAN.md section 5.1). ProPresenter stays installed as the fallback.

Record each result as **Pass**, **Fail** (write what you saw) or **N/A**. A failure in sections 1 to 5 blocks the first live sabha on this PC.

**Before you start**

- Note the Windows version and build: Start, type `winver`, press Enter.
- Note the display setup: Settings, then System, then Display. For each display, write down its resolution, refresh rate (Advanced display) and scale (100%, 125%, 150%...).
- Set up the screens in Drashti as they will be used for a sabha, and put a slide live.

## 1. Taskbar and other windows over the outputs

| #   | Check                                                                                                                        | Expected                                                                                | Result |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| 1.1 | If the taskbar shows on all displays (Settings, then Personalization, then Taskbar behaviours), look at each output display. | No taskbar on any output display while Drashti shows there.                             |        |
| 1.2 | Click the taskbar on the operator display, open the Start menu, then close it.                                               | The outputs stay on top, with no taskbar or Start menu on them.                         |        |
| 1.3 | With an auto-hiding taskbar, move the mouse to the bottom edge of an output display.                                         | The taskbar does not slide up over the output.                                          |        |
| 1.4 | Open another app (for example Notepad) and drag it onto an output display.                                                   | It stays behind the output.                                                             |        |
| 1.5 | Press Win+Tab (Task View) and Alt+Tab, then close them.                                                                      | Outputs are unchanged afterwards. The output windows do not appear in the Alt+Tab list. |        |
| 1.6 | Press Win+D (show desktop), then click back into Drashti.                                                                    | Outputs keep showing the live slide.                                                    |        |

## 2. Focus

| #   | Check                                                                                  | Expected                                                                                                                        | Result |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2.1 | Open Screens and turn an output off and on again. Then press the right arrow.          | The slide moves on. Opening an output never takes the keyboard away from the operator window.                                   |        |
| 2.2 | Click on an output display. Then press the right arrow.                                | The slide moves on. Clicking an output does not take focus.                                                                     |        |
| 2.3 | Unplug an output cable for 5 seconds, then plug it back in.                            | The screen shows "Display not connected" in Screens, then the output comes back by itself. The operator window keeps focus.     |        |
| 2.4 | Drag the operator window onto an output display and let go.                            | The operator window moves back to a free display.                                                                               |        |
| 2.5 | Put an output on the operator's display (Drashti asks first), then press Ctrl+Shift+U. | The covering output turns off and the controls are back. Try it once with Drashti not the active app (click the desktop first). |        |

## 3. Mixed DPI and scaling

Do these if the displays have different scale settings, or set one to 125% for the test and put it back afterwards.

| #   | Check                                                                                       | Expected                                                                                         | Result |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ |
| 3.1 | Look at each output closely, especially the edges.                                          | Each output fills its display exactly, with no gap, border or strip of desktop.                  |        |
| 3.2 | Compare Drashti's Screens panel with Windows' display settings.                             | Pixel sizes match the resolution Windows reports, and the scale matches (125% shows as 1.25x).   |        |
| 3.3 | Look at small Gujarati and Devanagari text on a 100% display and on a 125% or 150% display. | Text is sharp on both. Conjuncts and vowel signs look right.                                     |        |
| 3.4 | Change one display's scale while an output shows on it.                                     | Within a second the output resizes to fill the display again.                                    |        |
| 3.5 | Press Win+P and switch between Extend and Duplicate, then back to Extend.                   | In Duplicate mode, Drashti sees one display. Back in Extend, each screen returns to its display. |        |

## 4. Sleep, screen saver and power

| #   | Check                                                                                                                                                     | Expected                                                                              | Result |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| 4.1 | Set "Turn off my screen after" to 1 minute (Settings, then System, then Power). Leave an output showing for 5 minutes without touching anything.          | Screens stay on and don't dim.                                                        |        |
| 4.2 | Turn on a screen saver with a 1-minute wait (Settings, then Personalization, then Lock screen, then Screen saver). Wait 5 minutes with an output showing. | The screen saver does not start.                                                      |        |
| 4.3 | Turn every output off in Screens and wait 2 minutes.                                                                                                      | The screen turns off as normal: Drashti only blocks sleep while an output is showing. |        |
| 4.4 | Check the power plan and the "Active hours" for Windows Update.                                                                                           | Windows Update cannot restart the PC during sabha times.                              |        |
| 4.5 | Put back the power, screen-saver and scale settings you changed.                                                                                          |                                                                                       |        |

## 5. Notifications and pop-ups

| #   | Check                                                                                 | Expected                                                                        | Result |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| 5.1 | With an output showing, set a 1-minute timer in the Clock app and let it ring.        | Note where the notification appears. It should not appear on an output display. |        |
| 5.2 | Turn on Do not disturb (Windows 11) or Focus assist (Windows 10) and repeat 5.1.      | No notification appears anywhere. Recommend this for every sabha.               |        |
| 5.3 | Check the antivirus and any vendor update tools (graphics driver, printer, OneDrive). | Their pop-ups are turned off, or they only appear on the operator display.      |        |

## 6. Installing the unsigned build

| #   | Check                                                                   | Expected                                                                                                                                                                             | Result |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 6.1 | Run the Drashti installer from CI.                                      | SmartScreen says "Windows protected your PC", because the build is not signed yet. "More info", then "Run anyway", continues. Write down the exact wording for the operators' notes. |        |
| 6.2 | Finish the install without administrator rights.                        | It installs for the current user, and Drashti appears in the Start menu.                                                                                                             |        |
| 6.3 | Start Drashti and set up a screen.                                      | No firewall prompt: Phase 0 opens no network ports.                                                                                                                                  |        |
| 6.4 | Uninstall Drashti (Settings, then Apps).                                | It uninstalls. The library in `%APPDATA%\Drashti` stays, so a reinstall keeps it.                                                                                                    |        |
| 6.5 | Check the Defender history (Windows Security, then Protection history). | Nothing blocked or quarantined.                                                                                                                                                      |        |

## 7. Fallback drill

| #   | Check                                         | Expected                                               | Result |
| --- | --------------------------------------------- | ------------------------------------------------------ | ------ |
| 7.1 | Quit Drashti and start ProPresenter. Time it. | ProPresenter's outputs return in under a minute.       |        |
| 7.2 | Quit Drashti while outputs are showing.       | Drashti asks first, because the screens will go black. |        |

Report failures with the step number, what you saw, and a photo of the screen if possible.
