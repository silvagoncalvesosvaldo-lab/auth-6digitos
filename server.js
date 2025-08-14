
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { Client, Databases, ID, Query } = require('node-appwrite');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const {
  PORT = 3000,
  DEV_MODE = 'true',
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  APPWRITE_API_KEY,
  APPWRITE_DB_ID,
  APPWRITE_LOGIN_CODES_COLLECTION_ID,
  JWT_SECRET = 'dev_only_change_me',
  JWT_EXPIRES_DAYS = '30',
  COOKIE_DOMAIN,
  COOKIE_SECURE = 'true',
  ADMIN_ALLOWED_EMAILS = '',
  SMTP_HOST,
  SMTP_PORT = '587',
  SMTP_SECURE = 'false',
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM = 'No Reply <no-reply@localhost>'
} = process.env;

const isDev = () => String(DEV_MODE).toLowerCase() === 'true';

// Appwrite
let db = null;
try {
  const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);
  db = new Databases(client);
  console.log('[OK] Appwrite conectado');
} catch (e) { console.error('[ERRO] Appwrite init', e?.message || e); }

// SMTP
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: String(SMTP_SECURE).toLowerCase() === 'true',
  auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
});

// Helpers
const ADMIN_ALLOW = ADMIN_ALLOWED_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const now = () => new Date();
const addMinutes = (d,m) => new Date(d.getTime()+m*60000);
const toISO = d => d.toISOString();
const normalizeEmail = e => String(e||'').trim().toLowerCase();
const make6 = () => String(Math.floor(100000 + Math.random()*900000));
const validateRole = r => {
  const v = String(r||'').toLowerCase();
  if (!['admin','cliente','transportador','afiliado'].includes(v)) throw new Error('role inválida');
  return v;
};
const ensureAdminAllowed = (email, role) => {
  if (role !== 'admin') return;
  if (ADMIN_ALLOW.length && !ADMIN_ALLOW.includes(email)) {
    const err = new Error('E-mail de admin não autorizado'); err.status = 403; throw err;
  }
};
const setSessionCookie = (res, payload) => {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: `${JWT_EXPIRES_DAYS}d` });
  // Em ambientes sem suporte a cookies, apenas retorna o token no JSON
  if (res.cookie) {
    res.cookie('session', token, {
      httpOnly: true, sameSite: 'lax',
      secure: String(COOKIE_SECURE).toLowerCase() === 'true',
      domain: COOKIE_DOMAIN || undefined,
      maxAge: Number(JWT_EXPIRES_DAYS)*24*60*60*1000
    });
  }
  return token;
};

// Debug
app.get('/debug/env', (_req,res)=>res.json({
  ok:true, DEV_MODE:isDev(), HAVE_DB:!!db,
  SMTP_READY: !!SMTP_HOST && !!SMTP_USER,
  APPWRITE_ENDPOINT: !!APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID: !!APPWRITE_PROJECT_ID,
  APPWRITE_DB_ID: !!APPWRITE_DB_ID,
  APPWRITE_LOGIN_CODES_COLLECTION_ID: !!APPWRITE_LOGIN_CODES_COLLECTION_ID,
  ADMIN_ALLOWED_COUNT: ADMIN_ALLOW.length
}));

// HTML teste rápido
app.get('/debug/form', (_req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Auth 6 dígitos</title>
<style>body{font-family:system-ui,Arial;margin:20px;max-width:560px}
form{display:grid;gap:8px;margin:16px 0}input,button,select{font-size:18px;padding:10px}
.box{border:1px solid #ddd;border-radius:10px;padding:12px;margin:12px 0}</style>
<h1>Login por e-mail (6 dígitos)</h1>
<div class="box"><h3>1) Enviar código</h3>
<form id="f1" action="/auth/send-code" method="POST">
<input name="email" placeholder="email" required>
<select name="role"><option>cliente</option><option>transportador</option><option>afiliado</option><option>admin</option></select>
<select name="purpose"><option>signin</option><option>signup</option></select>
<button>Enviar código</button></form></div>
<div class="box"><h3>2) Verificar código</h3>
<form id="f2" action="/auth/verify-code" method="POST">
<input name="email" placeholder="email" required>
<input name="code" placeholder="código 6 dígitos" required>
<select name="role"><option>cliente</option><option>transportador</option><option>afiliado</option><option>admin</option></select>
<button>Verificar</button></form></div>
<script>
async function postJSON(u,b){const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b),credentials:'include'});const j=await r.json();alert(JSON.stringify(j,null,2));return j;}
for(const f of [document.getElementById('f1'),document.getElementById('f2')]){f.addEventListener('submit',async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(f).entries());await postJSON(f.action,b);});}
</script>`);
});

// E-mail
async function sendEmailCode({ to, code, role }){
  const subject = `Seu código para entrar (${code}) - válido por 10 min`;
  const html = `
  <div style="font-family:Arial,sans-serif;font-size:16px;color:#111">
    <h2 style="margin:0 0 12px 0">Seu código de acesso</h2>
    <p style="font-size:32px;letter-spacing:4px;margin:8px 0"><strong>${code}</strong></p>
    <p>Use este código para ${role==='admin'?'acessar o painel do administrador':'entrar no seu painel'}.</p>
    <p>Válido por <strong>10 minutos</strong>. Não compartilhe.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
    <p style="color:#555">Se não foi você, ignore este e-mail.</p>
  </div>`;
  await transporter.sendMail({ from: SMTP_FROM, to, subject, html, text: html.replace(/<[^>]+>/g,'') });
}

// Rotas
app.post('/auth/send-code', async (req,res)=>{
  try{
    const email = normalizeEmail(req.body?.email);
    const role = validateRole(req.body?.role);
    const purpose = String(req.body?.purpose || 'signin');
    if(!email) return res.status(400).json({ok:false,message:'Informe o e-mail.'});
    if(!['signin','signup'].includes(purpose)) return res.status(400).json({ok:false,message:'purpose inválido.'});
    ensureAdminAllowed(email, role);

    // invalida códigos anteriores ativos deste email/purpose/role
    try {
      const list = await db.listDocuments(APPWRITE_DB_ID, APPWRITE_LOGIN_CODES_COLLECTION_ID, [
        Query.equal('email', email), Query.equal('used', false),
        Query.equal('purpose', purpose), Query.equal('role', role)
      ]);
      for(const d of list.documents){
        await db.updateDocument(APPWRITE_DB_ID, APPWRITE_LOGIN_CODES_COLLECTION_ID, d.$id, { used: true });
      }
    } catch(e){ if(isDev()) console.warn('cleanup anterior', e.message); }

    const code = make6();
    const code_hash = await bcrypt.hash(code, 10);
    const exp = addMinutes(now(), 10);

    await db.createDocument(APPWRITE_DB_ID, APPWRITE_LOGIN_CODES_COLLECTION_ID, ID.unique(), {
      email, code_hash, purpose, role,
      expires_at: toISO(exp), attempts: 0, used: false,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
      user_agent: req.headers['user-agent'] || ''
    });

    await sendEmailCode({ to: email, code, role });
    res.json({ ok:true, message:'Código enviado. Verifique seu e-mail.' });
  }catch(err){
    const status = err.status || 500;
    if(isDev()) console.error('[send-code]', err);
    res.status(status).json({ ok:false, message: isDev()? err.message : 'Não foi possível enviar o código agora.' });
  }
});

app.post('/auth/verify-code', async (req,res)=>{
  try{
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '');
    const role = validateRole(req.body?.role);
    if(!email || !code) return res.status(400).json({ok:false,message:'Informe e-mail e código.'});
    ensureAdminAllowed(email, role);

    const list = await db.listDocuments(APPWRITE_DB_ID, APPWRITE_LOGIN_CODES_COLLECTION_ID, [
      Query.equal('email', email), Query.equal('role', role),
      Query.equal('used', false), Query.orderDesc('$createdAt'), Query.limit(5)
    ]);
    const doc = list.documents.find(d=>d.purpose==='signin' || d.purpose==='signup');
    if(!doc) return res.status(400).json({ok:false,message:'Solicite um novo código.'});

    if(new Date(doc.expires_at) < new Date()){
      await db.updateDocument(APPWRITE_DB_ID, APPWRITE_LOGIN_CODES_COLLECTION_ID, doc.$id, { used: true });
      return res.status(400).json({ ok:false, message:'Código expirado. Peça outro.' });
    }
    if(Number(doc.attempts) >= 5){
      await db.updateDocument(APPWRITE_DB_ID, APPWRITE_LOGIN_CODES_COLLECTION_ID, doc.$id, { used: true });
      return res.status(429).json({ ok:false, message:'Muitas tentativas. Peça outro código.' });
    }

    const ok = await bcrypt.compare(code, doc.code_hash);
    if(!ok){
      await db.updateDocument(APPWRITE_DB_ID, APPWRITE_LOGIN_CODES_COLLECTION_ID, doc.$id, { attempts: Number(doc.attempts)+1 });
      return res.status(401).json({ ok:false, message:'Código incorreto.' });
    }

    await db.updateDocument(APPWRITE_DB_ID, APPWRITE_LOGIN_CODES_COLLECTION_ID, doc.$id, { used: true });
    const payload = { sub: email, role, iat: Math.floor(Date.now()/1000) };
    const token = setSessionCookie(res, payload);
    res.json({ ok:true, authenticated:true, token, role, email });
  }catch(err){
    const status = err.status || 500;
    if(isDev()) console.error('[verify-code]', err);
    res.status(status).json({ ok:false, message: isDev()? err.message : 'Falha ao verificar código.' });
  }
});

app.listen(Number(PORT), ()=>console.log(`Auth 6 dígitos ON : http://localhost:${PORT}`));
