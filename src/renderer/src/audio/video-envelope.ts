import { videoSoundGain, type Sound } from './sounds';

const scheduled = new WeakMap<GainNode, string>();

/** The audio render thread runs the entire fade, independent of timers on a busy page. */
export function applyVideoEnvelope(node: GainNode, sound: Sound, now: number): void {
  const fade = sound.envelope?.fade;
  const signature = JSON.stringify([
    sound.prepared ?? false,
    sound.envelope?.role,
    fade?.id,
    fade?.at,
    fade?.durationMs,
    fade?.pausedAt,
    node.context.state,
  ]);
  if (scheduled.get(node) === signature) return;
  scheduled.set(node, signature);
  const time = node.context.currentTime;
  const gain = node.gain;
  gain.cancelScheduledValues(time);
  gain.setValueAtTime(videoSoundGain(sound, now), time);
  if (!fade || sound.prepared || fade.pausedAt !== undefined || now >= fade.at + fade.durationMs) return;
  const target = sound.envelope?.role === 'out' ? 0 : 1;
  if (now < fade.at) gain.setValueAtTime(1 - target, time + (fade.at - now) / 1000);
  if (fade.durationMs > 0)
    gain.linearRampToValueAtTime(target, time + (fade.at + fade.durationMs - now) / 1000);
  else gain.setValueAtTime(target, time + (fade.at - now) / 1000);
}
