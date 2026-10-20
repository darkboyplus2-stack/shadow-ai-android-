import React, { useState, useEffect } from 'react';
import {
  memoryService,
  MemoryDocument,
  MemoryCategory,
  SyncStatus,
} from '../services/memoryService';
import { authService, UserProfile } from '../services/authService';
import {
  X,
  Brain,
  Trash2,
  Edit2,
  Check,
  Plus,
  Cloud,
  CloudOff,
  RefreshCw,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  UserCheck,
  LogIn,
} from 'lucide-react';

interface MemoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAuth: () => void;
}

export const MemoryDrawer: React.FC<MemoryDrawerProps> = ({ isOpen, onClose, onOpenAuth }) => {
  const [memories, setMemories] = useState<MemoryDocument[]>([]);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('guest');
  const [autoEnabled, setAutoEnabled] = useState<boolean>(true);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Add memory state
  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryCategory>('preference');

  // Edit memory state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Clear confirmation
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    setAutoEnabled(memoryService.isAutoMemoryEnabled());
    setSyncStatus(memoryService.getSyncStatus());
    setUser(authService.getCurrentUser());

    const unsubMem = memoryService.subscribe((list) => {
      setMemories(list);
      setSyncStatus(memoryService.getSyncStatus());
    });

    const unsubAuth = authService.onAuthStateChanged((u) => {
      setUser(u);
      setSyncStatus(memoryService.getSyncStatus());
    });

    return () => {
      unsubMem();
      unsubAuth();
    };
  }, []);

  if (!isOpen) return null;

  const handleToggleAuto = () => {
    const next = !autoEnabled;
    setAutoEnabled(next);
    memoryService.setAutoMemoryEnabled(next);
  };

  const handleCreateMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    try {
      await memoryService.saveMemory(newContent.trim(), newCategory, 'explicit_user');
      setNewContent('');
      setIsAdding(false);
    } catch (err: any) {
      console.warn('Failed to save memory:', err);
    }
  };

  const handleStartEdit = (mem: MemoryDocument) => {
    setEditingId(mem.id);
    setEditContent(mem.content);
  };

  const handleSaveEdit = async (id: string, category: MemoryCategory) => {
    if (!editContent.trim()) return;
    try {
      await memoryService.saveMemory(editContent.trim(), category, 'explicit_user', id);
      setEditingId(null);
      setEditContent('');
    } catch (err: any) {
      console.warn('Failed to update memory:', err);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      await memoryService.deleteMemory(id);
    } catch (err: any) {
      console.warn('Failed to delete memory:', err);
    }
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      await memoryService.clearAllMemories();
      setShowClearConfirm(false);
    } finally {
      setIsClearing(false);
    }
  };

  const filteredMemories = memories.filter((m) => {
    const matchesCat = activeCategory === 'all' || m.category === activeCategory;
    const matchesSearch =
      !searchQuery ||
      m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md bg-[#0a0c14] border-l border-white/15 h-full flex flex-col text-neutral-200 shadow-2xl relative">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between bg-black/40">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-wide">SHADOW MEMORY CORE</h2>
                <span className="text-[11px] font-mono tabular-nums text-neutral-400">
                  ({memories.length})
                </span>
              </div>
              <div className="flex items-center space-x-2 text-xs text-neutral-400">
                {user ? (
                  <span className="flex items-center space-x-1 text-emerald-400">
                    <Cloud className="w-3.5 h-3.5" />
                    <span>Cloud Sync Live · {user.email?.split('@')[0]}</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-1 text-amber-300">
                    <CloudOff className="w-3.5 h-3.5" />
                    <span>Guest Mode (Local Only)</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800/60 transition"
            title="Close Drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sync & Account Prompt if in Guest mode */}
        {!user && (
          <div className="p-3.5 bg-gradient-to-r from-amber-500/10 via-neutral-900/60 to-transparent border-b border-amber-500/20 flex items-center justify-between text-xs">
            <div className="text-neutral-300 pr-2">
              <p className="font-medium text-amber-200">Sync across your devices</p>
              <p className="text-[11px] text-neutral-400">Sign in with Google to persist your memories in Firestore.</p>
            </div>
            <button
              onClick={onOpenAuth}
              className="px-3 py-1.5 rounded-lg bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition shrink-0 flex items-center space-x-1.5 shadow-sm"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
          </div>
        )}

        {/* Controls Toolbar: Auto-Memory Toggle & Add Button */}
        <div className="p-4 border-b border-white/10 space-y-3 bg-neutral-900/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-neutral-200">Automatic Memory Extraction</p>
              <p className="text-[11px] text-neutral-400">Identify long-term preferences from conversation turns</p>
            </div>
            <button
              type="button"
              onClick={handleToggleAuto}
              className={`w-11 h-6 rounded-full transition-colors relative ${
                autoEnabled ? 'bg-amber-400' : 'bg-neutral-700'
              }`}
              title={autoEnabled ? 'Auto-memory enabled' : 'Auto-memory disabled'}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${
                  autoEnabled ? 'bg-black transform translate-x-5' : 'bg-white'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center space-x-2 pt-1">
            <button
              onClick={() => setIsAdding((v) => !v)}
              className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium flex items-center space-x-1.5 transition border border-white/10"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Memory</span>
            </button>

            {memories.length > 0 && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 text-xs font-medium flex items-center space-x-1.5 transition border border-red-500/20 ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            )}
          </div>

          {/* Add Memory Form */}
          {isAdding && (
            <form onSubmit={handleCreateMemory} className="pt-2 space-y-2 border-t border-white/10">
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="E.g., Prefers TypeScript and clean architecture; working on an astronomy project..."
                rows={2}
                className="w-full p-2.5 rounded-lg bg-black/60 border border-white/20 text-xs text-white placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-white resize-none"
                autoFocus
              />
              <div className="flex items-center justify-between">
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
                  className="bg-neutral-800 border border-white/15 rounded-lg px-2 py-1 text-xs text-neutral-200 focus:outline-none"
                >
                  <option value="preference">Preference</option>
                  <option value="project">Project / Goal</option>
                  <option value="instruction">Instruction</option>
                  <option value="constraint">Constraint</option>
                  <option value="fact">Personal Fact</option>
                </select>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setIsAdding(false)}
                    className="px-2.5 py-1 text-xs text-neutral-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 bg-white text-black font-semibold rounded-lg text-xs hover:bg-neutral-200 transition"
                  >
                    Save Memory
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Filter Pills */}
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 pt-1 no-scrollbar text-xs">
            {[
              { id: 'all', label: 'All' },
              { id: 'preference', label: 'Preferences' },
              { id: 'project', label: 'Projects' },
              { id: 'instruction', label: 'Instructions' },
              { id: 'fact', label: 'Facts' },
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-2.5 py-1 rounded-md whitespace-nowrap transition text-[11px] font-medium ${
                  activeCategory === cat.id
                    ? 'bg-white text-black'
                    : 'bg-neutral-800/80 text-neutral-400 hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Clear Confirmation Banner */}
        {showClearConfirm && (
          <div className="p-4 bg-red-950/70 border-b border-red-500/40 text-xs space-y-2">
            <div className="flex items-center space-x-2 text-red-200 font-bold">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span>Clear All Long-Term Memories?</span>
            </div>
            <p className="text-red-300/90 text-[11px]">
              This will permanently delete all {memories.length} saved memories for this account across all devices. This cannot be undone.
            </p>
            <div className="flex items-center justify-end space-x-2 pt-1">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-3 py-1 rounded bg-neutral-800 text-neutral-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleClearAll}
                disabled={isClearing}
                className="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-bold"
              >
                {isClearing ? 'Clearing...' : 'Confirm Clear All'}
              </button>
            </div>
          </div>
        )}

        {/* Memories List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredMemories.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-3 text-neutral-400">
              <Brain className="w-10 h-10 mx-auto text-neutral-600 stroke-[1.5]" />
              <p className="text-sm font-medium text-neutral-300">No memories in this view</p>
              <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                {memories.length === 0
                  ? 'Speak or chat naturally with SHADOW. Useful preferences, projects, and directives will automatically be remembered here.'
                  : 'No memories match your active category filter.'}
              </p>
              {memories.length === 0 && (
                <div className="pt-2">
                  <p className="text-[11px] text-neutral-400 font-mono">
                    Try typing: "Remember that I live in Tokyo"
                  </p>
                </div>
              )}
            </div>
          ) : (
            filteredMemories.map((mem) => {
              const isEditing = editingId === mem.id;
              const dateStr = new Date(mem.updatedAt).toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
              });

              return (
                <div
                  key={mem.id}
                  className="p-3.5 rounded-xl border border-white/10 bg-neutral-900/60 hover:border-white/20 transition space-y-2 group"
                >
                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span className="font-mono uppercase tracking-wider text-amber-400/90 font-semibold">
                      {mem.category}
                    </span>
                    <div className="flex items-center space-x-2">
                      <span className="text-neutral-500">
                        {mem.provenance === 'explicit_user' ? 'Explicit' : 'Inferred'} · {dateStr}
                      </span>
                      <button
                        onClick={() => handleStartEdit(mem)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-white transition"
                        title="Edit Memory"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteMemory(mem.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-neutral-400 hover:text-red-400 transition"
                        title="Forget this memory"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="space-y-2 pt-1">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={2}
                        className="w-full p-2 rounded bg-black border border-white/30 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white resize-none"
                      />
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-2.5 py-1 text-xs text-neutral-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveEdit(mem.id, mem.category)}
                          className="px-3 py-1 bg-white text-black font-semibold rounded text-xs hover:bg-neutral-200"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-100 leading-relaxed">{mem.content}</p>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-white/10 bg-black/40 text-[11px] text-neutral-500 flex items-center justify-between">
          <span>Selective Memory Engine v2.0</span>
          <span>Zero-Leak Local & Cloud Isolation</span>
        </div>
      </div>
    </div>
  );
};
