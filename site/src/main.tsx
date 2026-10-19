import './polyfill.ts'; // must stay first
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import './theme.css';

createRoot(document.getElementById('root')!).render(<App />);
