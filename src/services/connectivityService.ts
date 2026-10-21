/**
 * SHADOW AI — Connectivity & Backend Detection Service
 *
 * Tracks network connectivity and AI server availability cleanly and reliably:
 * - Listens to browser online/offline events without battery-draining polling.
 * - Distinguishes general internet connectivity from backend AI server reachability.
 * - Respects Offline Mode preferences and coordinates with the local AI model state.
 */

export type NetworkStatus = 'ONLINE' | 'OFFLINE' | 'CHECKING';
export type BackendStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';

export type OverallConnectivityState =
  | 'ONLINE'
  | 'OFFLINE'
  | 'CHECKING'
  | 'AI_SERVER_UNAVAILABLE'
  | 'LOCAL_AI_READY'
  | 'LOCAL_AI_UNAVAILABLE';

export type ConnectivityState = OverallConnectivityState;

export interface ConnectivityDiagnostics {
  networkStatus: NetworkStatus;
  backendStatus: BackendStatus;
  overallState: OverallConnectivityState;
  lastCheckedTimestamp: string;
  lastLatencyMs: number | null;
  offlineModeEnabled: boolean;
  localAiReady: boolean;
}

export type ConnectivitySubscriber = (diagnostics: ConnectivityDiagnostics) => void;

class ConnectivityService {
  private networkStatus: NetworkStatus = typeof navigator !== 'undefined' && navigator.onLine ? 'ONLINE' : 'OFFLINE';
  private backendStatus: BackendStatus = 'UNKNOWN';
  private lastLatencyMs: number | null = null;
  private lastCheckedTimestamp: string = new Date().toISOString();
  private subscribers: Set<ConnectivitySubscriber> = new Set();
  private isCheckingBackend: boolean = false;
  private offlineModeEnabled: boolean = false;
  private localAiReady: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnlineEvent);
      window.addEventListener('offline', this.handleOfflineEvent);
      // Run an initial lightweight health check after startup
      setTimeout(() => {
        this.checkBackendHealth();
      }, 1000);
    }
  }

  private handleOnlineEvent = () => {
    this.networkStatus = 'ONLINE';
    this.checkBackendHealth();
    this.notifySubscribers();
  };

  private handleOfflineEvent = () => {
    this.networkStatus = 'OFFLINE';
    this.backendStatus = 'UNAVAILABLE';
    this.notifySubscribers();
  };

  /**
   * Sets whether Offline Mode is actively enabled by the user in settings.
   */
  public setOfflineModeEnabled(enabled: boolean, localAiReady: boolean): void {
    this.offlineModeEnabled = enabled;
    this.localAiReady = localAiReady;
    this.notifySubscribers();
  }

  /**
   * Updates the readiness state of the local AI model.
   */
  public setLocalAiReady(ready: boolean): void {
    this.localAiReady = ready;
    this.notifySubscribers();
  }

  /**
   * Determines the overall cohesive connectivity state.
   */
  public getOverallState(): OverallConnectivityState {
    if (this.networkStatus === 'OFFLINE') {
      return this.localAiReady ? 'LOCAL_AI_READY' : 'OFFLINE';
    }

    if (this.offlineModeEnabled && this.localAiReady) {
      return 'LOCAL_AI_READY';
    }

    if (this.backendStatus === 'UNAVAILABLE') {
      return this.localAiReady ? 'LOCAL_AI_READY' : 'AI_SERVER_UNAVAILABLE';
    }

    if (this.networkStatus === 'CHECKING') {
      return 'CHECKING';
    }

    return 'ONLINE';
  }

  public getState(): OverallConnectivityState {
    return this.getOverallState();
  }

  public setSimulatedState(state: OverallConnectivityState): void {
    if (state === 'OFFLINE') {
      this.networkStatus = 'OFFLINE';
      this.backendStatus = 'UNAVAILABLE';
    } else if (state === 'ONLINE') {
      this.networkStatus = 'ONLINE';
      this.backendStatus = 'AVAILABLE';
    } else if (state === 'LOCAL_AI_READY') {
      this.localAiReady = true;
    }
    this.lastCheckedTimestamp = new Date().toISOString();
    this.notifySubscribers();
  }

  /**
   * Performs a lightweight, non-blocking check against the /api/status endpoint.
   */
  public async checkBackendHealth(): Promise<boolean> {
    if (typeof fetch === 'undefined') return false;
    if (this.networkStatus === 'OFFLINE') {
      this.backendStatus = 'UNAVAILABLE';
      this.notifySubscribers();
      return false;
    }

    if (this.isCheckingBackend) return this.backendStatus === 'AVAILABLE';
    this.isCheckingBackend = true;

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch('/api/status', {
        method: 'GET',
        cache: 'no-cache',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency = Date.now() - start;

      if (response.ok) {
        this.backendStatus = 'AVAILABLE';
        this.lastLatencyMs = latency;
        this.networkStatus = 'ONLINE';
      } else {
        this.backendStatus = 'UNAVAILABLE';
      }
    } catch {
      // If fetch fails or aborts, server is unreachable
      this.backendStatus = 'UNAVAILABLE';
    } finally {
      this.isCheckingBackend = false;
      this.lastCheckedTimestamp = new Date().toISOString();
      this.notifySubscribers();
    }

    return this.backendStatus === 'AVAILABLE';
  }

  public getDiagnostics(): ConnectivityDiagnostics {
    return {
      networkStatus: this.networkStatus,
      backendStatus: this.backendStatus,
      overallState: this.getOverallState(),
      lastCheckedTimestamp: this.lastCheckedTimestamp,
      lastLatencyMs: this.lastLatencyMs,
      offlineModeEnabled: this.offlineModeEnabled,
      localAiReady: this.localAiReady,
    };
  }

  public isOnline(): boolean {
    return this.networkStatus === 'ONLINE' && this.backendStatus === 'AVAILABLE';
  }

  public isNetworkConnected(): boolean {
    return this.networkStatus === 'ONLINE';
  }

  public subscribe(subscriber: ConnectivitySubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.getDiagnostics());
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private notifySubscribers(): void {
    const diag = this.getDiagnostics();
    this.subscribers.forEach((sub) => {
      try {
        sub(diag);
      } catch (err) {
        console.warn('[ConnectivityService] subscriber error:', err);
      }
    });
  }

  /**
   * Test-only helper to simulate network transitions.
   */
  public setMockStateForTesting(state: {
    networkStatus?: NetworkStatus;
    backendStatus?: BackendStatus;
    offlineModeEnabled?: boolean;
    localAiReady?: boolean;
  }): void {
    if (state.networkStatus !== undefined) this.networkStatus = state.networkStatus;
    if (state.backendStatus !== undefined) this.backendStatus = state.backendStatus;
    if (state.offlineModeEnabled !== undefined) this.offlineModeEnabled = state.offlineModeEnabled;
    if (state.localAiReady !== undefined) this.localAiReady = state.localAiReady;
    this.lastCheckedTimestamp = new Date().toISOString();
    this.notifySubscribers();
  }

  public cleanup(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnlineEvent);
      window.removeEventListener('offline', this.handleOfflineEvent);
    }
    this.subscribers.clear();
  }
}

export const connectivityService = new ConnectivityService();
