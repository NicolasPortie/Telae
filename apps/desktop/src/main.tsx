import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App.tsx'
import { resolveLocale, setLocale } from './i18n'

// Idioma do sistema desde o primeiro quadro; a preferência salva é aplicada logo depois pelo App.
setLocale(resolveLocale('auto', navigator.language))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
