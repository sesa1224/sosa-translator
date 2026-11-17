import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/noto-serif-kr/400.css';
import '@fontsource/noto-serif-kr/600.css';
// Title fonts of the themes (theme.css --tfont). Rajdhani and Cinzel have no Hangul, so a Korean title falls
// through to the next font in the list.
import '@fontsource/rajdhani/600.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/nanum-brush-script/400.css';
import '@fontsource/song-myung/400.css';
import './theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
