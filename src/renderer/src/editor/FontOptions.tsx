import { useEffect, useState } from 'react';
import type { SlideElement } from '../../../shared/model';
import { LOWER_THIRD_FONTS } from '../../../shared/lower-third-fonts';
import { missingFontsOf, substituteFor } from '../render/font-probe';
import { BUNDLED_FAMILIES } from '../render/fonts';

const bundled = new Set([...BUNDLED_FAMILIES, ...LOWER_THIRD_FONTS].map((family) => family.toLowerCase()));

export function SystemFontOptions({ current }: { current?: string | null }) {
  const [families, setFamilies] = useState<readonly string[]>([]);
  useEffect(() => {
    let active = true;
    void window.drashti.slideEditor.fontFamilies().then(
      (names) => {
        if (active) setFamilies(names);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
  const options = families.filter(
    (family) => family.toLowerCase() !== current?.toLowerCase() && !bundled.has(family.toLowerCase()),
  );
  return options.length > 0 ? (
    <optgroup label="On this computer">
      {options.map((family) => (
        <option key={family} value={family}>
          {family}
        </option>
      ))}
    </optgroup>
  ) : null;
}

export function MissingFontNote({ elements }: { elements: readonly SlideElement[] }) {
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void document.fonts.ready.then(() => {
      if (!active) return;
      const missing = new Map<string, string>();
      for (const el of elements) {
        if (el.kind !== 'text') continue;
        for (const name of missingFontsOf(el)) {
          if (!missing.has(name)) missing.set(name, substituteFor(name, el.lang));
        }
      }
      const substitutions = [...missing].map(([name, font]) => font + ' for ' + name).join(', ');
      setNotice(
        substitutions
          ? 'Using ' + substitutions + '. Install ' + [...missing.keys()].join(', ') + ' to match the deck.'
          : '',
      );
    });
    return () => {
      active = false;
    };
  }, [elements]);
  return notice ? (
    <p role="status" className="truncate text-xs text-muted" title={notice}>
      {notice}
    </p>
  ) : null;
}
