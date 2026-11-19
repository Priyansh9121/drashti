import type { ReactNode } from 'react';
import { guidePictureName, guidePictureUrl } from '../../../shared/guides';
import type { Block, Inline } from '../../../shared/markdown';
import { cx } from '../ui/cx';

/*
 * A guide drawn from Drashti's own Markdown reader (src/shared/markdown.ts), element by element, never as
 * HTML: its words are text, an address is text, a picture comes only from the guides' own folder
 * (drashti-media://guide/). Each passage carries its number (data-passage), so a search, an answer or a "?" can
 * bring it into view and mark it (data-current).
 */

/** Each picture's size by its name (the main process reads them), so its room is kept before it loads. */
type Sizes = Readonly<Record<string, readonly [number, number]>>;

/**
 * A picture's address and name, from its path as the text writes it, or null for anything else: the guides' rule
 * ("screenshots/<name>.png") unless the text is another's (the Drashti Manual's chapters, x37: "../screenshots/…").
 */
export type PictureOf = (src: string) => { url: string; name: string } | null;

const guidePicture: PictureOf = (src) => {
  const url = guidePictureUrl(src);
  const name = guidePictureName(src);
  return url && name ? { url, name } : null;
};

function Inlines({
  items,
  sizes,
  pictureOf,
}: {
  items: readonly Inline[];
  sizes: Sizes;
  pictureOf: PictureOf;
}): ReactNode {
  return items.map((n, i) => {
    if (n.kind === 'text') return n.text;
    if (n.kind === 'strong')
      return (
        <strong key={i} className="font-semibold text-fg">
          <Inlines items={n.children} sizes={sizes} pictureOf={pictureOf} />
        </strong>
      );
    if (n.kind === 'code')
      return (
        <code key={i} className="rounded-sm bg-panel-2 px-1 font-mono text-[0.9em]">
          {n.text}
        </code>
      );
    const picture = pictureOf(n.src);
    const size = sizes[picture?.name ?? ''];
    return picture ? (
      <img
        key={i}
        src={picture.url}
        alt={n.alt}
        width={size?.[0]}
        height={size?.[1]}
        className="my-2 inline-block h-auto max-w-full rounded-md border border-line align-top"
      />
    ) : (
      n.alt
    );
  });
}

const mark = (pid: number, current: number | null) => ({
  'data-passage': pid,
  'data-current': pid === current ? 'true' : undefined,
});

const marked = (pid: number, current: number | null) =>
  pid === current ? 'rounded-md bg-accent/15 outline outline-2 outline-offset-2 outline-accent' : '';

export function GuideText({
  blocks,
  current,
  sizes,
  pictureOf = guidePicture,
}: {
  blocks: readonly Block[];
  current: number | null;
  sizes: Sizes;
  /** How its pictures are written (the guides' way unless given). */
  pictureOf?: PictureOf;
}): ReactNode {
  return blocks.map((b, i) => {
    switch (b.kind) {
      case 'heading':
        return b.level === 1 ? (
          <h1
            key={i}
            {...mark(b.pid, current)}
            className={cx('mb-3 text-xl font-bold', marked(b.pid, current))}
          >
            <Inlines items={b.children} sizes={sizes} pictureOf={pictureOf} />
          </h1>
        ) : (
          <h2
            key={i}
            {...mark(b.pid, current)}
            className={cx('mt-6 mb-2 scroll-mt-4 text-lg font-bold', marked(b.pid, current))}
          >
            <Inlines items={b.children} sizes={sizes} pictureOf={pictureOf} />
          </h2>
        );
      case 'paragraph':
        return (
          <p key={i} {...mark(b.pid, current)} className={cx('my-2 leading-relaxed', marked(b.pid, current))}>
            <Inlines items={b.children} sizes={sizes} pictureOf={pictureOf} />
          </p>
        );
      case 'rule':
        return <hr key={i} className="my-4 border-line" />;
      case 'table':
        return (
          <table key={i} className="my-3 w-full border-collapse text-sm">
            {b.head.some((c) => c.length > 0) && (
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} className="border-b border-line-strong px-2 py-1 text-left font-semibold">
                      <Inlines items={c} sizes={sizes} pictureOf={pictureOf} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.pid} {...mark(r.pid, current)} className={marked(r.pid, current)}>
                  {r.cells.map((c, j) => (
                    <td key={j} className="border-b border-line px-2 py-1 align-top">
                      <Inlines items={c} sizes={sizes} pictureOf={pictureOf} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'list': {
        const items = b.items.map((item) => (
          <li key={item.pid} {...mark(item.pid, current)} className={cx('my-1', marked(item.pid, current))}>
            {item.task && (
              <span aria-hidden="true" className="mr-1.5">
                {item.task === 'done' ? '☑' : '☐'}
              </span>
            )}
            {item.task && <span className="sr-only">{item.task === 'done' ? 'Done: ' : 'To do: '}</span>}
            <GuideText blocks={item.blocks} current={current} sizes={sizes} pictureOf={pictureOf} />
          </li>
        ));
        return b.ordered ? (
          <ol key={i} start={b.start} className="my-2 list-decimal pl-6 [&_p]:my-0.5">
            {items}
          </ol>
        ) : (
          <ul
            key={i}
            className={cx(
              'my-2 pl-6 [&_p]:my-0.5',
              b.items.some((t) => t.task) ? 'list-none pl-1' : 'list-disc',
            )}
          >
            {items}
          </ul>
        );
      }
    }
  });
}
