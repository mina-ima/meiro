import React from 'react';
import ReactDOM from 'react-dom/client';
import { initSentry } from './logging/sentry';
import { App } from './app';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Failed to find root element');
}

initSentry();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
