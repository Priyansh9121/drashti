import { app, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { gateChannels } from '../ipc/handle';
import { log } from '../log';
import { installLockedMenu } from '../menu';
import { LOCK_REASON_TEXT } from '../../shared/access';
import { sw, swMs } from '../switches';
import { createLockWindow, registerAccessIpc } from './access-ipc';
import { AccessClient, accessSwitches, accessTarget } from './client';
import { electronTransport } from './electron-transport';
import { isLetIn, onAccessChange } from './gate';
import { mayRunWhileLocked } from './locked-requests';
import { accessComputer, computerId } from './identity';
import { AccessService, AskedFile, keptAt, performanceAccessFolder } from './service';
import { AccessStore } from './store';

/*
 * Main behind the lock (Session 54, access by Gmail). Before anything of Drashti opens (its library, the screens,
 * the stream, the phones, the nodes), this computer's access is checked with the list: let in, Drashti opens as it
 * always has; not let in, the lock window. Every request from a window passes the gate from now on (handle.ts), and
 * the menu has Quit and the editing keys only until Drashti opens. A self-test opens at once with its controls
 * locked, and never asks the list.
 */

/** Still checking after this long: the lock window shows, saying so. Let in sooner, it never shows. */
const LOCK_WINDOW_AFTER_MS = 1000;

export interface BehindTheLock {
  service: AccessService;
  /** The list's calls (null with no list to ask): the owner's are made with it too (the Access List, E4). */
  client: AccessClient | null;
  /** Not let in, nor a self-test: nothing may act (the engine's commands, the phones). */
  shut(): boolean;
  /** Check, and open once let in (a self-test opens at once, its controls locked). */
  begin(): void;
}

/** The lock made ready: this computer's id, the list's calls, the requests' gate, the menu with Quit only. */
export async function prepareTheLock(o: {
  version: string;
  selfTest: boolean;
  /** The appearance's window colour, for the lock window. */
  background: () => string;
  /** Whether a request comes from the operator window: a self-test keeps its controls locked. */
  fromOperator: (event: IpcMainInvokeEvent) => boolean;
  /** The operator window, once Drashti has opened: it shows the stop and the countdown. */
  operatorWindow: () => BrowserWindow | null;
  /** Drashti opens (index.ts's start). */
  open: () => void;
  /**
   * The performance check (Session 54, E review): it runs only on a computer let in. Its access is checked with the
   * list as any start's is, from this computer's own data folder (`home`), never its throwaway one; and only once let
   * in does it open and act. Locked, or no answer: `notLetIn` says why, and the check stops.
   */
  performance?: { home: string; notLetIn: (why: string) => void };
}): Promise<BehindTheLock> {
  const userData = app.getPath('userData');
  const perfCheck = o.performance;
  // A self-test asks nothing; the performance check asks as any start does.
  const selfTest = o.selfTest && !perfCheck;
  const accessDir = perfCheck
    ? performanceAccessFolder({
        packaged: app.isPackaged,
        home: perfCheck.home,
        testFolder: sw('DRASHTI_TEST_ACCESS_HOME'),
      })
    : userData;
  const store = new AccessStore(accessDir);
  // Never the keychain at start (E6): the access is a file in the data folder; the computer's id is worked out.
  const computer = selfTest
    ? { ok: false as const, reason: 'a self-test asks nothing' }
    : await computerId({
        platform: process.platform,
        packaged: app.isPackaged,
        switches: accessSwitches,
        // Windows' own folder, where reg.exe is (its MachineGuid), wherever Windows is installed.
        systemRoot: process.env['SystemRoot'],
      });
  const target = selfTest ? null : accessTarget({ packaged: app.isPackaged, switches: accessSwitches });
  let calls: AccessClient | null = null;
  if (target && computer.ok)
    try {
      calls = new AccessClient({
        url: target.url,
        publicKey: target.publicKey,
        local: target.local,
        computer: accessComputer(computer.id, o.version, process.platform),
        transport: electronTransport,
        // Never at or below the last one sent, whatever this computer's clock does (kept in the data folder); this
        // computer's clock when it cannot be kept, never a call that fails to go.
        at: keptAt(
          store,
          () => Date.now(),
          (line) => {
            log.warn(line);
          },
        ),
        ...timeout(),
      });
    } catch (error) {
      log.warn('Access: the access list’s key could not be read', error);
    }
  if (target?.local) log.info('Access: asking the stand-in list on 127.0.0.1 (a test switch)');
  const service = new AccessService({
    calls,
    kept: store,
    asked: new AskedFile(accessDir),
    computer,
    selfTest,
    // The performance check's own run adds nothing to this computer's totals.
    counts: !perfCheck,
    version: o.version,
    // The monotonic clock: the hour without an answer never follows the computer's clock.
    monotonic: () => performance.now(),
    now: () => Date.now(),
    setTimer: (ms, run) => {
      const t = setTimeout(run, ms);
      return () => {
        clearTimeout(t);
      };
    },
    log: (level, message) => {
      log[level](message);
    },
    ...testTimes(),
  });

  let lockWindow: BrowserWindow | null = null;
  let opened = false;
  registerAccessIpc({
    service,
    quit: () => {
      app.quit();
    },
    windows: () => [lockWindow, o.operatorWindow()],
  });
  // Every request from a window, from now on: while not let in, the lock screen's and Quit, and Drashti's own screens'
  // reads and reports (locked-requests.ts), never the operator window's.
  gateChannels(
    (channel, event) =>
      isLetIn() ||
      mayRunWhileLocked(channel, {
        url: event.senderFrame?.url ?? '',
        operatorWindow: o.fromOperator(event),
      }),
  );
  installLockedMenu();

  const begin = () => {
    if (selfTest) {
      service.start();
      o.open();
      return;
    }
    if (perfCheck) {
      beginPerformance(perfCheck.notLetIn);
      return;
    }
    beginLocked();
  };
  /** The performance check: open once let in; locked or no answer, say why and stop (never the lock window). */
  const beginPerformance = (notLetIn: (why: string) => void) => {
    let said = false;
    onAccessChange((state) => {
      if (opened || said) return;
      if (state.phase === 'in' || state.phase === 'warning') {
        opened = true;
        log.info('Access: let in: the performance check runs');
        o.open();
      } else if (state.phase === 'locked') {
        said = true;
        notLetIn(
          state.reason === null
            ? 'This computer is not let in: let it in first (Request Access, or I Have a Token), then run the performance check again.'
            : LOCK_REASON_TEXT[state.reason],
        );
      }
    });
    service.start();
  };
  const beginLocked = () => {
    const showLock = () => {
      if (opened || lockWindow) return;
      lockWindow = createLockWindow(o.background());
      lockWindow.on('closed', () => {
        lockWindow = null;
        // Closed before Drashti opened: Drashti quits, as it does when its window closes.
        if (!opened) app.quit();
      });
    };
    app.on('second-instance', () => {
      if (!lockWindow || lockWindow.isDestroyed()) return;
      if (lockWindow.isMinimized()) lockWindow.restore();
      lockWindow.focus();
    });
    const lockAfter = setTimeout(showLock, LOCK_WINDOW_AFTER_MS);
    onAccessChange((state) => {
      if (opened) return;
      if (state.phase === 'in' || state.phase === 'warning') {
        opened = true;
        clearTimeout(lockAfter);
        log.info('Access: let in: Drashti opens');
        o.open();
        // Once the operator window is there: closing the last window would quit.
        const was = lockWindow;
        setTimeout(() => {
          if (was && !was.isDestroyed()) was.close();
        }, 0);
      } else if (state.phase === 'locked') {
        clearTimeout(lockAfter);
        showLock();
      }
    });
    service.start();
  };
  return { service, client: calls, shut: () => !selfTest && !isLetIn(), begin };
}

/** Tests only (never a packaged Drashti): each call's time limit, shorter. */
function timeout(): { timeoutMs?: number } {
  const ms = swMs('DRASHTI_TEST_ACCESS_TIMEOUT_MS');
  return ms === null ? {} : { timeoutMs: ms };
}

/** Tests only (never a packaged Drashti): checks more often, and the stop sooner, so a test need not wait minutes. */
function testTimes(): { checkEveryMs?: number; stopAfterMs?: number } {
  const every = swMs('DRASHTI_TEST_ACCESS_CHECK_MS');
  const stop = swMs('DRASHTI_TEST_ACCESS_STOP_MS');
  return {
    ...(every === null ? {} : { checkEveryMs: every }),
    ...(stop === null ? {} : { stopAfterMs: stop }),
  };
}
