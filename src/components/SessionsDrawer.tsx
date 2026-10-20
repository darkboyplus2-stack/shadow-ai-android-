import React, { useState, useEffect } from 'react';
import {
  sessionService,
  ChatSession,
} from '../services/sessionService';
import {
  X,
  Plus,
  Search,
  MessageSquare,
  Edit2,
  Trash2,
  Download,
  FileText,
  FileJson,
  Check,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

interface SessionsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSession: (session: ChatSession) => void;
}

export const SessionsDrawer: React.FC<SessionsDrawerProps> = ({
  isOpen,
  onClose,
  onSelectSession,
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => sessionService.getSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => sessionService.getActiveSessionId());
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const unsub = sessionService.subscribe((list, activeId) => {
      setSessions(list);
      setActiveSessionId(activeId);
    });
    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreateNewSession = async () => {
    const created = await sessionService.createSession('New Discussion');
    onSelectSession(created);
  };

  const handleSelect = (s: ChatSession) => {
    sessionService.selectSession(s.id);
    onSelectSession(s);
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

  const filteredSessions = sessions.filter((s) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const titleMatch = s.title.toLowerCase().includes(query);
    const msgMatch = s.messages.some((m) => m.text.toLowerCase().includes(query));
    return titleMatch || msgMatch;
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-start bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-sm bg-[#0a0c14] border-r border-white/15 h-full flex flex-col text-neutral-200 shadow-2xl relative">
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

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-9 pr-3 py-1.5 bg-neutral-900/80 border border-white/10 rounded-lg text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-cyan-500/50"
            />
          </div>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 font-sans">
          {filteredSessions.length === 0 ? (
            <div className="py-12 text-center text-neutral-500 text-xs">
              {searchQuery ? 'No conversations matching search.' : 'No active conversations.'}
            </div>
          ) : (
            filteredSessions.map((s) => {
              const isActive = s.id === activeSessionId;
              const isEditing = editingId === s.id;
              const isDeleting = deleteConfirmId === s.id;

              return (
                <div
                  key={s.id}
                  onClick={() => !isEditing && handleSelect(s)}
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
                            {s.title}
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

        {/* Footer */}
        <div className="p-3 border-t border-white/10 bg-black/40 text-[11px] font-mono text-neutral-500 text-center">
          Cloud Synchronized via Firestore
        </div>
      </div>
    </div>
  );
};
