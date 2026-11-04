import { SpeechHelperSwitches } from './AiSpeech';
import type { AiFeature } from '../../../shared/ai';
import { useMode } from '../operator/mode-store';
import { Dialog } from '../ui/Dialog';
import { Notice } from '../ui/Notice';
import { Checkbox } from '../ui/Toggle';
import { setAi, useAi } from './ai-store';
const choices: { key: AiFeature; name: string; detail: string }[] = [
  {
    key: 'search',
    name: 'Meaning and spelling search (Trial). Can slow the screens while on.',
    detail: 'Find library material by meaning, misspellings or Gujarati in English letters.',
  },
  {
    key: 'tidy',
    name: 'Import suggestions (Trial). Can slow the screens while on.',
    detail: 'Review slide breaks and Roman letters for pasted lyrics. Undo restores your input.',
  },
  {
    key: 'playlist',
    name: 'Playlist suggestions (Trial). Can slow the screens while on.',
    detail: 'Review a coming sabha from your calendar and chosen past sabhas.',
  },
];
export function AiDialog() {
  const { open, settings, saving, problem } = useAi();
  const pro = useMode((s) => s.mode === 'pro');
  if (!open || !pro) return null;
  return (
    <Dialog title="AI helpers" onClose={() => useAi.setState({ open: false })}>
      <p className="text-sm text-muted">
        Suggestions stay here for you to review. Books stay as loaded. Each helper works offline on this
        computer.
      </p>
      <div className="space-y-4 py-3">
        {choices.map((choice) => (
          <div key={choice.key}>
            <Checkbox
              label={choice.name}
              checked={settings[choice.key]}
              disabled={saving}
              onChange={(e) => void setAi({ ...settings, [choice.key]: e.target.checked })}
            />
            <p className="pl-6 text-xs text-muted">{choice.detail}</p>
          </div>
        ))}
      </div>
      <SpeechHelperSwitches />
      <p className="text-xs text-muted">Helpers are off until you switch them on. Your choices are saved.</p>
      {problem && <Notice tone="danger">{problem}</Notice>}
    </Dialog>
  );
}
