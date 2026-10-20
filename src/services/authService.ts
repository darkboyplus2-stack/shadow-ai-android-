import {
  User,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  deleteUser,
  reauthenticateWithPopup,
} from 'firebase/auth';
import { auth, googleProvider } from './firebase';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  isGuest: boolean;
}

export type AuthStateCallback = (user: UserProfile | null) => void;

class AuthService {
  private currentUser: UserProfile | null = null;
  private listeners: Set<AuthStateCallback> = new Set();
  private isInitialized = false;

  constructor() {
    onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        this.currentUser = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          isGuest: false,
        };
      } else {
        this.currentUser = null;
      }
      this.isInitialized = true;
      this.notifyListeners();
    });
  }

  public getCurrentUser(): UserProfile | null {
    return this.currentUser;
  }

  public isGuest(): boolean {
    return !this.currentUser || this.currentUser.isGuest;
  }

  public isAuthReady(): boolean {
    return this.isInitialized;
  }

  public async getIdToken(): Promise<string | null> {
    const user = auth.currentUser;
    if (!user) return null;
    try {
      return await user.getIdToken();
    } catch {
      return null;
    }
  }

  public onAuthStateChanged(cb: AuthStateCallback): () => void {
    this.listeners.add(cb);
    if (this.isInitialized) {
      cb(this.currentUser);
    }
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentUser);
    }
  }

  public async signInWithGoogle(): Promise<UserProfile> {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const u = result.user;
      const profile: UserProfile = {
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        photoURL: u.photoURL,
        isGuest: false,
      };
      this.currentUser = profile;
      this.notifyListeners();
      return profile;
    } catch (err: any) {
      console.warn('[SHADOW AI Auth] Google sign-in canceled or failed:', err?.message || err);
      throw err;
    }
  }

  public async signOut(): Promise<void> {
    try {
      await fbSignOut(auth);
      this.currentUser = null;
      this.notifyListeners();
    } catch (err: any) {
      console.warn('[SHADOW AI Auth] Sign out error:', err?.message || err);
      throw err;
    }
  }

  public async reauthenticateWithGoogle(): Promise<void> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('No active user session found for re-authentication.');
    }
    await reauthenticateWithPopup(user, googleProvider);
  }

  public async deleteAccount(): Promise<void> {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('No active user session found to delete.');
    }
    await deleteUser(user);
    this.currentUser = null;
    this.notifyListeners();
  }

  /**
   * Test hook: Allows isolated testing environments to simulate auth state transitions
   */
  public setMockUser(user: UserProfile | null): void {
    this.currentUser = user;
    this.notifyListeners();
  }
}

export const authService = new AuthService();
