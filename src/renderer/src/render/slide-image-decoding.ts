import { createContext } from 'react';

/** A pictures-first slide paints loaded images with its other content, even after a decoded copy was discarded. */
export const SlideImageDecoding = createContext<'sync' | undefined>(undefined);
