// Entry point: mounts the React app into the Tauri WebView.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { disableDefaultContextMenu } from '@/lib/disableDefaultContextMenu';
import '@/styles/global.css';

// Runs before any render: the WebView's stock right-click menu must never
// appear, custom menus (playlist rows) opt in via their own handlers.
disableDefaultContextMenu();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
