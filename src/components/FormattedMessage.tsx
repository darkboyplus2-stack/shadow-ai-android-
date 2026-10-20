import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface FormattedMessageProps {
  content: string;
  className?: string;
}

interface CodeBlockProps {
  code: string;
  language?: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Fallback
    }
  };

  return (
    <div className="my-2.5 rounded-xl border border-white/15 bg-black/60 overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-white/5 border-b border-white/10 text-xs font-mono text-cyan-300">
        <span className="uppercase text-[10px] tracking-wider font-semibold opacity-90">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center space-x-1 px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-slate-200 text-[11px] transition active:scale-95"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400 text-[10px]">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 text-slate-300" />
              <span className="text-[10px]">Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3 overflow-x-auto text-[13px] font-mono leading-relaxed text-slate-100 selection:bg-cyan-500/30">
        <pre className="m-0 whitespace-pre">{code}</pre>
      </div>
    </div>
  );
};

function renderInlineFormatting(text: string): React.ReactNode[] {
  // Regex splitting on code, bold, and italic tokens
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  // Simple token parser for inline `code`, **bold**, *italic*
  while (remaining.length > 0) {
    // Check for inline code `...`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code
          key={`code-${keyIdx++}`}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-white/10 text-cyan-300 font-mono text-[12px] border border-cyan-500/20"
        >
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Check for bold **...**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(
        <strong key={`bold-${keyIdx++}`} className="font-semibold text-white">
          {boldMatch[1]}
        </strong>
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Check for italic *...*
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(
        <em key={`italic-${keyIdx++}`} className="italic text-slate-300">
          {italicMatch[1]}
        </em>
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Find next potential token
    const nextSpecial = remaining.search(/[`*]/);
    if (nextSpecial === -1) {
      parts.push(remaining);
      break;
    } else if (nextSpecial > 0) {
      parts.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    } else {
      // Just a lone backtick or asterisk that didn't match a full token
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    }
  }

  return parts;
}

export const FormattedMessage: React.FC<FormattedMessageProps> = ({ content, className = '' }) => {
  if (!content || typeof content !== 'string') {
    return null;
  }

  // Quick check: if no markdown formatting characters exist, render as plain clean text
  const hasMarkdown = /```|\||###?|^\s*[-*]\s+|^\s*\d+\.\s+|\*\*|`/m.test(content);
  if (!hasMarkdown) {
    return <div className={`whitespace-pre-wrap leading-relaxed ${className}`}>{content}</div>;
  }

  // Split content by code blocks ```lang ... ```
  const sections: React.ReactNode[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_\-+#]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = codeBlockRegex.exec(content)) !== null) {
    // Process text before the code block
    if (blockMatch.index > lastIndex) {
      const textChunk = content.slice(lastIndex, blockMatch.index);
      sections.push(renderTextChunk(textChunk, `chunk-${lastIndex}`));
    }

    // Process the code block
    const language = blockMatch[1].trim();
    const code = blockMatch[2].replace(/\n$/, '');
    sections.push(<CodeBlock key={`cb-${blockMatch.index}`} code={code} language={language} />);

    lastIndex = codeBlockRegex.lastIndex;
  }

  // Process remaining text after the last code block
  if (lastIndex < content.length) {
    const textChunk = content.slice(lastIndex);
    sections.push(renderTextChunk(textChunk, `chunk-${lastIndex}`));
  }

  return <div className={`space-y-1.5 leading-relaxed text-slate-100 ${className}`}>{sections}</div>;
};

/**
 * Parses markdown lines (headings, lists, tables, and paragraphs) within non-code blocks
 */
function renderTextChunk(chunk: string, keyPrefix: string): React.ReactNode {
  const lines = chunk.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line: spacing
    if (!trimmed) {
      i++;
      continue;
    }

    // Markdown Headings
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h3
          key={`${keyPrefix}-h3-${i}`}
          className="text-[14px] font-semibold text-cyan-300 mt-3 mb-1.5 flex items-center space-x-1.5"
        >
          <span>{renderInlineFormatting(trimmed.slice(4))}</span>
        </h3>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      elements.push(
        <h2
          key={`${keyPrefix}-h2-${i}`}
          className="text-[15px] font-bold text-cyan-200 mt-3.5 mb-2 border-b border-white/10 pb-1"
        >
          <span>{renderInlineFormatting(trimmed.slice(3))}</span>
        </h2>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('# ')) {
      elements.push(
        <h1
          key={`${keyPrefix}-h1-${i}`}
          className="text-[16px] font-bold text-white mt-4 mb-2"
        >
          <span>{renderInlineFormatting(trimmed.slice(2))}</span>
        </h1>
      );
      i++;
      continue;
    }

    // Markdown Table Detection (line contains | and next line has |---)
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length && lines[i + 1].includes('|-')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const headerCells = tableLines[0]
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        const bodyLines = tableLines.slice(2); // Skip header and separator

        elements.push(
          <div key={`${keyPrefix}-table-${i}`} className="my-3 overflow-x-auto rounded-xl border border-white/15 bg-black/40">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-white/15 bg-white/5 text-cyan-300 font-semibold">
                  {headerCells.map((header, hIdx) => (
                    <th key={`th-${hIdx}`} className="px-3 py-2 border-r border-white/10 last:border-r-0">
                      {renderInlineFormatting(header)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {bodyLines.map((rowStr, rIdx) => {
                  const cells = rowStr
                    .split('|')
                    .slice(1, -1)
                    .map((c) => c.trim());
                  return (
                    <tr key={`tr-${rIdx}`} className="hover:bg-white/5 transition-colors">
                      {cells.map((cell, cIdx) => (
                        <td key={`td-${rIdx}-${cIdx}`} className="px-3 py-2 text-slate-200 border-r border-white/10 last:border-r-0">
                          {renderInlineFormatting(cell)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // Bullet Lists (- or *)
    if (/^\s*[-*]\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }

      elements.push(
        <ul key={`${keyPrefix}-ul-${i}`} className="my-1.5 space-y-1 pl-1">
          {listItems.map((item, itemIdx) => (
            <li key={`li-${itemIdx}`} className="flex items-start space-x-2 text-[13px] text-slate-200">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
              <span className="flex-1 leading-relaxed">{renderInlineFormatting(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered Lists (1. 2. 3.)
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems: Array<{ num: string; text: string }> = [];
      while (i < lines.length && /^\s*(\d+)\.\s+(.*)$/.test(lines[i])) {
        const match = lines[i].match(/^\s*(\d+)\.\s+(.*)$/);
        if (match) {
          listItems.push({ num: match[1], text: match[2] });
        }
        i++;
      }

      elements.push(
        <ol key={`${keyPrefix}-ol-${i}`} className="my-1.5 space-y-1.5 pl-1">
          {listItems.map((item, itemIdx) => (
            <li key={`oli-${itemIdx}`} className="flex items-start space-x-2.5 text-[13px] text-slate-200">
              <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-semibold border border-cyan-500/30 shrink-0 mt-0.5">
                {item.num}
              </span>
              <span className="flex-1 leading-relaxed">{renderInlineFormatting(item.text)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Standard paragraph line
    elements.push(
      <p key={`${keyPrefix}-p-${i}`} className="text-[13px] leading-relaxed my-1">
        {renderInlineFormatting(trimmed)}
      </p>
    );
    i++;
  }

  return <div key={keyPrefix}>{elements}</div>;
}
