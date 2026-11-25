import { Fragment, type ReactNode } from 'react';
import type { SimpleFeature } from '../../../shared/simple-features';
import { SIMPLE_FEATURES } from '../../../shared/simple-features';
import { ChatSection } from '../chat/ChatSection';
import { StreamLinkDialog } from '../live-link/StreamLinkDialog';
import { StreamLinkNotice } from '../live-link/StreamLinkNotice';
import { WindowPicker } from '../live-window/WindowPicker';
import { LowerThirdsPanel } from '../lower-thirds/LowerThirdsPanel';
import { MessagesPanel } from '../operator/MessagesPanel';
import { PipDialog } from '../operator/PipDialog';
import {
  PictureInPictureSection,
  ShowAWindowSection,
  StreamLinkSection,
  VideoInputsSection,
} from '../operator/SetupTools';
import { StageMessageControl } from '../operator/StageControls';
import { TimersPanel } from '../operator/TimersPanel';
import { OperateOnly, useSimpleFeatures } from './simple-features-store';

/*
 * Simple Mode's sections of Pro Mode's tools (alpha.22, Edit › Simple Mode Features…): each chosen tool under Audio,
 * in Pro Mode's order, as Pro Mode's own section (the same part, folded at each start as every section under LIVE),
 * inside OperateOnly, so each leaves out what sets it up. A tool turned off in Pro Mode is gone from here.
 */

/** Each tool's section: Pro Mode's own part. */
const SECTION: Record<SimpleFeature, (platform: string) => ReactNode> = {
  stage: () => <StageMessageControl />,
  messages: () => <MessagesPanel />,
  chat: () => <ChatSection />,
  timers: () => <TimersPanel />,
  'lower-thirds': (platform) => <LowerThirdsPanel platform={platform} />,
  'show-a-window': () => <ShowAWindowSection />,
  'show-a-stream-link': () => <StreamLinkSection />,
  'video-inputs': () => <VideoInputsSection />,
  'picture-in-picture': () => <PictureInPictureSection />,
  // The Sabha flow (alpha.23) is at the top of the left column, as in Pro Mode (SimpleApp.tsx), not under Audio.
  'sabha-flow': () => null,
};

/** The chosen tools' sections, after Simple Mode's Audio; none chosen, nothing. */
export function SimpleFeatureSections({ platform }: { platform: string }) {
  const chosen = useSimpleFeatures((s) => s.chosen);
  return (
    <OperateOnly.Provider value={true}>
      {SIMPLE_FEATURES.filter((f) => chosen.includes(f.id)).map((f) => (
        <Fragment key={f.id}>{SECTION[f.id](platform)}</Fragment>
      ))}
    </OperateOnly.Provider>
  );
}

/**
 * The windows a chosen tool opens from its section (Show a Window…, Show a Stream Link…, Picture in Picture…), Pro
 * Mode's own, inside OperateOnly too.
 */
export function SimpleFeatureDialogs() {
  const chosen = useSimpleFeatures((s) => s.chosen);
  return (
    <OperateOnly.Provider value={true}>
      {chosen.includes('show-a-window') && <WindowPicker />}
      {chosen.includes('show-a-stream-link') && <StreamLinkDialog />}
      {chosen.includes('picture-in-picture') && <PipDialog />}
    </OperateOnly.Provider>
  );
}

/** A stream link that stopped or could not start, said in the flow as in Pro Mode, while its tool is chosen. */
export function SimpleFeatureNotices() {
  const link = useSimpleFeatures((s) => s.chosen.includes('show-a-stream-link'));
  return link ? <StreamLinkNotice /> : null;
}
