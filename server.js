// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, Databases } = require('node-appwrite');

const app = express();
app.use(cors());
app.use(express.json());

// ================= Env =================
const {
  PORT = 10000,
  DEV_MODE = 'false',
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  APPWRITE_API_KEY,
  APPWRITE_DB_ID,
  APPWRITE_2FA_COLLECTION_ID,
} = process.env;

// ================= Appwrite (opcional) =================
let appwriteDB = null;
try {
  if (APPWRITE_ENDPOINT && APPWRITE_PROJECT_ID && APPWRITE_API_KEY) {
    const client = new Client()
      .setEndpoint(APPWRITE_ENDPOINT)
      .setProject(APPWRITE_PROJECT_ID)
      .setKey(APPWRITE_API_KEY);

    appwriteDB = new Databases(client);
    console.log('[OK] Appwrite conectado');
  } else {
    console.warn('[WARN] Variáveis do Appwrite ausentes. Use /debug/env para conferir.');
  }
} catch (err) {
  console.error('[ERRO] Falha ao inicializar Appwrite:', err);
}

// ================= Rotas =================
app.get('/', (_req, res) => {
  res.send('Auth 6 dígitos ✅');
});

// Health check (Render usa para monitorar)
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'auth-6digitos',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Debug de ambiente (somente em DEV_MODE=true)
app.get('/debug/env', (_req, res) => {
  if (String(DEV_MODE).toLowerCase() !== 'true') {
    return res.status(403).json({ ok: false, error: 'DEV_MODE must be true' });
  }
  res.json({
    ok: true,
    node: process.version,
    env: {
      PORT,
      DEV_MODE,
      APPWRITE_ENDPOINT,
      APPWRITE_PROJECT_ID,
      APPWRITE_DB_ID,
      APPWRITE_2FA_COLLECTION_ID,
      APPWRITE_API_KEY: '***hidden***',
    },
  });
});

// Página simples para testes rápidos
app.get('/debug/form', (_req, res) => {
  res.type('html').send(`
    <h1>Debug — Auth 6 dígitos</h1>
    <p>
      <a href="/health" target="_blank">/health</a> |
      <a href="/debug/env" target="_blank">/debug/env</a>
    </p>

    <h2>Testes (mock)</h2>
    <form action="/admin/login" method="post">
      <h3>/admin/login</h3>
      <input name="email" placeholder="email" required />
      <input name="password" placeholder="senha" required />
      <button>Login</button>
    </form>

    <form action="/admin/verify-2fa" method="post" style="margin-top:16px">
      <h3>/admin/verify-2fa</h3>
      <input name="email" placeholder="email" required />
      <input name="code" placeholder="código 6 dígitos" required />
      <button>Verificar</button>
    </form>

    <script>
      for (const f of document.querySelectorAll('form')) {
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const body = Object.fromEntries(new FormData(f).entries());
          const r = await fetch(f.action, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(body)
          });
          const text = await r.text();
          let j;
          try { j = JSON.parse(text); } catch { j = { status: r.status, raw: text }; }
          alert(JSON.stringify(j, null, 2));
        });
      }
    </script>
  `);
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// 500
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: 'internal',
    message: String(DEV_MODE).toLowerCase() === 'true' ? String(err) : undefined,
  });
});

// ================= Start =================
app.listen(PORT, () => {
  console.log('Auth 6 dígitos ON : http://localhost:' + PORT);
});
