import { createContext, useContext } from 'react';
import { mediaUrl } from '../../../shared/media';

/*
 * Where the screens fetch a picture from: the media library, except while the GPU warms up (Session 27,
 * render/WarmUp.tsx), which draws placeholder pictures of its own, made in the page, through the same
 * components the show uses.
 */

export const MediaUrls = createContext<(mediaId: string, attempt?: number) => string>(mediaUrl);

export const useMediaUrl = (): ((mediaId: string, attempt?: number) => string) => useContext(MediaUrls);
