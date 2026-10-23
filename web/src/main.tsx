import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, usePrefs } from './lib/prefs';
import '@fontsource-variable/inter';
import './styles.css';

applyTheme(usePrefs.getState().theme);
usePrefs.subscribe((p) => applyTheme(p.theme));

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
