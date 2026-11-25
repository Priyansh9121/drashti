import type { SabhaFlow } from '../../../shared/sabha-flow';
import { FlowNowNext as PanelNowNext } from './FlowViews';

/*
 * Red (a22-flow-next): a stand-in for the one Now and Next up of the operator panel and a paired phone (QA23-FLOW-2):
 * the panel's own, as it was, whatever the size.
 */

export interface FlowNowNextProps {
  flow: SabhaFlow;
  now: number | null;
  size: 'panel' | 'phone';
  onBack?: () => void;
  onNext?: () => void;
  live?: boolean;
}

const nothing = () => undefined;

export function FlowNowNext({ flow, now, onBack, onNext }: FlowNowNextProps) {
  return <PanelNowNext flow={flow} now={now} onBack={onBack ?? nothing} onNext={onNext ?? nothing} />;
}
