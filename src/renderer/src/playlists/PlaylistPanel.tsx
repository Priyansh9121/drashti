import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import type { PlaylistNode } from '../../../shared/playlists';
import { Badge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import {
  BookTemplate,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  ListMusic,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from '../ui/icons';
import type { MenuEntry, MenuPlace } from '../ui/Menu';
import { isMenuKey, Menu, MenuButton, menuBelow, menuPlace } from '../ui/Menu';
import { Notice } from '../ui/Notice';
import { rowClass } from '../ui/ListRow';
import { EmptyState } from '../ui/States';
import { TabPanel, Tabs } from '../ui/Tabs';
import { Truncate } from '../ui/Truncate';
import { RowDelete, RowRename } from '../ui/RowDelete';
import { useExtras } from '../library/extras-store';
import { useWhatIsThis } from '../help/WhatIsThis';
import { plural } from '../ui/text';
import { droppedPaths, hasFiles } from './drag';
import { droppedItems, fromLibrary, isRemoveKey, RenameField } from './playlist-shared';
import {
  AddSlotDialog,
  EditSlotDialog,
  FillSlotDialog,
  SaveTemplateDialog,
  TimerCuesDialog,
} from './TemplateDialogs';
import {
  addFromLibrary,
  createNode,
  dismissProblem,
  importIntoPlaylist,
  newFromTemplate,
  openPlaylist,
  renameNode,
  requestRemoveNode,
  selectNode,
  setView,
  startRenaming,
  stopRenaming,
  toggleFolder,
  usePlaylists,
} from './playlist-store';

// ---- the tree of playlists and folders ------------------------------------------------

function nodeMenu(node: PlaylistNode): MenuEntry[] {
  const rename = { label: 'Rename…', icon: Pencil, onSelect: () => startRenaming(node.id) };
  if (node.template)
    return [
      { label: 'Open', icon: BookTemplate, onSelect: () => void openPlaylist(node.id) },
      { label: 'New playlist from this', icon: ListPlus, onSelect: () => void newFromTemplate(node.id) },
      rename,
      {
        label: 'Delete…',
        icon: Trash2,
        danger: true,
        separatorBefore: true,
        onSelect: () => requestRemoveNode(node.id),
      },
    ];
  const remove = {
    label: 'Delete…',
    icon: Trash2,
    danger: true,
    separatorBefore: true,
    onSelect: () => requestRemoveNode(node.id),
  };
  if (!node.isFolder)
    return [{ label: 'Open', icon: ListMusic, onSelect: () => void openPlaylist(node.id) }, rename, remove];
  return [
    { label: 'New playlist here', icon: ListPlus, onSelect: () => void createNode(false, node.id) },
    { label: 'New folder here', icon: FolderPlus, onSelect: () => void createNode(true, node.id) },
    rename,
    remove,
  ];
}

function PlaylistTree({ platform }: { platform: string }) {
  const tree = usePlaylists((s) => s.tree);
  const closed = usePlaylists((s) => s.closed);
  const selectedNodeId = usePlaylists((s) => s.selectedNodeId);
  const renaming = usePlaylists((s) => (s.renameIn === 'tree' ? s.renaming : null));
  const openId = usePlaylists((s) => s.openId);
  const [menu, setMenu] = useState<{ at: MenuPlace; node: PlaylistNode } | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const help = useWhatIsThis('playlists');

  // The rows to show: everything not inside a shut folder, with how deep it is.
  /** Folders' names, for a screen reader: a playlist in a folder says which. */
  const nameOf = useMemo(() => new Map(tree.map((n) => [n.id, n.name])), [tree]);
  const rows = useMemo(() => {
    const depth = new Map<string, number>();
    const hidden = new Set<string>();
    const out: { node: PlaylistNode; depth: number }[] = [];
    for (const node of tree) {
      const parent = node.parentId;
      const d = parent === null ? 0 : (depth.get(parent) ?? -1) + 1;
      depth.set(node.id, d);
      if (parent !== null && (hidden.has(parent) || closed.includes(parent))) {
        hidden.add(node.id);
        continue;
      }
      out.push({ node, depth: d });
    }
    return out;
  }, [tree, closed]);

  const openMenu = (e: MouseEvent, node: PlaylistNode) => {
    e.preventDefault();
    selectNode(node.id);
    setMenu({ at: menuPlace(e), node });
  };

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 px-3">
        <ViewTabs />
        {/* + New (Session 26a: words, not just an icon): a playlist or a folder. */}
        <MenuButton
          label="New"
          title="New playlist or folder"
          icon={Plus}
          variant="secondary"
          entries={[
            { label: 'New playlist', icon: ListPlus, onSelect: () => void createNode(false) },
            { label: 'New folder', icon: FolderPlus, onSelect: () => void createNode(true) },
          ]}
        >
          New
        </MenuButton>
        {help.button}
      </div>
      {help.card}
      <TabPanel group="playlist-view" id="playlists" className="flex min-h-0 flex-1 flex-col">
        {/* An empty tree is no tree: the note stands on its own until there are playlists. */}
        {tree.length === 0 && (
          <div data-testid="playlist-tree" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <EmptyState icon={ListMusic} title="No playlists yet" compact>
              Make one with the New button above, or import a playlist file.
            </EmptyState>
          </div>
        )}
        {/* A list of buttons, each a Tab stop, not an ARIA tree: a tree's arrow keys would take the
            show's own (the arrows move the slides wherever the keyboard is). Folders say whether they
            are open, and a playlist in a folder says which. */}
        <ul
          aria-label="Playlists and folders"
          data-testid={tree.length > 0 ? 'playlist-tree' : undefined}
          hidden={tree.length === 0}
          className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2"
        >
          {rows.map(({ node, depth }) => {
            const open = node.isFolder && !closed.includes(node.id);
            const indent = { paddingLeft: 8 + depth * 14 };
            if (renaming === node.id)
              return (
                <li key={node.id} className="py-0.5" style={indent}>
                  <RenameField
                    value={node.name}
                    label={node.isFolder ? 'Folder name' : 'Playlist name'}
                    onDone={(name) => {
                      if (name === null) stopRenaming();
                      else void renameNode(node.id, name);
                    }}
                  />
                </li>
              );
            return (
              <li key={node.id} className="group relative flex items-center">
                <button
                  type="button"
                  data-testid="playlist-node"
                  data-kind={node.isFolder ? 'folder' : 'playlist'}
                  data-node-id={node.id}
                  data-open={openId === node.id ? 'true' : undefined}
                  aria-expanded={node.isFolder ? open : undefined}
                  aria-current={selectedNodeId === node.id ? 'true' : undefined}
                  style={indent}
                  onClick={() => {
                    if (node.isFolder) toggleFolder(node.id);
                    else void openPlaylist(node.id);
                  }}
                  onContextMenu={(e) => {
                    openMenu(e, node);
                  }}
                  onKeyDown={(e) => {
                    if (isMenuKey(e)) {
                      e.preventDefault();
                      selectNode(node.id);
                      setMenu({ at: menuBelow(e.currentTarget), node });
                      return;
                    }
                    if (!isRemoveKey(e, platform)) return;
                    e.preventDefault();
                    requestRemoveNode(node.id);
                  }}
                  onDragOver={(e) => {
                    if (node.isFolder || (!fromLibrary(e) && !hasFiles(e))) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    setDropOn(node.id);
                  }}
                  onDragLeave={() => {
                    setDropOn(null);
                  }}
                  onDrop={(e) => {
                    setDropOn(null);
                    if (node.isFolder) return;
                    // Files from the Finder or Explorer: imported, then added at its end (Session 26a).
                    if (hasFiles(e)) {
                      e.preventDefault();
                      e.stopPropagation();
                      void importIntoPlaylist(node.id, null, droppedPaths(e));
                      return;
                    }
                    if (!fromLibrary(e)) return;
                    e.preventDefault();
                    void addFromLibrary(node.id, null, droppedItems(e));
                  }}
                  className={cx(
                    rowClass({ selected: selectedNodeId === node.id, dropTarget: dropOn === node.id }),
                    // Room for Rename, Delete and the mouse's ⋯ at the end (Session 26a).
                    'flex min-h-8 min-w-0 items-center gap-1.5 py-1 pr-24 text-sm',
                  )}
                >
                  <span aria-hidden="true" className="flex w-4 shrink-0 justify-center text-muted">
                    {node.isFolder ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-muted">
                    {node.isFolder ? <Folder size={15} /> : <ListMusic size={15} />}
                  </span>
                  <Truncate text={node.name} className={cx('flex-1', node.isFolder && 'font-medium')} />
                  {node.parentId !== null && (
                    <span className="sr-only">, in {nameOf.get(node.parentId) ?? 'a folder'}</span>
                  )}
                  {node.placeholders > 0 && (
                    <Badge
                      tone="warning"
                      data-testid="node-placeholders"
                      title={`${plural(node.placeholders, 'item')} not found at import`}
                    >
                      {node.placeholders} missing
                    </Badge>
                  )}
                  {!node.isFolder && (
                    <span className="shrink-0 text-xs text-muted tabular-nums">{node.itemCount}</span>
                  )}
                </button>
                {/* Delete, as the Delete key does on the row: shown on the chosen row (a Tab stop) and
                    under the mouse (Session 26a). */}
                <RowRename
                  label={`Rename ${node.isFolder ? 'folder' : 'playlist'} “${node.name}”`}
                  chosen={selectedNodeId === node.id}
                  className="absolute right-[3.75rem]"
                  onRename={() => {
                    selectNode(node.id);
                    startRenaming(node.id);
                  }}
                />
                <RowDelete
                  label={`Delete ${node.isFolder ? 'folder' : 'playlist'} “${node.name}”`}
                  chosen={selectedNodeId === node.id}
                  className="absolute right-8"
                  onDelete={() => {
                    selectNode(node.id);
                    requestRemoveNode(node.id);
                  }}
                />
                {/* For the mouse: the keyboard opens the same menu on the playlist itself (Shift+F10 or
                  the Menu key), which keeps one Tab stop a row. */}
                <span className="absolute right-1 opacity-0 group-hover:opacity-100" aria-hidden="true">
                  <IconButton
                    icon={MoreHorizontal}
                    label={`More for ${node.name}`}
                    size="sm"
                    tabIndex={-1}
                    aria-haspopup="menu"
                    onClick={(e) => {
                      selectNode(node.id);
                      const box = e.currentTarget.getBoundingClientRect();
                      setMenu({ at: { x: box.left, y: box.bottom + 2 }, node });
                    }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </TabPanel>
      {menu && (
        <Menu
          at={menu.at}
          label={menu.node.name}
          entries={nodeMenu(menu.node)}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </>
  );
}

/**
 * The week's playlists, or the sabha templates (kept apart, so a template is never run by mistake).
 * Templates only with View › Show Shastra, Templates and Kirtan Details (Session 26a); otherwise a
 * heading.
 */
function ViewTabs() {
  const view = usePlaylists((s) => s.view);
  const extras = useExtras((s) => s.on);
  if (!extras)
    return (
      <h2 className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-sm font-bold">
        <ListMusic size={15} aria-hidden="true" className="shrink-0 text-muted" />
        Playlists
      </h2>
    );
  return (
    <Tabs
      group="playlist-view"
      label="Playlists or templates"
      size="sm"
      // In a narrow column (or large text) the tabs give way, their words whole in a tooltip, so New
      // and What is this? beside them stay in reach.
      shrink
      className="min-w-0 flex-1"
      value={view}
      onChange={setView}
      items={[
        { id: 'playlists', label: 'Playlists', icon: ListMusic },
        { id: 'templates', label: 'Templates', icon: BookTemplate },
      ]}
    />
  );
}

/** The sabha templates: running orders to make playlists from. */
function TemplateList() {
  const templates = usePlaylists((s) => s.templates);
  const [menu, setMenu] = useState<{ at: MenuPlace; node: PlaylistNode } | null>(null);
  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 px-3">
        <ViewTabs />
      </div>
      <TabPanel group="playlist-view" id="templates" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-1 pb-2 text-xs text-muted">
          A template is a running order with slots to fill. Make the week’s playlist from one; a template
          itself never goes on the screens.
        </p>
        {templates.length === 0 ? (
          <EmptyState icon={BookTemplate} title="No templates yet" compact>
            Open a playlist and choose Save as template in its menu.
          </EmptyState>
        ) : (
          <ul className="space-y-1" aria-label="Templates" data-testid="template-list">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="template-node"
                  className={cx(
                    rowClass({}),
                    'flex min-h-9 min-w-0 flex-1 items-center gap-1.5 px-2 text-sm',
                  )}
                  onClick={() => void openPlaylist(t.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ at: menuPlace(e), node: t });
                  }}
                  onKeyDown={(e) => {
                    if (!isMenuKey(e)) return;
                    e.preventDefault();
                    setMenu({ at: menuBelow(e.currentTarget), node: t });
                  }}
                >
                  <BookTemplate size={15} aria-hidden="true" className="shrink-0 text-muted" />
                  <Truncate text={t.name} className="flex-1" />
                  <span className="shrink-0 text-xs text-muted tabular-nums">{t.itemCount}</span>
                </button>
                <Button
                  size="sm"
                  icon={ListPlus}
                  data-testid="new-from-template"
                  aria-label={`New playlist from ${t.name}`}
                  onClick={() => void newFromTemplate(t.id)}
                >
                  Use
                </Button>
              </li>
            ))}
          </ul>
        )}
      </TabPanel>
      {menu && (
        <Menu
          at={menu.at}
          label={menu.node.name}
          entries={nodeMenu(menu.node)}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </>
  );
}

/**
 * The playlists (Session 26a: always at the top of the left column): many of them, in folders, made with
 * + New; a click opens one in the centre (OpenPlaylist.tsx). With View › Show Shastra, Templates and Kirtan
 * Details, the sabha templates beside them.
 */
export function PlaylistPanel({ platform }: { platform: string }) {
  const view = usePlaylists((s) => s.view);
  const problem = usePlaylists((s) => s.problem);
  return (
    <section aria-label="Playlists" data-testid="playlists" className="flex min-h-0 flex-1 flex-col">
      {view === 'templates' ? <TemplateList /> : <PlaylistTree platform={platform} />}
      <SaveTemplateDialog />
      <AddSlotDialog />
      <FillSlotDialog />
      <EditSlotDialog />
      <TimerCuesDialog />
      {problem && (
        <Notice tone="warning" compact className="mx-2 mb-2" onDismiss={dismissProblem}>
          {problem}
        </Notice>
      )}
    </section>
  );
}
