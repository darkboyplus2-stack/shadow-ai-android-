import React, { useState } from 'react';
import { ShadowInterface } from './components/ShadowInterface';
import { AndroidProjectView } from './components/AndroidProjectView';

export default function App() {
  const [currentView, setCurrentView] = useState<'hologram' | 'android-hub'>('hologram');

  return (
    <div className="w-full h-full bg-[#040407] overflow-hidden select-none">
      {currentView === 'hologram' ? (
        <ShadowInterface onOpenAndroidHub={() => setCurrentView('android-hub')} />
      ) : (
        <AndroidProjectView onBack={() => setCurrentView('hologram')} />
      )}
    </div>
  );
}
