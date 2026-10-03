import { useEffect, useState } from 'react';
import type { StudioflowApi } from '../preload/index';
import { versionLabel } from './version-label';

declare global {
  interface Window {
    studioflow: StudioflowApi;
  }
}

export function App() {
  const [label, setLabel] = useState('…');
  useEffect(() => {
    void window.studioflow.coreVersion().then((v) => setLabel(versionLabel(v)));
  }, []);
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>StudioFlow</h1>
      <p data-testid="core-version">{label}</p>
    </main>
  );
}
