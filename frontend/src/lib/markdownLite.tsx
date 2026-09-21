import { Fragment, ReactNode } from 'react';

/**
 * A small, dependency-free Markdown-ish renderer for assistant chat replies.
 * Never touches innerHTML — it builds React elements directly, so there is no
 * XSS surface no matter what the model returns. Supports exactly what a chat
 * answer realistically needs: paragraphs, line breaks, headings, bullet/numbered
 * lists, **bold**, *italic*, `inline code` and fenced code blocks. Anything
 * else (tables, links, images, raw HTML) is left as plain text on purpose.
 */

const INLINE_PATTERN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let n = 0;
  while (remaining.length > 0) {
    const match = INLINE_PATTERN.exec(remaining);
    if (!match) {
      nodes.push(remaining);
      break;
    }
    if (match.index > 0) nodes.push(remaining.slice(0, match.index));
    const token = match[0];
    const key = `${keyBase}-${n++}`;
    if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-ink/[0.06] px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    } else {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    }
    remaining = remaining.slice(match.index + token.length);
  }
  return nodes;
}

function renderTextBlock(content: string, keyBase: string): ReactNode[] {
  const lines = content.split('\n');
  const elements: ReactNode[] = [];
  let paraLines: string[] = [];

  const flushParagraph = () => {
    if (paraLines.length === 0) return;
    elements.push(
      <p key={`${keyBase}-p-${elements.length}`} className="leading-relaxed">
        {renderInline(paraLines.join(' '), `${keyBase}-p-${elements.length}`)}
      </p>
    );
    paraLines = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const size = heading[1].length <= 2 ? 'text-base font-semibold' : 'text-sm font-semibold';
      elements.push(
        <p key={`${keyBase}-h-${i}`} className={`mt-3 first:mt-0 ${size} text-ink`}>
          {renderInline(heading[2], `${keyBase}-h-${i}`)}
        </p>
      );
      i++;
      continue;
    }

    const orderedMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
    const bulletMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    if (orderedMatch || bulletMatch) {
      flushParagraph();
      const ordered = Boolean(orderedMatch);
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered ? /^\s*\d+\.\s+(.*)$/.exec(lines[i]) : /^\s*[-*]\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      const listClass = ordered ? 'ml-5 list-decimal space-y-1' : 'ml-5 list-disc space-y-1';
      elements.push(
        ordered ? (
          <ol key={`${keyBase}-l-${i}`} className={listClass}>
            {items.map((item, idx) => (
              <li key={idx}>{renderInline(item, `${keyBase}-li-${i}-${idx}`)}</li>
            ))}
          </ol>
        ) : (
          <ul key={`${keyBase}-l-${i}`} className={listClass}>
            {items.map((item, idx) => (
              <li key={idx}>{renderInline(item, `${keyBase}-li-${i}-${idx}`)}</li>
            ))}
          </ul>
        )
      );
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      i++;
      continue;
    }
    paraLines.push(line);
    i++;
  }
  flushParagraph();
  return elements;
}

interface Block {
  type: 'code' | 'text';
  content: string;
}

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const fence = /```[^\n`]*\n?([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text))) {
    if (match.index > last) blocks.push({ type: 'text', content: text.slice(last, match.index) });
    blocks.push({ type: 'code', content: match[1].replace(/\n$/, '') });
    last = fence.lastIndex;
  }
  if (last < text.length) blocks.push({ type: 'text', content: text.slice(last) });
  return blocks;
}

export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const blocks = splitBlocks(text);
  return (
    <div className={className}>
      {blocks.map((block, i) =>
        block.type === 'code' ? (
          <pre key={i} className="my-2 overflow-x-auto rounded-lg bg-ink px-3 py-2.5 text-[0.85em] text-white">
            <code>{block.content}</code>
          </pre>
        ) : (
          <Fragment key={i}>{renderTextBlock(block.content, `b${i}`)}</Fragment>
        )
      )}
    </div>
  );
}
