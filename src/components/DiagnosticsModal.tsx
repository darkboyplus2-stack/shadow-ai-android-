import React, { useState, useEffect } from 'react';
import {
  X,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Zap,
  Mic,
  Clock,
  Cpu,
  Server,
  Layers,
} from 'lucide-react';
import { geminiService, ServerDiagnosticsData } from '../services/geminiService';
import { voiceService } from '../services/voiceService';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClearHistory: () => void;
}

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({
  isOpen,
  onClose,
  onClearHistory,
}) => {
  const [serverData, setServerData] = useState<ServerDiagnosticsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pingStatus, setPingStatus] = useState<string | null>(null);
  const [pingLatency, setPingLatency] = useState<number | null>(null);
  const [isPinging, setIsPinging] = useState(false);

  const clientDiag = geminiService.getLastDiagnostics();
  const voiceDiag = voiceService.getLastDiagnostics();

  const fetchDiagnostics = async () => {
    setIsLoading(true);
    try {
      const data = await geminiService.fetchServerDiagnostics();
      setServerData(data);
    } catch {
      // Ignored
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDiagnostics();
    }
  }, [isOpen]);

  const handlePingTest = async () => {
    setIsPinging(true);
    setPingStatus('Testing AI service connection...');
    const start = Date.now();
    try {
      const res = await geminiService.sendMessage('ping', 'standard', 'concise', null, 0);
      const elapsed = Date.now() - start;
      setPingLatency(elapsed);
      setPingStatus(`Success: ${res.modelUsed} responded in ${elapsed}ms`);
      fetchDiagnostics();
    } catch (err: any) {
      const elapsed = Date.now() - start;
      setPingLatency(elapsed);
      setPingStatus(`Failed (${err.code || 'ERROR'}): ${err.userMessage || err.message}`);
      fetchDiagnostics();
    } finally {
      setIsPinging(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/80 backdrop-blur-md animate-in fade-in">
      <div className="w-full max-w-lg max-h-[90vh] bg-[#090b14] border border-white/20 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-white font-mono text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#0c0e1a]">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span className="font-bold tracking-wider uppercase text-sm">
              SHADOW AI System Diagnostics
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition"
            title="Close diagnostics"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Quick Actions & Ping Bar */}
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <div className="font-semibold text-white">Live AI Connection Test</div>
                <div className="text-[10px] text-neutral-400">
                  {pingStatus || 'Verify end-to-end proxy connectivity & response time'}
                </div>
              </div>
            </div>
            <button
              onClick={handlePingTest}
              disabled={isPinging}
              className="px-3 py-1.5 rounded-lg bg-white text-black font-semibold hover:bg-slate-200 transition disabled:opacity-50 shrink-0 flex items-center space-x-1.5 text-xs shadow"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin' : ''}`} />
              <span>{isPinging ? 'Testing...' : 'Ping AI'}</span>
            </button>
          </div>

          {/* Last Request Status Card */}
          <div className="p-3 rounded-xl bg-black/60 border border-white/10 space-y-2">
            <div className="text-neutral-400 font-semibold flex items-center justify-between text-[11px]">
              <span className="flex items-center space-x-1.5">
                <Server className="w-3.5 h-3.5 text-slate-300" />
                <span>Last Client Request</span>
              </span>
              <span className="text-[10px] text-neutral-500">{clientDiag.timestamp.slice(11, 19)}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                <span className="text-neutral-400 block text-[9px] uppercase">Status</span>
                <span
                  className={`font-bold flex items-center space-x-1 ${
                    clientDiag.lastStatus === 200
                      ? 'text-emerald-400'
                      : clientDiag.lastStatus === 429 || clientDiag.lastStatus === 503
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}
                >
                  {clientDiag.lastStatus === 200 ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : clientDiag.lastStatus === 429 || clientDiag.lastStatus === 503 ? (
                    <AlertTriangle className="w-3 h-3" />
                  ) : (
                    <XCircle className="w-3 h-3" />
                  )}
                  <span>
                    {clientDiag.lastStatus === 200 ? '200 OK' : `HTTP ${clientDiag.lastStatus} (${clientDiag.lastCode})`}
                  </span>
                </span>
              </div>

              <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                <span className="text-neutral-400 block text-[9px] uppercase">Latency</span>
                <span className="font-semibold text-white flex items-center space-x-1">
                  <Clock className="w-3 h-3 text-neutral-400" />
                  <span>{clientDiag.lastLatencyMs}ms</span>
                </span>
              </div>
            </div>

            {clientDiag.lastModel && (
              <div className="text-[11px] text-neutral-300 flex items-center space-x-1.5">
                <Cpu className="w-3 h-3 text-cyan-400 shrink-0" />
                <span>Model used:</span>
                <span className="font-bold text-white">{clientDiag.lastModel}</span>
              </div>
            )}

            {clientDiag.lastDetail && (
              <div className="p-2 rounded-lg bg-rose-950/40 border border-rose-500/30 text-[10px] text-rose-200">
                <div className="font-bold text-rose-300 mb-0.5">Error Detail:</div>
                <div className="break-all">{clientDiag.lastDetail}</div>
              </div>
            )}
          </div>

          {/* Voice Input Pipeline Diagnostics */}
          <div className="p-3 rounded-xl bg-black/60 border border-white/10 space-y-2">
            <div className="text-neutral-400 font-semibold flex items-center justify-between text-[11px]">
              <span className="flex items-center space-x-1.5">
                <Mic className="w-3.5 h-3.5 text-amber-400" />
                <span>Microphone & Voice Engine</span>
              </span>
              <span className="text-[10px] text-neutral-500">
                {voiceDiag.engineUsed !== 'none' ? voiceDiag.engineUsed : 'Ready'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <div className="p-2 rounded-lg bg-white/5 border border-white/5 text-center">
                <span className="text-neutral-400 block text-[9px] uppercase">Peak Volume</span>
                <span className="font-bold text-white text-xs">
                  {Math.round(voiceDiag.peakRms * 100)}%
                </span>
              </div>
              <div className="p-2 rounded-lg bg-white/5 border border-white/5 text-center">
                <span className="text-neutral-400 block text-[9px] uppercase">Speech Heard</span>
                <span
                  className={`font-bold text-xs ${
                    voiceDiag.speechDetected ? 'text-emerald-400' : 'text-neutral-400'
                  }`}
                >
                  {voiceDiag.speechDetected ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="p-2 rounded-lg bg-white/5 border border-white/5 text-center">
                <span className="text-neutral-400 block text-[9px] uppercase">Duration</span>
                <span className="font-bold text-white text-xs">
                  {(voiceDiag.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
            </div>
          </div>

          {/* Recent Server Transaction Logs */}
          <div className="p-3 rounded-xl bg-black/60 border border-white/10 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-semibold">
              <span className="flex items-center space-x-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-300" />
                <span>Recent Backend Logs (Last 10)</span>
              </span>
              <button
                onClick={fetchDiagnostics}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center space-x-1"
              >
                <RefreshCw className={`w-2.5 h-2.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {serverData?.recentLogs && serverData.recentLogs.length > 0 ? (
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {serverData.recentLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2 rounded-lg bg-white/5 border border-white/5 flex items-start justify-between text-[10px] space-x-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-1.5">
                        <span
                          className={`px-1 py-0.2 rounded text-[9px] font-bold ${
                            log.status === 200
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : log.status === 429 || log.status === 503
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          }`}
                        >
                          {log.status} {log.code}
                        </span>
                        <span className="text-neutral-400 truncate">{log.endpoint}</span>
                      </div>
                      {log.errorDetail && (
                        <div className="text-rose-300 mt-1 truncate">{log.errorDetail}</div>
                      )}
                    </div>
                    <div className="text-neutral-500 text-[9px] shrink-0 text-right">
                      <div>{log.latencyMs}ms</div>
                      <div>{log.timestamp.slice(11, 19)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-neutral-500 text-[10px] py-2 text-center">
                {isLoading ? 'Loading server logs...' : 'No transactions recorded yet.'}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/10 bg-[#0c0e1a] flex items-center justify-between">
          <button
            onClick={() => {
              onClearHistory();
              geminiService.clearHistory();
              onClose();
            }}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition text-[11px]"
          >
            Clear Conversation Memory
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-white text-black font-semibold hover:bg-slate-200 transition text-[11px]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
