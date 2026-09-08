import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Two routes is not worth a router dependency. The static host rewrites every
// path to index.html (see render.yaml), so the path is readable here.
const isPresenting = window.location.pathname.replace(/\/+$/, '') === '/present';

// Loaded only when presenting. The deck parsers (JSZip, and pdf.js behind its
// own dynamic import) are large, and nobody visiting the main page needs them.
const PresentPage = React.lazy(() => import('./present/PresentPage'));

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        {isPresenting ? (
            <Suspense fallback={null}>
                <PresentPage />
            </Suspense>
        ) : (
            <App />
        )}
    </React.StrictMode>,
);
