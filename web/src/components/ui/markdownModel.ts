export type MarkdownInlineToken =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'code'; text: string };

export type MarkdownBlock =
  | { type: 'paragraph'; inline: MarkdownInlineToken[] }
  | { type: 'heading'; level: 1 | 2 | 3; inline: MarkdownInlineToken[] }
  | { type: 'orderedList'; items: MarkdownInlineToken[][] }
  | { type: 'unorderedList'; items: MarkdownInlineToken[][] }
  | { type: 'blockquote'; inline: MarkdownInlineToken[] }
  | { type: 'codeBlock'; language: string; text: string }
  | { type: 'table'; headers: MarkdownInlineToken[][]; rows: MarkdownInlineToken[][][] };

function isTableSeparator(line: string): boolean {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
  if (cells.length < 2) return false;
  return cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

export function parseMarkdownInline(value: unknown): MarkdownInlineToken[] {
  if (typeof value !== 'string' || value.length === 0) return [];

  const tokens: MarkdownInlineToken[] = [];
  let index = 0;
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > index) {
      tokens.push({ type: 'text', text: value.slice(index, start) });
    }
    const raw = match[0];
    if (raw.startsWith('`')) {
      tokens.push({ type: 'code', text: raw.slice(1, -1) });
    } else {
      tokens.push({ type: 'strong', text: raw.slice(2, -2) });
    }
    index = start + raw.length;
  }
  if (index < value.length) {
    tokens.push({ type: 'text', text: value.slice(index) });
  }
  return tokens;
}

export function parseMarkdown(value: unknown): MarkdownBlock[] {
  if (typeof value !== 'string') return [];
  const lines = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  const pushParagraph = (paragraphLines: string[]) => {
    const text = paragraphLines.join('\n').trim();
    if (text) blocks.push({ type: 'paragraph', inline: parseMarkdownInline(text) });
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const language = fence[1] ?? '';
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'codeBlock', language, text: codeLines.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        inline: parseMarkdownInline(heading[2]),
      });
      index += 1;
      continue;
    }

    if (
      line.includes('|')
      && index + 1 < lines.length
      && isTableSeparator(lines[index + 1] ?? '')
    ) {
      const headers = splitTableRow(line).map(parseMarkdownInline);
      const rows: MarkdownInlineToken[][][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim()) {
        rows.push(splitTableRow(lines[index] ?? '').map(parseMarkdownInline));
        index += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      const items: MarkdownInlineToken[][] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? '').match(/^\s*\d+\.\s+(.+)$/);
        if (!item) break;
        items.push(parseMarkdownInline(item[1]));
        index += 1;
      }
      blocks.push({ type: 'orderedList', items });
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (unordered) {
      const items: MarkdownInlineToken[][] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? '').match(/^\s*[-*]\s+(.+)$/);
        if (!item) break;
        items.push(parseMarkdownInline(item[1]));
        index += 1;
      }
      blocks.push({ type: 'unorderedList', items });
      continue;
    }

    const quote = line.match(/^\s*>\s?(.+)$/);
    if (quote) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? '').match(/^\s*>\s?(.+)$/);
        if (!item) break;
        quoteLines.push(item[1]);
        index += 1;
      }
      blocks.push({ type: 'blockquote', inline: parseMarkdownInline(quoteLines.join('\n')) });
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (
      index < lines.length
      && (lines[index] ?? '').trim()
      && !/^```/.test(lines[index] ?? '')
      && !/^(#{1,3})\s+/.test(lines[index] ?? '')
      && !/^\s*\d+\.\s+/.test(lines[index] ?? '')
      && !/^\s*[-*]\s+/.test(lines[index] ?? '')
      && !/^\s*>\s?/.test(lines[index] ?? '')
    ) {
      paragraphLines.push(lines[index] ?? '');
      index += 1;
    }
    pushParagraph(paragraphLines);
  }

  return blocks;
}
