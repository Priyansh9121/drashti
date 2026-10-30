import { useEffect, useState } from 'react';
import { slideEditorTitle, SLIDE_EDITOR_TITLE } from '../../../../shared/slide-edit';
import { connectEngine } from '../../engine/engine-store';
import { connectPictureLooks } from '../../render/picture-looks';
import { connectScreens } from '../../screens/screens-store';
import { connectInputsList } from '../../video-inputs/video-inputs-store';
import { isTyping } from '../../operator/useKeymap';
import {
  askBeforeClosing,
  isDirty,
  openSlideEditor,
  setCloseWindow,
  switchTo,
  useEditor,
} from '../editor-store';
import { SlideEditor } from '../SlideEditor';
import { redoAny, undoAny } from '../TextBoxEditor';

/*
 * The slide editor's window (Session 55, Part 17a): opened on the presentation and slide its address names, told by
 * the main process of another while open (asking first when this one has changes), saying whether it has changes not
 * saved so closing the window asks first, and closed when the editor closes (saved, thrown away, or closed with none).
 * The application menu's Undo and Redo reach it while it has the keyboard.
 */

export function EditorWindow() {
  const [platform, setPlatform] = useState('darwin');
  const name = useEditor((s) => s.open?.name ?? '');
  const dirty = useEditor(isDirty);

  useEffect(() => {
    connectEngine();
    connectScreens();
    connectInputsList();
    connectPictureLooks();
    void window.drashti.app.getInfo().then((info) => {
      setPlatform(info.platform);
    });
    setCloseWindow(() => {
      void window.drashti.slideEditor.close();
    });
    const query = new URLSearchParams(location.search);
    const presentationId = query.get('presentation');
    if (presentationId) void openSlideEditor(presentationId, '', query.get('slide'));
    const offEdit = window.drashti.slideEditor.onEdit((open) => {
      switchTo(open);
    });
    const offAsk = window.drashti.slideEditor.onAskClose(askBeforeClosing);
    // Edit › Undo and Redo while this window has the keyboard: typing in a field undoes itself.
    const offUndo = window.drashti.app.onUndo(() => {
      if (!isTyping(document.activeElement)) undoAny();
    });
    const offRedo = window.drashti.app.onRedo(() => {
      if (!isTyping(document.activeElement)) redoAny();
    });
    return () => {
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

  // The window's name: the presentation's, once its slides are read.
  useEffect(() => {
    document.title = name ? slideEditorTitle(name) : SLIDE_EDITOR_TITLE;
  }, [name]);

  return <SlideEditor platform={platform} />;
}
