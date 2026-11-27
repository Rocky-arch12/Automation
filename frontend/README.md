# AlphaSignal AI — React + Vite + React Bits Frontend

Modern React migration of the AlphaSignal AI frontend (`static/`), preserving 100% of API endpoints, WebSocket streams, authentication/whitelist checks, XM MT5 position controls, signal simulation, and AES-256 backend settings integration.

## Tech Stack
- **React 19 + Vite**
- **React Router DOM** (clean path routes + legacy `#hash` compatibility)
- **React Bits (`reactbits.dev`)**: `SpotlightCard`, `CountUp`, `BlurText`, `ShinyText`, `ClickSpark`, `Particles`
- **Lucide React** & **Chart.js**

## Local Development

1. Start the Python FastAPI backend (in repository root):
   ```powershell
   .\run_server.bat
   # Backend runs on http://127.0.0.1:8000
   ```
2. Install & start the React frontend:
   ```powershell
   cd frontend
   npm install
   npm run dev
   ```
   Open `http://localhost:5173`. Vite proxies `/api`, `/ws`, `/uploads`, and `/sample_signals` to `http://127.0.0.1:8000` automatically.

## Production Build

```powershell
cd frontend
npm run lint
npm run build
```
Outputs optimized chunks to `frontend/dist/`.

## Vercel Deployment Configuration

1. In **Vercel Project Settings -> Build & Deployment**:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
2. In **Vercel Project Settings -> Environment Variables**:
   - `VITE_API_URL` = `https://plod-exonerate-october.ngrok-free.dev` (or your active Cloudflare/Ngrok tunnel URL)
3. [`vercel.json`](./vercel.json) provides:
   - SPA fallback rewrite (`/(.*) -> /index.html`) for client-side React Router routes
   - HTTP header `Cross-Origin-Opener-Policy: same-origin-allow-popups` for Google Identity Services OAuth
4. Ensure your Vercel deployment domain is listed in Google Cloud Console OAuth **Authorized JavaScript origins** and **Authorized redirect URIs** (`https://<your-domain>/`).
