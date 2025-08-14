// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Client, Databases } = require('node-appwrite');

const app = express();
app.use(cors());
app.use(express.json());

// Variáveis
const {
  PORT = 10000,
  DEV_MODE = 'false',
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  APPWRITE_API_KEY,
  APPWRITE_DB_ID,
  APPWRITE_2FA_COLLECTION_ID,
} = process.env;

// Appwrite (opcional: só conecta se tiver env)
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

// Raiz
app.get('/', (_req, res) => {
  res.send('Auth 6 dígitos ✅');
});

// Health check (usado pelo Render)
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'auth-6digitos',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Debug de ambiente (só com DEV_MODE=true)
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

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// 500
app.use((err, _req, res, _next) => {
  console.error(err);
  res
    .status(500)
    .json({ error: 'internal', message: String(DEV_MODE).toLowerCase() === 'true' ? String(err) : undefined });
});

// Start
app.listen(PORT, () => {
  console.log(`Auth 6 dígitos ON : http://localhost:${PORT}`);
