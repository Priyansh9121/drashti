import { useEffect, useState } from 'react';
import type { StreamProfile } from '../../../shared/stream';
import {
  YOUTUBE_DESCRIPTION_MAX,
  YOUTUBE_PRIVACIES,
  YOUTUBE_PRIVACY_WORDS,
  YOUTUBE_TITLE_MAX,
  YOUTUBE_WORDS,
  type YouTubeBroadcast,
  type YouTubePrivacy,
} from '../../../shared/youtube';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Select, Textarea, TextInput } from '../ui/Field';
import { CalendarDays, RefreshCw } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { SectionTitle } from '../ui/Panel';
import { Loading } from '../ui/States';
import { Toggle } from '../ui/Toggle';
import { usePersistentState } from '../ui/persist';
import { useStream } from './stream-store';
import { connectYouTube, loadUpcoming, useYouTube, youtubeAction } from './youtube-store';
import { linkWords, whenWords } from './youtube-words';

/*
 * Stream settings › YouTube (x31): schedule a YouTube stream from Drashti, its stream key saved into the profile by
 * itself. The admin's own Google project signs in (Set up…: its Client ID and Client secret, typed here and kept in
 * this computer's secure storage), in this computer's own browser. Never a token or a key in this window: the main
 * process keeps them, and tells this window only who is signed in and which broadcast a profile streams to.
 */

function ClientForm({ onDone }: { onDone: () => void }) {
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      data-testid="youtube-client-form"
      onSubmit={(e) => {
        e.preventDefault();
        const typed = { id, secret };
        setSecret('');
        void youtubeAction(() => window.drashti.youtube.setClient(typed.id, typed.secret)).then((r) => {
          if (r.ok) onDone();
          else setMessage(r.message);
        });
      }}
    >
      <Field label="Client ID" hint="From your own Google project: Google Auth Platform › Clients.">
        <TextInput
          value={id}
          autoComplete="off"
          spellCheck={false}
          data-testid="youtube-client-id"
          onChange={(e) => {
            setId(e.target.value);
          }}
        />
      </Field>
      <Field
        label="Client secret"
        hint="Kept in this computer’s secure storage and never shown again."
        error={message}
      >
        <TextInput
          type="password"
          value={secret}
          autoComplete="off"
          spellCheck={false}
          data-testid="youtube-client-secret"
          onChange={(e) => {
            setSecret(e.target.value);
          }}
        />
      </Field>
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={id.trim() === '' || secret.trim() === ''}
          data-testid="youtube-client-save"
        >
          Save
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/** The next whole hour from now, as the date and time fields hold it. */
function nextHour(): { date: string; time: string } {
  const at = new Date();
  at.setMinutes(0, 0, 0);
  at.setHours(at.getHours() + 1);
  const two = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())}`,
    time: `${two(at.getHours())}:${two(at.getMinutes())}`,
  };
}

/** A privacy as the window remembers it. */
const isPrivacy = (v: unknown): v is YouTubePrivacy => YOUTUBE_PRIVACIES.some((p) => p === v);

function ScheduleDialog({ profile, onClose }: { profile: StreamProfile; onClose: () => void }) {
  const inUse = useStream((s) => {
    const st = s.status;
    const active = s.profiles?.activeId === profile.id;
    return active && st !== null && (st.live.state !== 'off' || st.recording.state !== 'off');
  });
  const start = nextHour();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  // Unlisted to begin with, then the one chosen last on this computer.
  const [privacy, setPrivacy] = usePersistentState<YouTubePrivacy>('youtube.privacy', 'unlisted', isPrivacy);
  const [forKids, setForKids] = useState(false);
  const [useIt, setUseIt] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useYouTube((s) => s.busy);
  const startsAt = new Date(`${date}T${time}`).getTime();
  return (
    <Dialog
      title="Schedule a stream on YouTube"
      subtitle="It appears on your channel as scheduled; it starts when Drashti goes live."
      size="sm"
      onClose={onClose}
      closeLabel="Close Schedule a stream"
      testId="youtube-schedule"
      bodyClassName="space-y-3"
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void youtubeAction(() =>
            window.drashti.youtube.schedule({
              title,
              description,
              startsAt,
              privacy,
              madeForKids: forKids,
              profileId: useIt && !inUse ? profile.id : null,
            }),
          ).then((r) => {
            if (r.ok) {
              onClose();
              void loadUpcoming();
            } else setMessage(r.message);
          });
        }}
      >
        <Field label="Title">
          <TextInput
            value={title}
            maxLength={YOUTUBE_TITLE_MAX}
            data-testid="youtube-title"
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </Field>
        <Field label="Description">
          <Textarea
            value={description}
            rows={3}
            maxLength={YOUTUBE_DESCRIPTION_MAX}
            data-testid="youtube-description"
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <TextInput
              type="date"
              value={date}
              data-testid="youtube-date"
              onChange={(e) => {
                setDate(e.target.value);
              }}
            />
          </Field>
          <Field label="Starts at">
            <TextInput
              type="time"
              value={time}
              data-testid="youtube-time"
              onChange={(e) => {
                setTime(e.target.value);
              }}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Who can watch">
            <Select
              value={privacy}
              data-testid="youtube-privacy"
              onChange={(e) => {
                setPrivacy(YOUTUBE_PRIVACIES.find((p) => p === e.target.value) ?? 'unlisted');
              }}
            >
              {YOUTUBE_PRIVACIES.map((p) => (
                <option key={p} value={p}>
                  {YOUTUBE_PRIVACY_WORDS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Made for children" hint="YouTube asks this of every video.">
            <Select
              value={forKids ? 'yes' : 'no'}
              data-testid="youtube-for-kids"
              onChange={(e) => {
                setForKids(e.target.value === 'yes');
              }}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
          </Field>
        </div>
        <div className="space-y-1">
          <Toggle
            checked={useIt && !inUse}
            disabled={inUse}
            onChange={setUseIt}
            label={`Stream to it from “${profile.name}” (its stream key saved there)`}
            data-testid="youtube-use-it"
          />
          {inUse && (
            <p className="text-xs text-faint">
              This profile is on air or recording, so its key stays as it is: choose Stream to this one after
              it ends.
            </p>
          )}
        </div>
        {message && <Notice tone="danger">{message}</Notice>}
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || title.trim() === '' || !Number.isFinite(startsAt)}
            data-testid="youtube-schedule-save"
          >
            Schedule on YouTube
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

function Upcoming({ profile, inUse }: { profile: StreamProfile; inUse: boolean }) {
  const broadcasts = useYouTube((s) => s.broadcasts);
  const link = useYouTube((s) => s.status?.links[profile.id]);
  const busy = useYouTube((s) => s.busy);
  return (
    <section className="space-y-2" aria-label="Coming up on YouTube" data-testid="youtube-upcoming">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-medium text-muted">Coming up on YouTube</h4>
        <Button
          size="sm"
          icon={RefreshCw}
          disabled={busy}
          onClick={() => void loadUpcoming()}
          data-testid="youtube-refresh"
        >
          Refresh
        </Button>
      </div>
      {broadcasts === null ? null : broadcasts.length === 0 ? (
        <p className="text-xs text-faint">Nothing scheduled on the channel.</p>
      ) : (
        <ul className="space-y-1">
          {broadcasts.map((b: YouTubeBroadcast) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center gap-2 text-sm"
              data-testid="youtube-broadcast"
            >
              <span className="min-w-0 flex-1 truncate">
                {b.title} · {whenWords(b.startsAt)} · {YOUTUBE_PRIVACY_WORDS[b.privacy]}
              </span>
              {link?.broadcastId === b.id ? (
                <span className="text-xs text-success-fg">This profile streams here</span>
              ) : (
                <Button
                  size="sm"
                  disabled={busy || inUse}
                  data-testid="youtube-use"
                  onClick={() =>
                    void youtubeAction(() => window.drashti.youtube.useBroadcast(profile.id, b.id))
                  }
                >
                  Stream to this one
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Stream settings › YouTube, for the profile shown. */
export function YouTubeSettings({ profile }: { profile: StreamProfile }) {
  const status = useYouTube((s) => s.status);
  const busy = useYouTube((s) => s.busy);
  const inUse = useStream((s) => {
    const st = s.status;
    return (
      s.profiles?.activeId === profile.id &&
      st !== null &&
      (st.live.state !== 'off' || st.recording.state !== 'off')
    );
  });
  const [settingUp, setSettingUp] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  useEffect(() => {
    connectYouTube();
  }, []);
  const signedIn = status?.signedIn ?? null;
  useEffect(() => {
    if (signedIn) void loadUpcoming();
  }, [signedIn]);
  const link = status?.links[profile.id];
  return (
    <section className="space-y-2" aria-label="YouTube" data-testid="youtube-settings">
      <SectionTitle>YouTube</SectionTitle>
      {!status ? (
        <Loading />
      ) : (
        <>
          {link && (
            <p className="text-sm" data-testid="youtube-link">
              This profile streams to {linkWords(link)}.
            </p>
          )}
          {status.message && (
            <Notice tone="warning" data-testid="youtube-message">
              {status.message}
            </Notice>
          )}
          {!status.storage.available ? (
            <Notice tone="warning">{status.storage.message}</Notice>
          ) : settingUp || !status.client ? (
            settingUp ? (
              <ClientForm onDone={() => setSettingUp(false)} />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 text-xs text-muted">
                  Schedule YouTube streams from here, each one’s stream key saved into this profile by itself.
                  It needs your own Google project (free): the admin guide, “Scheduling on YouTube”.
                </p>
                <Button size="sm" onClick={() => setSettingUp(true)} data-testid="youtube-set-up">
                  Set up…
                </Button>
              </div>
            )
          ) : !signedIn ? (
            <div className="flex flex-wrap items-center gap-2">
              {status.signingIn ? (
                <>
                  <span className="text-sm" data-testid="youtube-signing-in">
                    Finish signing in in your browser…
                  </span>
                  <Button
                    size="sm"
                    onClick={() => void youtubeAction(() => window.drashti.youtube.cancelSignIn())}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  data-testid="youtube-sign-in"
                  onClick={() => void youtubeAction(() => window.drashti.youtube.signIn())}
                >
                  Sign in to YouTube…
                </Button>
              )}
              <Button size="sm" onClick={() => setSettingUp(true)}>
                Replace the sign-in client…
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void youtubeAction(() => window.drashti.youtube.removeClient())}
              >
                Remove the sign-in client
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-sm" data-testid="youtube-signed-in">
                  Signed in to YouTube: {signedIn.channel}
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  icon={CalendarDays}
                  onClick={() => setScheduling(true)}
                  data-testid="youtube-schedule-open"
                >
                  Schedule a stream…
                </Button>
                <Button
                  size="sm"
                  onClick={() => void youtubeAction(() => window.drashti.youtube.signOut())}
                  data-testid="youtube-sign-out"
                >
                  Sign out
                </Button>
              </div>
              <p className="text-xs text-faint" data-testid="youtube-sign-out-note">
                {YOUTUBE_WORDS.signOutNote}
              </p>
              <Upcoming profile={profile} inUse={inUse} />
            </>
          )}
          {scheduling && <ScheduleDialog profile={profile} onClose={() => setScheduling(false)} />}
        </>
      )}
    </section>
  );
}
