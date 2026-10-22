import { BrowserWindow } from 'electron';

/*
 * The performance check's placeholder meeting (Session 48; with DRASHTI_TEST_WINDOW_STANDIN, never in a
 * packaged Drashti): a small window of Drashti's own process, titled "Placeholder meeting", with a moving
 * test pattern (blue, a yellow bar going across, its name), that the stand-in source offers as another app's
 * window (./stand-in-sources.ts). The end-to-end tests open the same kind of window themselves.
 */

export const PLACEHOLDER_MEETING = 'Placeholder meeting';

const PATTERN = `<!doctype html><html><head><meta charset="utf-8"><title>${PLACEHOLDER_MEETING}</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#1d4ed8}#bar{position:absolute;top:35%;left:0;width:20%;height:30%;background:#facc15}p{position:absolute;left:4%;bottom:4%;margin:0;font:32px sans-serif;color:#ffffff}</style></head><body><div id="bar"></div><p>${PLACEHOLDER_MEETING}</p><script>let x=0;setInterval(()=>{x=(x+2)%80;document.getElementById('bar').style.left=x+'%'},40)</script></body></html>`;

/** Open it without taking the focus, its pattern moving. */
export async function openPlaceholderMeeting(): Promise<BrowserWindow> {
  const w = new BrowserWindow({
    width: 640,
    height: 360,
    show: false,
    title: PLACEHOLDER_MEETING,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PATTERN)}`);
  w.showInactive();
  return w;
}
