require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Client, Databases, ID, Query } = require('node-appwrite');

const app = express();
app.use(cors());
app.use(express.json());

const {
  PORT = 3000,
  DEV_MODE = 'true',
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  APPWRITE_API_KEY,
  APPWRITE_DB_ID,
  APPWRITE_LOGIN_CODES_COLLECTION_ID, // ID da collection login_codes
  JWT_SECRET = 'dev-secret',
  CODE_TTL_MINUTES = '10'
} = process.env;

// ------------ Appwrite ------------
let db = null;
try {
  const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);
  db = new Databases(client);
  console.log('[init] Appwrite inicializado.');
} catch (e) {
  console.warn('[init] Falha ao inicializar Appwrite:', e.message);
}

// ------------ Helpers ------------
function random6() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
function jwtFor(email, role) {
  return jwt.sign({ sub: email, role }, JWT_SECRET, { expiresIn: '2h' });
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'auth-6digitos', time: new Date().toISOString() });
});

// ------------ Página de teste ------------
app.get('/debug/form', (_req, res) => {
  res.type('html').send(`
  <!doctype html>
  <meta charset="utf-8"/>
  <title>Debug 6 dígitos</title>
  <style>
    body{font-family:system-ui,Arial;padding:24px;max-width:720px;margin:auto}
    form{border:1px solid #ddd;border-radius:12px;padding:16px;margin:16px 0}
    label{display:block;margin:8px 0 4px}
    input,select,button{padding:8px;border:1px solid #ccc;border-radius:8px;width:100%}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .note{font-size:12px;color:#555}
    code{background:#f5f5f5;padding:2px 4px;border-radius:4px}
  </style>
  <h1>Teste: /auth/send-code → /auth/verify-code</h1>
  <p class="note">Com <code>DEV_MODE=true</code> a API retorna <code>code_dev</code> no envio.</p>

  <form id="send" action="/auth/send-code" method="post">
    <h2>1) Enviar código</h2>
    <label>Email</label>
    <input name="email" type="email" placeholder="seu-email@exemplo.com" required />
    <div class="row">
      <div>
        <label>Perfil</label>
        <select name="role">
          <option value="cliente">cliente</option>
          <option value="transportador">transportador</option>
          <option value="afiliado">afiliado</option>
          <option value="admin">admin</option>
        </select>
      </div>
      <div>
        <label>TTL (min)</label>
        <input name="ttl" type="number" min="1" placeholder="${CODE_TTL_MINUTES}" />
      </div>
    </div>
    <button>Enviar código</button>
  </form>

  <form id="verify" action="/auth/verify-code" method="post">
    <h2>2) Verificar código</h2>
    <label>Email</label>
    <input name="email" type="email" required />
    <label>Código (6 dígitos)</label>
    <input name="code" type="text" pattern="\\d{6}" placeholder="123456" required />
    <button>Verificar</button>
  </form>

  <script>
    async function sendJSON(form) {
      const url = form.action;
      const body = Object.fromEntries(new FormData(form).entries());
      if (body.ttl === '') delete body.ttl;
      const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const j = await r.json();
      alert(JSON.stringify(j, null, 2));
    }
    document.querySelectorAll('form').forEach(f => f.addEventListener('submit', e => { e.preventDefault(); sendJSON(f); }));
  </script>
  `);
});

// ------------ Rotas Auth ------------

/**
 * POST /auth/send-code
 * body: { email, role, ttl? }
 * Salva: email, role, code (DEV), code_hash, used=false, expires_at (Integer/segundos)
 */
app.post('/auth/send-code', async (req, res) => {
  const started = Date.now();
  try {
    const { email, role = 'cliente', ttl } = req.body || {};
    if (!email) return res.status(400).json({ ok:false, error:'email obrigatório' });
    if (!db) throw new Error('Appwrite não inicializado');

    const code = random6();
    const code_hash = await bcrypt.hash(code, 12);

    const minutes = Number.isFinite(Number(ttl)) && Number(ttl) > 0 ? Number(ttl) : Number(CODE_TTL_MINUTES);
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
    const expires_at = Math.floor(expiresAt.getTime() / 1000); // Integer (segundos)

    const doc = {
      email: String(email).toLowerCase().trim(),
      role,
      code,        // mantemos para DEV/diagnóstico (em PROD você pode remover este campo)
      code_hash,
      used: false,
      expires_at
    };

    await db.createDocument(
      APPWRITE_DB_ID,
      APPWRITE_LOGIN_CODES_COLLECTION_ID,
      ID.unique(),
      doc
    );

    const payload = { ok: true, message: 'Código gerado' };
    if (String(DEV_MODE).toLowerCase() === 'true') {
      payload.code_dev = code;
      payload.observacao = 'DEV_MODE=true → o código é retornado para testes';
    }
    payload.latency_ms = Date.now() - started;
    return res.json(payload);

  } catch (err) {
    console.error('[send-code] erro:', err);
    return res.status(500).json({ ok:false, error: err.message, where:'send-code' });
  }
});

/**
 * POST /auth/verify-code
 * body: { email, code }
 * Busca último código não usado do email; confere expiração e hash; marca usado; retorna JWT.
 */
app.post('/auth/verify-code', async (req, res) => {
  const started = Date.now();
  try {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ ok:false, error:'email e code são obrigatórios' });
    if (!db) throw new Error('Appwrite não inicializado');

    const q = await db.listDocuments(
      APPWRITE_DB_ID,
      APPWRITE_LOGIN_CODES_COLLECTION_ID,
      [
        Query.equal('email', String(email).toLowerCase().trim()),
        Query.equal('used', false),
        Query.orderDesc('$createdAt'),
        Query.limit(1)
      ]
    );

    const doc = q.documents?.[0];
    if (!doc) return res.status(400).json({ ok:false, error:'Código não encontrado ou já utilizado' });

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof doc.expires_at === 'number' && doc.expires_at < nowSec) {
      return res.status(400).json({ ok:false, error:'Código expirado' });
    }

    const ok = await bcrypt.compare(String(code), doc.code_hash);
    if (!ok) return res.status(400).json({ ok:false, error:'Código inválido' });

    await db.updateDocument(
      APPWRITE_DB_ID,
      APPWRITE_LOGIN_CODES_COLLECTION_ID,
      doc.$id,
      { used: true }
    );

    const token = jwtFor(doc.email, doc.role || 'cliente');
    const payload = { ok:true, email: doc.email, role: doc.role || 'cliente', token, latency_ms: Date.now() - started };
    if (String(DEV_MODE).toLowerCase() === 'true') payload.note = 'JWT gerado em DEV.';
    return res.json(payload);

  } catch (err) {
    console.error('[verify-code] erro:', err);
    return res.status(500).json({ ok:false, error: err.message, where:'verify-code' });
  }
});

const listenPort = Number(PORT) || 3000;
app.listen(listenPort, () => {
  console.log(`[init] auth-6digitos rodando em :${listenPort}`);
});
