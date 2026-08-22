import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { adoptOracleFromHash } from './game/arena/oracleLink'

// ORACLE MASTER LINK must be adopted BEFORE the HashRouter parses the URL —
// otherwise '#oracle=...' is mistaken for a route and nothing mounts.
// (testnet-only inside; mock/mainnet ignores it)
adoptOracleFromHash()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
