import { create } from 'zustand';

/** Whether the Themes panel is open, and the theme to show first. */
export const useThemesPanel = create<{ open: boolean; pick: string | null }>(() => ({
  open: false,
  pick: null,
}));

export function openThemes(pick: string | null = null): void {
  useThemesPanel.setState({ open: true, pick });
}

export function closeThemes(): void {
  useThemesPanel.setState({ open: false, pick: null });
}

/** A theme from a presentation's first text box (an imported template), shown in the panel. */
export async function themeFromPresentation(presentationId: string): Promise<string | null> {
  const result = await window.drashti.themes.fromPresentation(presentationId);
  if (!result.ok) return result.message;
  openThemes(result.id);
  return null;
}
