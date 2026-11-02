import { useEffect, useState } from 'react';
import { slideEditorTitle, SLIDE_EDITOR_TITLE } from '../../../../shared/slide-edit';
import { connectEngine } from '../../engine/engine-store';
import { loadMedia, selectPresentation } from '../../library/library-store';
import { connectPictureLooks } from '../../render/picture-looks';
import { connectScreens } from '../../screens/screens-store';
import { connectInputsList } from '../../video-inputs/video-inputs-store';
import { isTyping } from '../../operator/useKeymap';
import { openSlideEditor, setCloseWindow, useEditor } from '../editor-store';
import { keepCopiesWith, setCopied } from '../clipboard';
import { SlideEditor } from '../SlideEditor';
import { redoAny, undoAny } from '../TextBoxEditor';
import { closeAsked, editAsked, editorHasChanges } from './editor-events';

/*
 * The slide editor's window (Session 55, Part 17a): opened on the presentation and slide its address names, told by
 * the main process of another while open (asking first when this one has changes), saying whether it has changes not
 * saved so closing the window asks first, and closed when the editor closes (saved, thrown away, or closed with none).
 * The application menu's Undo and Redo reach it while it has the keyboard.
 */

export function EditorWindow() {
  const [platform, setPlatform] = useState('darwin');
  const name = useEditor((s) => s.open?.name ?? '');
  const dirty = useEditor(editorHasChanges);

  useEffect(() => {
    connectEngine();
    connectScreens();
    connectInputsList();
    connectPictureLooks();
    void window.drashti.app.getInfo().then((info) => {
      setPlatform(info.platform);
    });
    // Closed once the key or click that closed the editor is done with (a key's coming up never meets a page gone).
    setCloseWindow(() => {
      setTimeout(() => {
        void window.drashti.slideEditor.close();
      }, 0);
    });
    // What was copied in an editor window before this one pastes here; what is copied here is kept for the next.
    keepCopiesWith((copied) => {
      void window.drashti.slideEditor.copy(copied);
    });
    void window.drashti.slideEditor.copied().then((copied) => {
      if (copied) setCopied(copied);
    });
    const query = new URLSearchParams(location.search);
    const presentationId = query.get('presentation');
    if (presentationId) void openSlideEditor(presentationId, '', query.get('slide'));
    // The library's pictures, videos and sounds, as files come and go (an import while the slides are edited).
    const offLibrary = window.drashti.library.onChanged((what) => {
      if (what === 'presentations') void loadMedia();
    });
    const offEdit = window.drashti.slideEditor.onEdit(editAsked);
    const offAsk = window.drashti.slideEditor.onAskClose(closeAsked);
    // Edit › Undo and Redo while this window has the keyboard: typing in a field undoes itself.
    const offUndo = window.drashti.app.onUndo(() => {
      if (!isTyping(document.activeElement)) undoAny();
    });
    const offRedo = window.drashti.app.onRedo(() => {
      if (!isTyping(document.activeElement)) redoAny();
    });
    return () => {
      offLibrary();
      offEdit();
      offAsk();
      offUndo();
      offRedo();
    };
  }, []);

  // Closing the window with changes not saved asks first (main holds it open while this says so).
  useEffect(() => {
    void window.drashti.slideEditor.dirty(dirty);
  }, [dirty]);

  // The library's own copy of the presentation: the names of files its slides play that the library's list leaves out
  // (a sound deleted from Media is still named: Session 54 review).
  const presentationId = useEditor((s) => s.open?.presentationId ?? null);
  useEffect(() => {
    if (presentationId) void selectPresentation(presentationId);
  }, [presentationId]);

  // The window's name: the presentation's, once its slides are read.
  useEffect(() => {
    document.title = name ? slideEditorTitle(name) : SLIDE_EDITOR_TITLE;
  }, [name]);

  return <SlideEditor platform={platform} />;
}
