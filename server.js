require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mammoth = require('mammoth');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme';
const WHATSAPP_NUMBER = (process.env.WHATSAPP_NUMBER || '9818108500').replace(/\D/g, '');
const ROLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'roles.json'), 'utf-8'));
const LEADS_FILE = path.join(__dirname, 'data', 'leads.json');
if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, '[]');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const ok = ext === '.pdf' || ext === '.docx';
    cb(ok ? null : new Error('Only PDF and DOCX files are supported.'), ok);
  }
});

function readLeads() { try { return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8')); } catch { return []; } }
function writeLeads(leads) { try { fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2)); } catch (e) { console.warn('Lead persistence unavailable on this host:', e.message); } }
function upsertLead(id, patch) {
  const leads = readLeads(); const i = leads.findIndex(x => x.id === id); if (i < 0) return null;
  leads[i] = { ...leads[i], ...patch, updatedAt: new Date().toISOString() }; writeLeads(leads); return leads[i];
}
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
const normalize = s => (s || '').toLowerCase().replace(/[–—]/g, '-').replace(/[^a-z0-9+#.\-/ ]/g, ' ').replace(/\s+/g, ' ').trim();

app.get('/api/config', (req, res) => res.json({
  roles: Object.entries(ROLES).map(([id, r]) => ({ id, label: r.label })),
  whatsappNumber: WHATSAPP_NUMBER
}));

app.post('/api/lead', (req, res) => {
  const { name, email, phone, roleId } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if ((phone || '').replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Enter a valid phone number.' });
  if (!ROLES[roleId]) return res.status(400).json({ error: 'Select a valid target role.' });
  const lead = { id: crypto.randomUUID(), name: name.trim(), email: email.trim(), phone: phone.trim(), roleId, roleLabel: ROLES[roleId].label, atsScore: null, matchedKeywords: [], missingKeywords: [], confirmedSkills: [], quizScore: null, quizTier: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const leads = readLeads(); leads.push(lead); writeLeads(leads); res.json({ leadId: lead.id });
});

async function extractPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i); const content = await page.getTextContent();
    pages.push(content.items.map(x => x.str || '').join(' '));
  }
  return pages.join('\n');
}
async function extractText(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ext === '.pdf') return extractPdf(file.buffer);
  if (ext === '.docx') return (await mammoth.extractRawText({ buffer: file.buffer })).value || '';
  return '';
}
function aliases(keyword) {
  const map = {
    'REST API': ['rest api','restful api','restful services'], 'Power BI': ['power bi','powerbi'], 'Scikit-learn': ['scikit-learn','scikit learn','sklearn'],
    'Fine-tuning': ['fine-tuning','fine tuning','finetuning'], 'A/B Testing': ['a/b testing','ab testing'], 'CI/CD': ['ci/cd','cicd'], 'OAuth': ['oauth','oauth2','oauth 2.0'],
    'RBAC': ['rbac','role based access control'], 'MCP': ['mcp','model context protocol'], 'LLM': ['llm','large language model'], 'RAG': ['rag','retrieval augmented generation'],
    'AWS': ['aws','amazon web services'], 'GCP': ['gcp','google cloud platform'], 'OOP': ['oop','object oriented programming'], 'NLP': ['nlp','natural language processing']
  };
  return map[keyword] || [keyword.toLowerCase()];
}
function scoreResume(text, roleId) {
  const role = ROLES[roleId]; const hay = ` ${normalize(text)} `; const matched = [], missing = [];
  role.keywords.forEach(kw => (aliases(kw).some(a => hay.includes(` ${normalize(a)} `)) ? matched : missing).push(kw));
  return { score: Math.round(matched.length / role.keywords.length * 100), matched, missing };
}

app.post('/api/resume', upload.single('resume'), async (req, res) => {
  try {
    const { leadId, roleId, pastedText } = req.body; if (!leadId || !ROLES[roleId]) return res.status(400).json({ error: 'Missing lead or role.' });
    let text = req.file ? await extractText(req.file) : '';
    if (text.trim().split(/\s+/).length < 40 && pastedText) text = pastedText;
    if (text.trim().split(/\s+/).length < 30) return res.status(422).json({ error: 'This file contains too little machine-readable text. It may be a scanned/image PDF. Paste the resume text below and scan again.', needsPasteFallback: true });
    const result = scoreResume(text, roleId); upsertLead(leadId, { atsScore: result.score, matchedKeywords: result.matched, missingKeywords: result.missing }); res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: 'The document could not be parsed. Try DOCX or paste the resume text.', needsPasteFallback: true }); }
});

app.post('/api/skills/confirm', (req, res) => {
  const { leadId, roleId, confirmedSkills } = req.body || {}; if (!ROLES[roleId] || !Array.isArray(confirmedSkills)) return res.status(400).json({ error: 'Invalid skills.' });
  const lead = readLeads().find(x => x.id === leadId); if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  const allowed = new Set(ROLES[roleId].keywords); const confirmed = confirmedSkills.filter(x => allowed.has(x));
  const matched = [...new Set([...(lead.matchedKeywords || []), ...confirmed])]; const missing = ROLES[roleId].keywords.filter(x => !matched.includes(x));
  const score = Math.round(matched.length / ROLES[roleId].keywords.length * 100); upsertLead(leadId, { confirmedSkills: confirmed, matchedKeywords: matched, missingKeywords: missing, atsScore: score });
  res.json({ score, matched, missing });
});

app.get('/api/quiz/:roleId', (req, res) => { const r = ROLES[req.params.roleId]; if (!r) return res.status(404).json({ error: 'Unknown role.' }); res.json({ questions: r.mcqs.map((m, index) => ({ index, q: m.q, options: m.options })) }); });
const tierFor = (score, total) => score / total < .5 ? 'Needs reinforcement' : score / total < .8 ? 'Working knowledge' : 'Strong fundamentals';
app.post('/api/quiz/:roleId/submit', (req, res) => {
  const r = ROLES[req.params.roleId]; if (!r) return res.status(404).json({ error: 'Unknown role.' }); const { leadId, answers } = req.body || {}; if (!Array.isArray(answers)) return res.status(400).json({ error: 'Answers missing.' });
  let score = 0; r.mcqs.forEach((m, i) => { if (answers[i] === m.correct) score++; }); const tier = tierFor(score, r.mcqs.length); if (leadId) upsertLead(leadId, { quizScore: score, quizTier: tier }); res.json({ score, total: r.mcqs.length, tier });
});

function checkAdmin(req, res) { if ((req.query.key || req.headers['x-admin-key']) !== ADMIN_KEY) { res.status(401).send('Unauthorized.'); return false; } return true; }
app.get('/api/admin/leads.json', (req, res) => { if (checkAdmin(req,res)) res.json(readLeads()); });
app.get('/api/admin/leads.csv', (req, res) => { if (!checkAdmin(req,res)) return; const leads=readLeads(); const h=['createdAt','name','email','phone','roleLabel','atsScore','missingKeywords','quizScore','quizTier']; const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`; const rows=leads.map(l=>[l.createdAt,l.name,l.email,l.phone,l.roleLabel,l.atsScore,(l.missingKeywords||[]).join('; '),l.quizScore,l.quizTier].map(esc).join(',')); res.type('text/csv').set('Content-Disposition','attachment; filename="leads.csv"').send([h.join(','),...rows].join('\n')); });
app.get('/admin', (req,res) => { if (checkAdmin(req,res)) res.sendFile(path.join(__dirname,'public','admin.html')); });
app.use((err, req, res, next) => { console.error(err); res.status(400).json({ error: err.message || 'Upload failed.' }); });
app.listen(PORT, '0.0.0.0', () => console.log(`NeuraPath Skill Gap Analyser running on port ${PORT}`));
