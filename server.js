const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

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

app.post('/api/login', (req, res) => {
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
    const ext = path.extname(file.originalname);
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
    title: req.body.title || '',
    category: req.body.category || '',
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
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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
  writeJSON('services.json', services);
  res.json(services);
});

// --- Reviews ---

app.get('/api/reviews', (req, res) => {
  res.json(readJSON('reviews.json'));
});

app.post('/api/reviews', requireAuth, (req, res) => {
  const reviews = readJSON('reviews.json');
  const review = {
    id: genId(),
    text: req.body.text || '',
    author: req.body.author || '',
    detail: req.body.detail || '',
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
  const settings = req.body;
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

app.post('/api/contact', async (req, res) => {
  const { name, email, service, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Vyplňte jméno, e-mail a zprávu' });
  }

  const msg = {
    id: genId(),
    name,
    email,
    service: service || '',
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
        replyTo: email,
        to: settings.contactEmail,
        subject: `Krasopis — poptávka od ${name}`,
        text: [
          `Jméno: ${name}`,
          `E-mail: ${email}`,
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

app.listen(PORT, () => {
  console.log(`Krasopis server běží na http://localhost:${PORT}`);
});
