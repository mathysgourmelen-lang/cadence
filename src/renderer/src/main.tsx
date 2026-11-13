import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { AppProvider, isDemo } from './state'
import { FeedbackProvider } from './ui'

if (isDemo) document.body.classList.add('web')

// Dropping a file anywhere outside a drop zone must never navigate the window away.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FeedbackProvider>
      <AppProvider>
        <App />
      </AppProvider>
    </FeedbackProvider>
  </StrictMode>
)
