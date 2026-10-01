import { create } from 'zustand';
import type { PropItem } from '../../../shared/engine/state';
import type { PropInfo } from '../../../shared/props';
import { useEngine } from '../engine/engine-store';
import { dispatch, useNotice } from './actions';

/** The props, and which one is the logo (Simple Mode's Logo button, the L key). */
export const useLogo = create<{ props: PropInfo[] | null; logoId: string | null }>(() => ({
  props: null,
  logoId: null,
}));

let watching = false;

export async function loadProps(): Promise<void> {
  const [props, logoId] = await Promise.all([window.drashti.props.list(), window.drashti.props.getLogo()]);
  useLogo.setState({ props, logoId });
}

/** Keep the props current: they can arrive with an import. */
export function watchProps(): void {
  if (watching) return;
  watching = true;
  window.drashti.library.onChanged(() => void loadProps());
  void loadProps();
}

/** Mark a prop as the logo, or none (Pro Mode). */
export async function markLogo(propId: string | null): Promise<void> {
  const result = await window.drashti.props.setLogo(propId);
  useNotice.setState({ text: result.ok ? null : result.message });
  await loadProps();
}

const asItem = (p: PropInfo): PropItem => ({
  id: p.id,
  name: p.name,
  elements: p.elements,
  width: p.width,
  height: p.height,
});

/** Show the logo instead of the picture, or take it down to bring the picture back. */
export async function toggleLogo(): Promise<void> {
  if (useEngine.getState().state?.logo) {
    await dispatch({ type: 'hideLogo' });
    return;
  }
  // Asked fresh: the logo may have been chosen (or its prop changed) since the list was loaded.
  await loadProps();
  const { props, logoId } = useLogo.getState();
  const logo = props?.find((p) => p.id === logoId);
  if (!logo) {
    useNotice.setState({
      text: 'No logo has been chosen yet. An admin can choose one in Pro Mode: Props, then “Use as the logo”.',
    });
    return;
  }
  await dispatch({ type: 'showLogo', prop: asItem(logo) });
}
