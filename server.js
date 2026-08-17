const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security headers ---

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.googletagmanager.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://www.google-analytics.com"],
      connectSrc: ["'self'", "https://www.google-analytics.com", "https://www.googletagmanager.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// --- Compression ---

app.use(compression());

// --- Body parsing ---

app.use(express.json({ limit: '1mb' }));

// --- CSRF protection for API mutations ---

function csrfCheck(req, res, next) {
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.path.startsWith('/api/')) {
    const origin = req.get('Origin') || req.get('Referer') || '';
    const host = req.get('Host') || '';
    if (origin && !origin.includes(host)) {
      return res.status(403).json({ error: 'Neplatný požadavek' });
    }
    const ct = req.get('Content-Type') || '';
    if (req.body && !ct.includes('application/json') && !ct.includes('multipart/form-data')) {
      return res.status(403).json({ error: 'Neplatný typ požadavku' });
    }
  }
  next();
}

app.use(csrfCheck);

// --- XSS sanitization ---

function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;');
}

function sanitizeObj(obj) {
  if (typeof obj === 'string') return sanitize(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObj);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = sanitizeObj(obj[k]);
    return out;
  }
  return obj;
}

// --- Clean URLs ---

app.use((req, res, next) => {
  if (req.method === 'GET' && req.path.endsWith('.html') && !req.path.startsWith('/admin')) {
    const clean = req.path === '/index.html' ? '/' : req.path.slice(0, -5);
    return res.redirect(301, clean);
  }
  next();
});

// --- Static files with cache headers ---

app.use(express.static(path.join(__dirname), {
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.includes('.') && req.path !== '/') {
    const filePath = path.join(__dirname, req.path + '.html');
    if (!filePath.startsWith(__dirname)) return next();
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
  }
  next();
});

// --- Data helpers ---

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'images', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function readJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
}

function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), 'utf8');
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// --- Admin auth ---

const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
if (!fs.existsSync(ADMIN_FILE)) {
  writeJSON('admin.json', { passwordHash: bcrypt.hashSync('admin123', 10) });
}

let sessionToken = null;

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== sessionToken) {
    return res.status(401).json({ error: 'Neautorizovaný přístup' });
  }
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Příliš mnoho pokusů, zkuste to za 15 minut' },
  standardHeaders: true,
  legacyHeaders: false
});

app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  const admin = readJSON('admin.json');
  if (!bcrypt.compareSync(password || '', admin.passwordHash)) {
    return res.status(401).json({ error: 'Nesprávné heslo' });
  }
  sessionToken = crypto.randomBytes(32).toString('hex');
  res.json({ token: sessionToken });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const admin = readJSON('admin.json');
  if (!bcrypt.compareSync(currentPassword || '', admin.passwordHash)) {
    return res.status(400).json({ error: 'Aktuální heslo je nesprávné' });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Nové heslo musí mít alespoň 4 znaky' });
  }
  admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  writeJSON('admin.json', admin);
  res.json({ message: 'Heslo změněno' });
});

// --- Gallery ---

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, genId() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|webp|gif)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  }
});

app.get('/api/gallery', (req, res) => {
  res.json(readJSON('gallery.json'));
});

app.post('/api/gallery', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nebyl nahrán žádný soubor' });
  const gallery = readJSON('gallery.json');
  const item = {
    id: genId(),
    title: sanitize(req.body.title || ''),
    category: sanitize(req.body.category || ''),
    image: '/images/uploads/' + req.file.filename,
    createdAt: new Date().toISOString()
  };
  gallery.push(item);
  writeJSON('gallery.json', gallery);
  res.json(item);
});

app.delete('/api/gallery/:id', requireAuth, (req, res) => {
  let gallery = readJSON('gallery.json');
  const item = gallery.find(g => g.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Nenalezeno' });
  const filePath = path.join(__dirname, item.image);
  if (filePath.startsWith(UPLOAD_DIR) && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  gallery = gallery.filter(g => g.id !== req.params.id);
  writeJSON('gallery.json', gallery);
  res.json({ message: 'Smazáno' });
});

// --- Services ---

app.get('/api/services', (req, res) => {
  res.json(readJSON('services.json'));
});

app.put('/api/services', requireAuth, (req, res) => {
  const services = req.body;
  if (!Array.isArray(services)) return res.status(400).json({ error: 'Neplatná data' });
  const sanitized = services.map(s => ({
    id: s.id || genId(),
    title: sanitize(s.title || ''),
    description: sanitize(s.description || ''),
    price: sanitize(s.price || ''),
    icon: sanitize(s.icon || '')
  }));
  writeJSON('services.json', sanitized);
  res.json(sanitized);
});

// --- Reviews ---

app.get('/api/reviews', (req, res) => {
  res.json(readJSON('reviews.json'));
});

app.post('/api/reviews', requireAuth, (req, res) => {
  const reviews = readJSON('reviews.json');
  const review = {
    id: genId(),
    text: sanitize(req.body.text || ''),
    author: sanitize(req.body.author || ''),
    detail: sanitize(req.body.detail || ''),
    stars: Math.min(5, Math.max(1, parseInt(req.body.stars) || 5))
  };
  reviews.push(review);
  writeJSON('reviews.json', reviews);
  res.json(review);
});

app.delete('/api/reviews/:id', requireAuth, (req, res) => {
  let reviews = readJSON('reviews.json');
  reviews = reviews.filter(r => r.id !== req.params.id);
  writeJSON('reviews.json', reviews);
  res.json({ message: 'Smazáno' });
});

// --- Settings ---

app.get('/api/settings', (req, res) => {
  res.json(readJSON('settings.json'));
});

app.put('/api/settings', requireAuth, (req, res) => {
  const settings = sanitizeObj(req.body);
  writeJSON('settings.json', settings);
  res.json(settings);
});

// --- Contact form ---

const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
if (!fs.existsSync(MESSAGES_FILE)) writeJSON('messages.json', []);

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: (process.env.SMTP_PORT || '587') === '465',
    auth: { user, pass }
  });
}

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Příliš mnoho zpráv, zkuste to za hodinu' },
  standardHeaders: true,
  legacyHeaders: false
});

app.post('/api/contact', contactLimiter, async (req, res) => {
  const name = sanitize(req.body.name || '');
  const email = sanitize(req.body.email || '');
  const service = sanitize(req.body.service || '');
  const message = sanitize(req.body.message || '');

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Vyplňte jméno, e-mail a zprávu' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(req.body.email)) {
    return res.status(400).json({ error: 'Neplatný e-mail' });
  }

  const msg = {
    id: genId(),
    name,
    email,
    service,
    message,
    createdAt: new Date().toISOString(),
    emailSent: false
  };

  const messages = readJSON('messages.json');
  messages.unshift(msg);
  writeJSON('messages.json', messages);

  const settings = readJSON('settings.json');
  const transporter = getTransporter();

  if (transporter && settings.contactEmail) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        replyTo: req.body.email,
        to: settings.contactEmail,
        subject: `Krasopis — poptávka od ${name}`,
        text: [
          `Jméno: ${name}`,
          `E-mail: ${req.body.email}`,
          service ? `Služba: ${service}` : '',
          '',
          message
        ].filter(Boolean).join('\n'),
        html: `
          <h3>Nová poptávka z webu Krasopis</h3>
          <p><strong>Jméno:</strong> ${name}</p>
          <p><strong>E-mail:</strong> <a href="mailto:${email}">${email}</a></p>
          ${service ? `<p><strong>Služba:</strong> ${service}</p>` : ''}
          <hr>
          <p>${message.replace(/\n/g, '<br>')}</p>
        `
      });
      msg.emailSent = true;
      messages[0].emailSent = true;
      writeJSON('messages.json', messages);
    } catch (e) {
      console.error('Chyba při odesílání e-mailu:', e.message);
    }
  }

  res.json({ message: 'Zpráva odeslána', emailSent: msg.emailSent });
});

app.get('/api/messages', requireAuth, (req, res) => {
  res.json(readJSON('messages.json'));
});

app.delete('/api/messages/:id', requireAuth, (req, res) => {
  let messages = readJSON('messages.json');
  messages = messages.filter(m => m.id !== req.params.id);
  writeJSON('messages.json', messages);
  res.json({ message: 'Smazáno' });
});

// --- Admin SPA ---

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// --- 404 ---

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '404.html'));
});

// --- Error handler ---

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Interní chyba serveru' });
});

app.listen(PORT, () => {
  console.log(`Krasopis server běží na http://localhost:${PORT}`);
});
