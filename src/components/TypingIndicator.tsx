import React from 'react';
import { Bot, Sparkles } from 'lucide-react';

interface TypingIndicatorProps {
  isSerious?: boolean;
  className?: string;
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({
  isSerious = false,
  className = '',
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Shadow is thinking and composing a response"
      className={`flex flex-col items-start select-none animate-in fade-in duration-200 ${className}`}
    >
      {/* Assistant Header Tag */}
      <div className="flex items-center space-x-1.5 mb-1 text-[10px] text-neutral-400 font-mono">
        <Bot className="w-3 h-3 text-cyan-400 animate-pulse" />
        <span className="text-white font-semibold">Shadow</span>
        <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/25 text-[9px] flex items-center space-x-1">
          <Sparkles className="w-2.5 h-2.5 text-cyan-300 animate-spin" style={{ animationDuration: '3s' }} />
          <span>{isSerious ? 'Analyzing…' : 'Thinking…'}</span>
        </span>
      </div>

      {/* Message Bubble with 3 Staggered Dots */}
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-3 leading-relaxed flex items-center space-x-3 shadow-md ${
          isSerious
            ? 'bg-gradient-to-br from-[#161822] to-[#0f1018] text-white rounded-tl-none border border-white/40 shadow-white/5'
            : 'bg-[#10121c] text-slate-200 rounded-tl-none border border-white/15 shadow-cyan-950/20'
        }`}
      >
        <div className="flex items-center space-x-1.5 h-3">
          <span
            className="typing-dot w-2 h-2 rounded-full bg-gradient-to-tr from-cyan-400 to-white shadow-[0_0_8px_rgba(34,211,238,0.6)]"
            style={{ animationDelay: '0s' }}
          />
          <span
            className="typing-dot w-2 h-2 rounded-full bg-gradient-to-tr from-cyan-400 to-white shadow-[0_0_8px_rgba(34,211,238,0.6)]"
            style={{ animationDelay: '0.2s' }}
          />
          <span
            className="typing-dot w-2 h-2 rounded-full bg-gradient-to-tr from-cyan-400 to-white shadow-[0_0_8px_rgba(34,211,238,0.6)]"
            style={{ animationDelay: '0.4s' }}
          />
        </div>
        <span className="text-[11px] font-mono text-cyan-300/80 tracking-wide">
          {isSerious ? 'Synthesizing analysis…' : 'Composing answer…'}
        </span>
      </div>
    </div>
  );
};
