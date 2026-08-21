import { parseMarkdown, type MarkdownInlineToken } from './markdownModel';
import type { CSSProperties } from 'react';

interface MarkdownTextProps {
  value: string;
  className?: string;
  style?: CSSProperties;
}

function renderInline(tokens: MarkdownInlineToken[]) {
  return tokens.map((token, index) => {
    if (token.type === 'strong') {
      return <strong key={index}>{token.text}</strong>;
    }
    if (token.type === 'code') {
      return <code key={index}>{token.text}</code>;
    }
    return <span key={index}>{token.text}</span>;
  });
}

export function MarkdownText({ value, className, style }: MarkdownTextProps) {
  const blocks = parseMarkdown(value);
  const rootClass = ['markdown-text', className].filter(Boolean).join(' ');

  if (blocks.length === 0) {
    return <div className={rootClass} style={style} />;
  }

  return (
    <div className={rootClass} style={style}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Heading = `h${block.level}` as 'h1' | 'h2' | 'h3';
          return <Heading key={index}>{renderInline(block.inline)}</Heading>;
        }
        if (block.type === 'orderedList') {
          return (
            <ol key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }
        if (block.type === 'unorderedList') {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'blockquote') {
          return <blockquote key={index}>{renderInline(block.inline)}</blockquote>;
        }
        if (block.type === 'codeBlock') {
          return (
            <pre key={index}>
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === 'table') {
          return (
            <div className="markdown-table-wrap" key={index}>
              <table>
                <thead>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th key={headerIndex}>{renderInline(header)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{renderInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={index}>{renderInline(block.inline)}</p>;
      })}
    </div>
  );
}
