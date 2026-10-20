import React, { useState, useEffect } from 'react';
import { authService, UserProfile } from '../services/authService';
import { memoryService } from '../services/memoryService';
import { sessionService } from '../services/sessionService';
import { migrationService, PendingGuestData } from '../services/migrationService';
import {
  X,
  LogIn,
  LogOut,
  ShieldCheck,
  Cloud,
  CheckCircle2,
  Trash2,
  AlertTriangle,
  AlertCircle,
  KeyRound,
  Loader2,
  User,
  ArrowRightLeft,
  SkipForward,
  FolderSync,
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Account deletion states (SEC-01)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionStep, setDeletionStep] = useState<string | null>(null);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [requiresReauth, setRequiresReauth] = useState(false);
  const [isReauthenticating, setIsReauthenticating] = useState(false);
  const [partialNotice, setPartialNotice] = useState(false);

  // Guest data migration states (SEC-03)
  const [showMigrationConfirm, setShowMigrationConfirm] = useState(false);
  const [pendingGuestData, setPendingGuestData] = useState<PendingGuestData | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [migrationSuccess, setMigrationSuccess] = useState<string | null>(null);

  useEffect(() => {
    setUser(authService.getCurrentUser());
    const unsub = authService.onAuthStateChanged((u) => {
      setUser(u);
      if (u && !u.isGuest) {
        const pending = migrationService.getPendingGuestData();
        if (pending.hasData && !migrationService.isMigrationSkipped(u.uid)) {
          setPendingGuestData(pending);
        } else {
          setPendingGuestData(null);
        }
      } else {
        setPendingGuestData(null);
        setShowMigrationConfirm(false);
      }
    });
    return () => unsub();
  }, []);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    setMigrationError(null);
    setMigrationSuccess(null);
    try {
      const profile = await authService.signInWithGoogle();
      const pending = migrationService.getPendingGuestData();
      if (pending.hasData && !migrationService.isMigrationSkipped(profile.uid)) {
        setPendingGuestData(pending);
        setShowMigrationConfirm(true);
      } else {
        onClose();
      }
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setError(err?.message || 'Failed to sign in with Google. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    setError(null);
    setMigrationSuccess(null);
    setShowMigrationConfirm(false);
    try {
      await authService.signOut();
    } catch (err: any) {
      setError(err?.message || 'Failed to sign out.');
    } finally {
      setLoading(false);
    }
  };

  const handleImportGuestData = async () => {
    if (!user || isImporting) return;

    setIsImporting(true);
    setMigrationError(null);
    try {
      const result = await migrationService.importGuestDataToUser(user.uid);
      setMigrationSuccess(
        `Successfully imported ${result.migratedMemoriesCount} memories and ${result.migratedSessionsCount} conversation sessions into your Google account.`
      );
      setPendingGuestData(null);
      setShowMigrationConfirm(false);
    } catch (err: any) {
      setMigrationError(err?.message || 'Failed to import guest data. Please try again.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleSkipMigration = () => {
    if (user) {
      migrationService.skipGuestData(user.uid);
    }
    setShowMigrationConfirm(false);
    setPendingGuestData(null);
    onClose();
  };

  const handleCancelMigration = async () => {
    setShowMigrationConfirm(false);
    setPendingGuestData(null);
    await migrationService.cancelMigration();
    onClose();
  };

  const handleDeleteAccount = async () => {
    if (!user || isDeleting || isReauthenticating || memoryService.isAccountDeletionInProgress()) return;

    setIsDeleting(true);
    setDeletionError(null);
    setRequiresReauth(false);
    setPartialNotice(false);

    try {
      // 1. Purge and verify cloud data
      setDeletionStep('Cleaning cloud memories, conversations, and preferences...');
      await memoryService.deleteAllAccountData(user.uid);

      // 2. Only proceed to Firebase Auth account deletion after full verified cleanup
      setDeletionStep('Removing authentication credentials...');
      await authService.deleteAccount();

      // 3. Clear session cache
      sessionService.resetForAccountDeletion();

      setDeletionStep(null);
      setShowDeleteConfirm(false);
      onClose();
    } catch (err: any) {
      console.error('[SHADOW AI] Account deletion error:', err);
      const isRecentLogin =
        err?.code === 'auth/requires-recent-login' ||
        String(err?.message).includes('requires-recent-login') ||
        String(err?.message).includes('CREDENTIAL_TOO_OLD_LOGIN_AGAIN');

      if (isRecentLogin) {
        setRequiresReauth(true);
        setDeletionError(
          'Firebase security requires a recent sign-in before deleting your account credentials. Cloud data cleanup has completed or is in progress. Please re-authenticate below to finish account deletion.'
        );
      } else {
        setPartialNotice(true);
        setDeletionError(
          err?.message ||
          'Failed to complete account deletion. Note: Deletion is not atomic; some records may already have been removed. Your account remains active so you can safely retry the cleanup.'
        );
      }
    } finally {
      setIsDeleting(false);
      setDeletionStep(null);
    }
  };

  const handleReauthAndComplete = async () => {
    if (!user || isReauthenticating || isDeleting) return;

    setIsReauthenticating(true);
    setDeletionError(null);
    try {
      await authService.reauthenticateWithGoogle();
      setRequiresReauth(false);
      // Re-authenticated: complete credentials removal
      setIsDeleting(true);
      setDeletionStep('Removing authentication credentials...');
      await authService.deleteAccount();
      sessionService.resetForAccountDeletion();
      setShowDeleteConfirm(false);
      onClose();
    } catch (reauthErr: any) {
      setDeletionError(reauthErr?.message || 'Re-authentication failed. Please try again.');
    } finally {
      setIsReauthenticating(false);
      setIsDeleting(false);
      setDeletionStep(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in">
      <div className="w-full max-w-md bg-[#0b0d17] border border-white/20 rounded-2xl p-6 text-neutral-200 shadow-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-neutral-400 hover:text-white rounded-full hover:bg-neutral-800/60 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-white/10">
          <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/30 flex items-center justify-center text-white shadow-md">
            {showMigrationConfirm ? (
              <ArrowRightLeft className="w-5 h-5 text-cyan-400" />
            ) : (
              <Cloud className="w-5 h-5 text-amber-400" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-wide">
              {showMigrationConfirm
                ? 'GUEST DATA MIGRATION'
                : user
                ? 'ACCOUNT & CLOUD SYNC'
                : 'SIGN IN TO SHADOW AI'}
            </h2>
            <p className="text-xs text-neutral-400">
              {showMigrationConfirm
                ? 'Confirm importing local guest memories & chat sessions'
                : user
                ? 'Private multi-device synchronization active'
                : 'Sync memories and preferences across devices'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950/60 border border-red-500/40 rounded-xl text-xs text-red-200">
            {error}
          </div>
        )}

        {/* Migration Confirmation View (SEC-03) */}
        {showMigrationConfirm && user && pendingGuestData ? (
          <div className="space-y-4 animate-in fade-in">
            {/* Target Account Notice */}
            <div className="p-3.5 rounded-xl bg-neutral-900/80 border border-cyan-500/30 space-y-2">
              <div className="flex items-center space-x-2 text-xs text-cyan-300 font-semibold">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                <span>Target Google Account</span>
              </div>
              <div className="text-xs space-y-0.5">
                <p className="font-bold text-white">{user.displayName || 'Google User'}</p>
                <p className="text-neutral-400 text-[11px] truncate">{user.email}</p>
                <p className="text-[10px] text-neutral-500 font-mono">UID: {user.uid}</p>
              </div>
              <p className="text-[11px] text-neutral-300/90 pt-1 border-t border-white/10">
                Your existing cloud memories and conversations in this Google account will be preserved and merged safely.
              </p>
            </div>

            {/* What Will Be Imported */}
            <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-white/10 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold text-white">
                <span>Data To Be Imported:</span>
                <span className="text-neutral-400 text-[11px]">Local Device Storage</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
                  <div className="text-lg font-bold text-cyan-400">{pendingGuestData.summary.memoryCount}</div>
                  <div className="text-[10px] text-neutral-400">Guest Memories</div>
                </div>
                <div className="p-2.5 rounded-lg bg-white/5 border border-white/10">
                  <div className="text-lg font-bold text-emerald-400">{pendingGuestData.summary.sessionCount}</div>
                  <div className="text-[10px] text-neutral-400">Chat Sessions</div>
                </div>
              </div>

              {/* Preview items if any */}
              {pendingGuestData.memories.length > 0 && (
                <div className="space-y-1 pt-1">
                  <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Memories Preview</p>
                  <div className="max-h-24 overflow-y-auto space-y-1 pr-1 text-[11px]">
                    {pendingGuestData.memories.slice(0, 4).map((m) => (
                      <div key={m.id} className="p-1.5 rounded bg-black/40 border border-white/5 text-neutral-300 truncate">
                        • {m.content}
                      </div>
                    ))}
                    {pendingGuestData.memories.length > 4 && (
                      <p className="text-[10px] text-neutral-500 italic">
                        +{pendingGuestData.memories.length - 4} more memories
                      </p>
                    )}
                  </div>
                </div>
              )}

              {pendingGuestData.sessions.length > 0 && (
                <div className="space-y-1 pt-1">
                  <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">Conversations Preview</p>
                  <div className="max-h-20 overflow-y-auto space-y-1 pr-1 text-[11px]">
                    {pendingGuestData.sessions.slice(0, 3).map((s) => (
                      <div key={s.id} className="p-1.5 rounded bg-black/40 border border-white/5 text-neutral-300 truncate flex justify-between">
                        <span>{s.title}</span>
                        <span className="text-neutral-500 text-[10px]">{s.messages.length} msgs</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Error banner if import failed */}
            {migrationError && (
              <div className="p-3 bg-red-950/70 border border-red-500/50 rounded-xl text-xs text-red-200 space-y-1">
                <div className="font-semibold text-red-100 flex items-center space-x-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  <span>Migration Error</span>
                </div>
                <p className="text-[11px] leading-relaxed">{migrationError}</p>
                <p className="text-[10px] text-red-300/80">Local guest data has NOT been deleted. You can safely retry.</p>
              </div>
            )}

            {/* Three Required Action Options: Import, Skip, Cancel (SEC-03 Req 3) */}
            <div className="pt-2 space-y-2.5">
              <button
                onClick={handleImportGuestData}
                disabled={isImporting}
                className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs flex items-center justify-center space-x-2 transition shadow-lg shadow-cyan-500/20 disabled:opacity-50"
              >
                {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                <span>Import Guest Data to Account</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleSkipMigration}
                  disabled={isImporting}
                  className="py-2 px-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium text-xs flex items-center justify-center space-x-1.5 transition border border-white/10 disabled:opacity-50"
                  title="Keep guest data locally on this device without importing to cloud"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  <span>Skip</span>
                </button>

                <button
                  onClick={handleCancelMigration}
                  disabled={isImporting}
                  className="py-2 px-3 rounded-xl bg-neutral-800/60 hover:bg-red-500/20 text-neutral-400 hover:text-red-300 font-medium text-xs flex items-center justify-center space-x-1.5 transition border border-white/5 disabled:opacity-50"
                  title="Cancel sign in and return to Guest mode"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel Sign-In</span>
                </button>
              </div>

              <p className="text-[10px] text-neutral-400/80 text-center leading-relaxed">
                Skip and Cancel will preserve your local guest data on this device without uploading or deleting it.
              </p>
            </div>
          </div>
        ) : user ? (
          /* Authenticated User Profile View */
          <div className="space-y-6">
            <div className="p-4 rounded-xl bg-neutral-900/60 border border-white/10 flex items-center space-x-3">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  className="w-12 h-12 rounded-full border border-white/20"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-neutral-800 border border-white/20 flex items-center justify-center text-white">
                  <User className="w-6 h-6" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white truncate">{user.displayName || 'Shadow User'}</p>
                <p className="text-xs text-neutral-400 truncate">{user.email}</p>
                <div className="flex items-center space-x-1.5 mt-1 text-[11px] text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Cloud Firestore Sync Active</span>
                </div>
              </div>
            </div>

            {/* Migration Success Notice */}
            {migrationSuccess && (
              <div className="p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-xl text-xs text-emerald-200 flex items-start space-x-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{migrationSuccess}</span>
              </div>
            )}

            {/* Pending Guest Data Banner */}
            {pendingGuestData && pendingGuestData.hasData && (
              <div className="p-3.5 bg-cyan-950/40 border border-cyan-500/30 rounded-xl space-y-2 animate-in fade-in">
                <div className="flex items-center space-x-2 text-xs text-cyan-300 font-semibold">
                  <FolderSync className="w-4 h-4 text-cyan-400" />
                  <span>Unimported Guest Data on Device</span>
                </div>
                <p className="text-[11px] text-neutral-300/90 leading-relaxed">
                  Found {pendingGuestData.summary.memoryCount} memories and {pendingGuestData.summary.sessionCount} conversation sessions saved locally on this device.
                </p>
                <button
                  onClick={() => setShowMigrationConfirm(true)}
                  className="w-full py-2 px-3 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-xs font-medium flex items-center justify-center space-x-1.5 transition"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Review & Import to Cloud Account</span>
                </button>
              </div>
            )}

            <div className="space-y-2 text-xs text-neutral-300">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Isolated Private Database (`users/{user.uid.slice(0, 8)}...`)</span>
              </div>
              <div className="flex items-center space-x-2">
                <Cloud className="w-4 h-4 text-amber-400" />
                <span>Automatic cross-device memory recall enabled</span>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-2 space-y-3">
              <button
                onClick={handleSignOut}
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium text-xs flex items-center justify-center space-x-2 transition border border-white/10"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                <span>Sign Out of Account</span>
              </button>

              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full py-2 px-4 rounded-xl text-red-400 hover:bg-red-500/10 text-xs font-medium flex items-center justify-center space-x-2 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Account & Cloud Data</span>
              </button>
            </div>

            {/* Delete Confirmation */}
            {showDeleteConfirm && (
              <div className="p-4 bg-red-950/80 border border-red-500/40 rounded-xl space-y-3 animate-in fade-in">
                <div className="flex items-center space-x-2 text-red-200 font-bold text-xs">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>Permanently Delete Account & Cloud Data?</span>
                </div>

                <p className="text-red-300/80 text-[11px] leading-relaxed">
                  This will delete all stored memories, chat sessions, and settings from Cloud Firestore, and remove your authentication credentials.
                </p>

                {deletionStep && (
                  <div className="p-2.5 rounded-lg bg-neutral-900/90 border border-amber-500/40 flex items-center space-x-2 text-xs text-amber-300">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-amber-400" />
                    <span>{deletionStep}</span>
                  </div>
                )}

                {deletionError && (
                  <div className="p-3 bg-red-900/60 border border-red-500/60 rounded-lg text-[11px] text-red-200 space-y-1.5">
                    <div className="font-semibold text-red-100 flex items-center space-x-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span>Deletion Interrupted</span>
                    </div>
                    <p className="leading-relaxed">{deletionError}</p>
                    {partialNotice && (
                      <p className="text-[10px] text-red-300/90 italic pt-1 border-t border-red-800/50">
                        Notice: Deletion is not atomic. If an error occurred mid-way, some documents may already have been removed. Your account remains active so you can safely retry the remaining cleanup.
                      </p>
                    )}
                  </div>
                )}

                {requiresReauth ? (
                  <div className="pt-1 space-y-2">
                    <button
                      onClick={handleReauthAndComplete}
                      disabled={isReauthenticating || isDeleting}
                      className="w-full py-2.5 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs flex items-center justify-center space-x-2 transition shadow-lg"
                    >
                      {isReauthenticating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <KeyRound className="w-3.5 h-3.5" />
                      )}
                      <span>Re-authenticate with Google & Finish Deletion</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setDeletionError(null);
                        setRequiresReauth(false);
                        setPartialNotice(false);
                      }}
                      disabled={isReauthenticating || isDeleting}
                      className="w-full py-1 text-xs text-neutral-400 hover:text-white transition"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex justify-end space-x-2 pt-1">
                    <button
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setDeletionError(null);
                        setPartialNotice(false);
                      }}
                      disabled={isDeleting}
                      className="px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-300 text-xs hover:text-white transition disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDeleteAccount}
                      disabled={isDeleting}
                      className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center space-x-1.5 transition disabled:opacity-50"
                    >
                      {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      <span>{deletionError ? 'Retry Cleanup & Delete' : 'Confirm Delete'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Sign-In View */
          <div className="space-y-6">
            <div className="space-y-3 text-xs text-neutral-300 leading-relaxed">
              <div className="p-3.5 rounded-xl bg-neutral-900/60 border border-white/10 space-y-2">
                <div className="flex items-center space-x-2 text-white font-semibold">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Cross-Device Intelligence</span>
                </div>
                <p className="text-neutral-400 text-[11px]">
                  Sign in with your Google account to access your personalized SHADOW memories, preferences, and conversations from any browser, tablet, or phone.
                </p>
              </div>

              <div className="space-y-1.5 pl-1 text-[11px] text-neutral-400">
                <p>• Zero data leakage: records are isolated to your authenticated UID.</p>
                <p>• Safe guest migration: local data is only imported with your explicit confirmation.</p>
                <p>• Offline resilience: local caches keep working if offline.</p>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl bg-white text-black font-bold text-xs flex items-center justify-center space-x-3 hover:bg-neutral-200 transition shadow-lg shadow-white/5 active:scale-[0.99]"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-black" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                    />
                  </svg>
                )}
                <span>Sign in with Google</span>
              </button>

              <button
                onClick={onClose}
                className="w-full py-2 text-xs text-neutral-400 hover:text-white transition text-center"
              >
                Continue as Guest (Local Only)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
