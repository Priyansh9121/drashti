import { useEffect, useState } from 'react';
import { type AccessView, LOCK_REASON_TEXT } from '../../../shared/access';
import { Button } from '../ui/Button';
import { Field, TextInput } from '../ui/Field';
import { Mark } from '../ui/Mark';
import { Notice } from '../ui/Notice';
import { Loading } from '../ui/States';
import { TabPanel, Tabs } from '../ui/Tabs';
import { act, connectAccess, useAccess } from './access-store';

/*
 * The lock screen (Session 54, access by Gmail), before Drashti opens on a computer not let in: Request Access with
 * a Gmail (the approver is emailed; what came of it is shown here, a rejection plainly), or I Have a Token (the
 * Gmail and the token from its email, once). With no answer from the list, Try Again. Quit always works. The main
 * process checks everything again and decides; this page shows its view.
 */

type Way = 'request' | 'token';

const TABS = [
  { id: 'request' as const, label: 'Request Access' },
  { id: 'token' as const, label: 'I Have a Token' },
];

/** What the lock screen says first, for why this computer is not let in. */
function reasonLine(view: AccessView): string {
  if (view.reason) return LOCK_REASON_TEXT[view.reason];
  return 'Drashti opens once this computer is let in. Ask for access with your Gmail; when it is approved, a token comes to your email: type it under I Have a Token.';
}

export function LockApp() {
  const view = useAccess((s) => s.view);
  const [chosen, setWay] = useState<Way | null>(null);
  const [typed, setGmail] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  useEffect(() => {
    connectAccess();
  }, []);
  // The Gmail of a request made before, until another is typed.
  const gmail = typed ?? view?.request?.gmail ?? '';
  // Approved: the token is the next step, until the person chooses.
  const approved = view?.request?.status === 'approved' && view.request.tokenWaiting;
  const way: Way = chosen ?? (approved ? 'token' : 'request');
  if (view === null) return null;
  const busy = view.busy !== null;
  const closed =
    view.phase !== 'locked' ||
    view.reason === 'self-test' ||
    view.reason === 'no-list' ||
    view.reason === 'no-computer-id';
  const message = view.message;
  const fieldError = (field: 'gmail' | 'token') =>
    message?.field === field && message.tone !== 'success' ? message.text : null;
  const gmailField = (
    <Field label="Your Gmail" error={fieldError('gmail')}>
      <TextInput
        type="email"
        autoComplete="email"
        spellCheck={false}
        value={gmail}
        disabled={busy}
        data-testid="access-gmail"
        className="h-10 text-base"
        onChange={(e) => {
          setGmail(e.target.value);
        }}
      />
    </Field>
  );
  return (
    <main className="h-full overflow-y-auto bg-ink text-fg" data-testid="access-lock" data-phase={view.phase}>
      <div className="mx-auto max-w-xl space-y-5 px-6 py-6">
        <header className="space-y-2">
          <p className="flex items-center gap-2.5 text-base font-bold tracking-wide text-muted">
            <Mark size={28} />
            Drashti
          </p>
          <h1 className="text-2xl font-bold">Let this computer in</h1>
        </header>
        {view.phase === 'checking' ? (
          <Loading label="Checking this computer’s access…" immediate />
        ) : (
          <Notice
            tone={view.reason === null ? 'info' : 'warning'}
            role={view.reason === null ? 'status' : 'alert'}
            data-testid="access-reason"
            data-reason={view.reason ?? ''}
          >
            {reasonLine(view)}
          </Notice>
        )}
        {view.canRetry && (view.reason === 'no-answer' || view.reason === 'unknown') && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="lg"
              disabled={busy}
              data-testid="access-retry"
              onClick={() => void act(() => window.drashti.access.retry())}
            >
              {view.busy === 'checking' ? 'Checking…' : 'Try Again'}
            </Button>
            {view.reason === 'no-answer' && (
              <p className="text-sm text-muted">It also tries again by itself every 15 seconds.</p>
            )}
          </div>
        )}
        {!closed && (
          <section className="space-y-4" aria-label="Let this computer in">
            <Tabs
              group="access"
              label="How to let this computer in"
              items={TABS}
              value={way}
              onChange={setWay}
            />
            {way === 'request' ? (
              <TabPanel group="access" id="request">
                <form
                  className="space-y-3"
                  data-testid="access-request-form"
                  // Drashti checks the Gmail itself and says what is wrong on its field, in its own words: the
                  // browser's own check of an email field would stop the request unsaid, with its own bubble.
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(() => window.drashti.access.request(gmail, name));
                  }}
                >
                  {gmailField}
                  <Field
                    label="Your name (optional)"
                    hint="So the person who approves access knows who asks."
                  >
                    <TextInput
                      autoComplete="name"
                      value={name}
                      disabled={busy}
                      data-testid="access-name"
                      className="h-10 text-base"
                      onChange={(e) => {
                        setName(e.target.value);
                      }}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="submit"
                      variant="primary"
                      size="lg"
                      disabled={busy}
                      data-testid="access-request"
                    >
                      {view.busy === 'requesting' ? 'Asking…' : 'Request Access'}
                    </Button>
                    {view.request && (
                      <Button
                        variant="secondary"
                        size="lg"
                        disabled={busy}
                        data-testid="access-check-request"
                        onClick={() => void act(() => window.drashti.access.status())}
                      >
                        {view.busy === 'asking' ? 'Asking…' : 'Check Again'}
                      </Button>
                    )}
                  </div>
                </form>
              </TabPanel>
            ) : (
              <TabPanel group="access" id="token">
                <form
                  className="space-y-3"
                  data-testid="access-token-form"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(() => window.drashti.access.redeem(gmail, token));
                  }}
                >
                  {gmailField}
                  <Field
                    label="Token"
                    hint="From your email: 28 letters and digits in groups of four. It works once, on this computer."
                    error={fieldError('token')}
                  >
                    <TextInput
                      autoComplete="off"
                      spellCheck={false}
                      value={token}
                      disabled={busy}
                      data-testid="access-token"
                      className="h-10 font-mono text-base"
                      onChange={(e) => {
                        setToken(e.target.value);
                      }}
                    />
                  </Field>
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={busy}
                    data-testid="access-redeem"
                  >
                    {view.busy === 'redeeming' ? 'Letting it in…' : 'Let This Computer In'}
                  </Button>
                </form>
              </TabPanel>
            )}
          </section>
        )}
        {message && !message.field && (
          <Notice tone={message.tone} data-testid="access-message">
            {message.text}
          </Notice>
        )}
        {message?.field && message.tone === 'success' && (
          <Notice tone="success" data-testid="access-message">
            {message.text}
          </Notice>
        )}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <Button
            variant="secondary"
            size="lg"
            data-testid="access-quit"
            onClick={() => void window.drashti.access.quit()}
          >
            Quit Drashti
          </Button>
          <span className="text-sm text-faint" data-testid="access-version">
            Drashti {view.version}
          </span>
        </footer>
      </div>
    </main>
  );
}
