import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, usePrefs } from './lib/prefs';
import '@fontsource-variable/inter';
// Fonts people can pick for their name (only downloaded when someone uses them).
import '@fontsource/nunito/latin-800.css';
import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/press-start-2p/latin-400.css';
import '@fontsource/pacifico/latin-400.css';
import '@fontsource/bungee/latin-400.css';
import '@fontsource/orbitron/latin-700.css';
import './styles.css';

applyTheme(usePrefs.getState().theme);
usePrefs.subscribe((p) => applyTheme(p.theme));

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
