import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { AppProvider } from './context/AppContext.jsx';
import App from './App.jsx';
import './styles/app.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <AppProvider>
          <App />
        </AppProvider>
      </MotionConfig>
    </BrowserRouter>
  </StrictMode>
);
