/* Where the incidents come from.
   On a local page: GET /incidents from the FastAPI server in src/backend (uvicorn on port 8000). Its CORS_ORIGINS must list this page's
   origin; http://localhost:5173 is in its defaults. If the server isn't running, the page falls back to data.js and says so.
   Anywhere else (GitHub Pages, say) the browser can't reach a server on your machine, so it goes straight to data.js, the saved copy of the database.
   On a local page ?api=http://host:port overrides this. */
window.MRS_API = ['localhost', '127.0.0.1'].includes(location.hostname) ? 'http://localhost:8000' : '';
