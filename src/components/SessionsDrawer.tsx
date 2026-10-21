import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  sessionService,
  ChatSession,
  ConversationSearchMatch,
  ConversationSearchResult,
} from '../services/sessionService';
import {
  X,
  Plus,
  Search,
  MessageSquare,
  Edit2,
  Trash2,
  FileText,
  FileJson,
  Check,
  ChevronRight,
  Bot,
  User,
  AlertCircle,
  Clock,
  Sparkles,
} from 'lucide-react';

interface SessionsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (session: ChatSession, targetMessageId?: string) => void;
  initialSearchQuery?: string;
}

const HighlightMatch: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  if (!query || !query.trim()) {
    return <span>{text}</span>;
  }

  const terms = query
    .trim()
    .toLowerCase()
    .replace(/[^\w\s\u0900-\u097F]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return <span>{text}</span>;
  }

  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part, i) => {
        const isMatch = terms.some((t) => t.toLowerCase() === part.toLowerCase());
        return isMatch ? (
          <mark
            key={i}
            className="bg-cyan-500/35 text-cyan-200 font-semibold px-0.5 rounded border border-cyan-500/40"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </span>
  );
};

export const SessionsDrawer: React.FC<SessionsDrawerProps> = ({
  isOpen,
  onClose,
  onSelectSession,
  initialSearchQuery = '',
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => sessionService.getSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => sessionService.getActiveSessionId());
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
  const [searchTab, setSearchTab] = useState<'matches' | 'threads'>('matches');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const unsub = sessionService.subscribe((list, activeId) => {
      setSessions(list);
      setActiveSessionId(activeId);
    });
    return () => unsub();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Execute in-memory search across active user's conversation history
  const searchResults: ConversationSearchResult = useMemo(() => {
    if (!searchQuery.trim()) {
      return { query: '', totalMatches: 0, matchedThreadsCount: 0, matches: [] };
    }
    return sessionService.searchConversations(searchQuery.trim());
  }, [searchQuery, sessions]);

  // Filtered threads list for title or message matching
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const queryLower = searchQuery.toLowerCase();
    return sessions.filter((s) => {
      const titleMatch = s.title.toLowerCase().includes(queryLower);
      const msgMatch = Array.isArray(s.messages) && s.messages.some((m) => m.text?.toLowerCase().includes(queryLower));
      return titleMatch || msgMatch;
    });
  }, [searchQuery, sessions]);

  if (!isOpen) return null;

  const handleCreateNewSession = async () => {
    const created = await sessionService.createSession('New Discussion');
    onSelectSession(created);
  };

  const handleSelectThread = (s: ChatSession, targetMessageId?: string) => {
    // Validate session existence (handle deleted threads safely)
    const current = sessionService.getSessions().find((sess) => sess.id === s.id);
    if (!current) {
      setNoticeMessage('This conversation thread was deleted or is no longer available.');
      setTimeout(() => setNoticeMessage(null), 3000);
      return;
    }
    sessionService.selectSession(current.id);
    onSelectSession(current, targetMessageId);
  };

  const handleSelectSearchMatch = (match: ConversationSearchMatch) => {
    const targetSession = sessionService.getSessions().find((s) => s.id === match.sessionId);
    if (!targetSession) {
      setNoticeMessage('This conversation was removed and is no longer accessible.');
      setTimeout(() => setNoticeMessage(null), 3000);
      return;
    }
    sessionService.selectSession(targetSession.id);
    onSelectSession(targetSession, match.messageId);
  };

  const handleStartRename = (e: React.MouseEvent, s: ChatSession) => {
    e.stopPropagation();
    setEditingId(s.id);
    setEditTitle(s.title);
  };

  const handleSaveRename = async (e: React.FormEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editTitle.trim()) return;
    await sessionService.renameSession(id, editTitle.trim());
    setEditingId(null);
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await sessionService.deleteSession(id);
    setDeleteConfirmId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (searchQuery) {
        setSearchQuery('');
      } else {
        onClose();
      }
    }
  };

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-50 flex justify-start bg-black/80 backdrop-blur-sm animate-in fade-in"
    >
      <div className="w-full max-w-md bg-[#0a0c14] border-r border-white/15 h-full flex flex-col text-neutral-200 shadow-2xl relative">
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-black/40">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">CONVERSATION THREADS</h2>
              <p className="text-[11px] font-mono text-neutral-400">
                {sessions.length} active sessions
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
            title="Close Drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action & Search Bar */}
        <div className="p-3 border-b border-white/10 space-y-2.5 bg-black/20">
          <button
            onClick={handleCreateNewSession}
            className="w-full py-2 px-3 rounded-xl bg-white text-black hover:bg-slate-200 font-medium text-xs flex items-center justify-center space-x-2 transition shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>Start New Thread</span>
          </button>

          {/* Search Input with Clear Button */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search messages, questions, topics..."
              className="w-full pl-9 pr-8 py-2 bg-neutral-900/90 border border-white/15 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-500/30 transition shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white p-0.5 rounded transition"
                title="Clear Search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Stale Result / Notice Banner */}
          {noticeMessage && (
            <div className="flex items-center space-x-2 p-2 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 text-[11px] animate-in fade-in">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{noticeMessage}</span>
            </div>
          )}

          {/* Search Active Status Strip & Tabs */}
          {isSearching && (
            <div className="pt-1 flex items-center justify-between border-t border-white/5">
              <span className="text-[10px] font-mono text-neutral-400">
                Found <span className="text-cyan-400 font-bold">{searchResults.totalMatches}</span> matches across{' '}
                <span className="text-white font-bold">{searchResults.matchedThreadsCount}</span> threads
              </span>
              <div className="flex items-center space-x-1 bg-black/40 p-0.5 rounded-lg border border-white/10 text-[10px]">
                <button
                  onClick={() => setSearchTab('matches')}
                  className={`px-2 py-0.5 rounded-md transition font-medium ${
                    searchTab === 'matches'
                      ? 'bg-cyan-500 text-black font-semibold shadow-sm'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Matches ({searchResults.totalMatches})
                </button>
                <button
                  onClick={() => setSearchTab('threads')}
                  className={`px-2 py-0.5 rounded-md transition font-medium ${
                    searchTab === 'threads'
                      ? 'bg-cyan-500 text-black font-semibold shadow-sm'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Threads ({filteredSessions.length})
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Content List Area */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 font-sans">
          {/* View 1: Search Matches Tab */}
          {isSearching && searchTab === 'matches' && (
            <div className="space-y-2">
              {searchResults.matches.length === 0 ? (
                <div className="py-12 px-4 text-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-neutral-900 border border-white/10 mx-auto flex items-center justify-center text-neutral-500">
                    <Search className="w-5 h-5" />
                  </div>
                  <p className="text-xs text-neutral-300 font-medium">No messages found matching &ldquo;{searchQuery}&rdquo;</p>
                  <p className="text-[11px] text-neutral-500">
                    Try searching for partial words, topics, or phrasing in English, Hindi, or Hinglish.
                  </p>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="mt-2 px-3 py-1 bg-white/10 hover:bg-white/15 text-white text-[11px] rounded-lg transition"
                  >
                    Clear Search
                  </button>
                </div>
              ) : (
                searchResults.matches.map((match) => (
                  <div
                    key={`${match.sessionId}-${match.messageId}-${match.matchType}`}
                    onClick={() => handleSelectSearchMatch(match)}
                    className="group p-3 rounded-xl border border-white/10 bg-neutral-900/50 hover:bg-white/10 hover:border-cyan-500/40 text-neutral-300 hover:text-white transition-all cursor-pointer shadow-sm relative"
                  >
                    <div className="flex items-center justify-between text-[10px] text-neutral-400 font-mono mb-1.5">
                      <div className="flex items-center space-x-1.5 truncate max-w-[240px]">
                        <span className="text-cyan-400 font-semibold truncate">{match.sessionTitle}</span>
                        <span>•</span>
                        <span className="flex items-center space-x-1">
                          {match.sender === 'user' ? (
                            <>
                              <User className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-300 font-sans">User</span>
                            </>
                          ) : (
                            <>
                              <Bot className="w-3 h-3 text-cyan-400" />
                              <span className="text-cyan-300 font-sans">Shadow</span>
                            </>
                          )}
                        </span>
                      </div>
                      {match.timestamp && (
                        <span className="text-neutral-500 flex items-center space-x-1 shrink-0">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{match.timestamp}</span>
                        </span>
                      )}
                    </div>

                    {/* Matched Snippet Preview with Highlight */}
                    <p className="text-xs text-neutral-200 leading-relaxed font-sans line-clamp-3">
                      <HighlightMatch text={match.snippet} query={searchQuery} />
                    </p>

                    <div className="mt-2 pt-1.5 border-t border-white/5 flex items-center justify-between text-[10px] text-cyan-400 font-mono">
                      <span>Jump to message</span>
                      <ChevronRight className="w-3.5 h-3.5 transform group-hover:translate-x-0.5 transition" />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* View 2: Threads Tab (or Default when not searching) */}
          {(!isSearching || searchTab === 'threads') && (
            <div className="space-y-1.5">
              {filteredSessions.length === 0 ? (
                <div className="py-12 text-center text-neutral-500 text-xs">
                  {searchQuery ? `No conversation threads matching "${searchQuery}".` : 'No active conversations.'}
                </div>
              ) : (
                filteredSessions.map((s) => {
                  const isActive = s.id === activeSessionId;
                  const isEditing = editingId === s.id;
                  const isDeleting = deleteConfirmId === s.id;

                  return (
                    <div
                      key={s.id}
                      onClick={() => !isEditing && handleSelectThread(s)}
                      className={`group relative p-3 rounded-xl border transition-all cursor-pointer ${
                        isActive
                          ? 'bg-white/10 border-cyan-500/40 text-white shadow-lg'
                          : 'bg-neutral-900/40 border-white/5 hover:border-white/15 text-neutral-300 hover:text-white'
                      }`}
                    >
                      {isEditing ? (
                        <form onSubmit={(e) => handleSaveRename(e, s.id)} className="flex items-center space-x-1.5">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="flex-1 px-2 py-1 bg-black/60 border border-cyan-500/50 rounded text-xs text-white focus:outline-none"
                            autoFocus
                          />
                          <button
                            type="submit"
                            className="p-1 rounded bg-cyan-500 text-black hover:bg-cyan-400"
                            title="Save title"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(null);
                            }}
                            className="p-1 rounded bg-neutral-800 text-neutral-400 hover:text-white"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      ) : (
                        <>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0 pr-2">
                              <p className="text-xs font-semibold truncate leading-snug">
                                <HighlightMatch text={s.title} query={searchQuery} />
                              </p>
                              <p className="text-[10px] text-neutral-400 mt-0.5 font-mono">
                                {new Date(s.updatedAt).toLocaleDateString([], {
                                  month: 'short',
                                  day: 'numeric',
                                })} · {s.messages.length} messages
                              </p>
                            </div>
                            {isActive && (
                              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#06b6d4] mt-1 shrink-0" />
                            )}
                          </div>

                          {/* Quick Actions (Hover or Active) */}
                          <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-neutral-400">
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={(e) => handleStartRename(e, s)}
                                className="hover:text-white p-0.5 rounded transition"
                                title="Rename thread"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  sessionService.exportSession(s, 'markdown');
                                }}
                                className="hover:text-white p-0.5 rounded transition flex items-center space-x-1"
                                title="Export as Markdown (.md)"
                              >
                                <FileText className="w-3 h-3" />
                                <span className="text-[9px]">MD</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  sessionService.exportSession(s, 'json');
                                }}
                                className="hover:text-white p-0.5 rounded transition flex items-center space-x-1"
                                title="Export as JSON"
                              >
                                <FileJson className="w-3 h-3" />
                                <span className="text-[9px]">JSON</span>
                              </button>
                            </div>

                            {isDeleting ? (
                              <div className="flex items-center space-x-1.5 text-rose-400">
                                <span className="text-[10px]">Delete?</span>
                                <button
                                onClick={(e) => handleDelete(e, s.id)}
                                className="px-1.5 py-0.5 bg-rose-600 text-white rounded text-[10px] hover:bg-rose-500"
                              >
                                Yes
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirmId(null);
                                }}
                                className="px-1.5 py-0.5 bg-neutral-800 text-neutral-300 rounded text-[10px]"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteConfirmId(s.id);
                              }}
                              className="hover:text-rose-400 p-0.5 rounded transition"
                              title="Delete thread"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-white/10 bg-black/40 text-[11px] font-mono text-neutral-500 text-center flex items-center justify-between px-4">
        <span>Instant In-Memory Search</span>
        <span className="text-cyan-400/80">Press ESC to clear</span>
      </div>
    </div>
  </div>
);
};
