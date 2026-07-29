require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme';
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '9818108500';
const WHATSAPP_MESSAGE = process.env.WHATSAPP_MESSAGE || "Hi, I just checked my resume and skill score on the NeuraPath tool and I'd like to talk about a course.";
const CALENDLY_URL = process.env.CALENDLY_URL || '';

const ROLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'roles.json'), 'utf-8'));
const LEADS_FILE = path.join(__dirname, 'data', 'leads.json');
if (!fs.existsSync(LEADS_FILE)) fs.writeFileSync(LEADS_FILE, '[]');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
      .includes(file.mimetype);
    cb(null, ok);
  }
});

// ---------- lead storage helpers ----------
function readLeads() {
  try { return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf-8')); }
  catch (e) { return []; }
}
function writeLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}
function upsertLead(leadId, patch) {
  const leads = readLeads();
  const idx = leads.findIndex(l => l.id === leadId);
  if (idx === -1) return null;
  leads[idx] = { ...leads[idx], ...patch, updatedAt: new Date().toISOString() };
  writeLeads(leads);
  return leads[idx];
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------- config for frontend (CTA link, role list) ----------
app.get('/api/config', (req, res) => {
  const roles = Object.entries(ROLES).map(([id, r]) => ({ id, label: r.label, course: r.course }));
  let cta = null;
  if (WHATSAPP_NUMBER) {
    cta = { type: 'whatsapp', url: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}` };
  } else if (CALENDLY_URL) {
    cta = { type: 'calendly', url: CALENDLY_URL };
  }
  res.json({ roles, cta });
});

// ---------- lead capture ----------
app.post('/api/lead', (req, res) => {
  const { name, email, phone, roleId } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!phone || phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Enter a valid phone number.' });
  if (!roleId || !ROLES[roleId]) return res.status(400).json({ error: 'Select a valid target role.' });

  const leads = readLeads();
  const lead = {
    id: uuidv4(),
    name: name.trim(),
    email: email.trim(),
    phone: phone.trim(),
    roleId,
    roleLabel: ROLES[roleId].label,
    atsScore: null,
    matchedKeywords: [],
    missingKeywords: [],
    recommendedPath: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  leads.push(lead);
  writeLeads(leads);
  res.json({ leadId: lead.id });
});

// ---------- resume scoring ----------
async function extractText(file) {
  if (!file) return '';
  if (file.mimetype === 'application/pdf') {
    const data = await pdfParse(file.buffer);
    return data.text || '';
  }
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value || '';
  }
  return '';
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scoreResume(text, roleId) {
  const role = ROLES[roleId];
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  const matched = [];
  const missing = [];
  role.keywords.forEach(kw => {
    const pattern = new RegExp('\\b' + escapeRegex(kw.toLowerCase()) + '\\b');
    if (pattern.test(normalized)) matched.push(kw);
    else missing.push(kw);
  });
  const score = Math.round((matched.length / role.keywords.length) * 100);
  return { score, matched, missing };
}

app.post('/api/resume', upload.single('resume'), async (req, res) => {
  try {
    const { leadId, roleId, pastedText } = req.body;
    if (!leadId || !roleId || !ROLES[roleId]) return res.status(400).json({ error: 'Missing lead or role.' });

    let text = '';
    if (req.file) {
      text = await extractText(req.file);
    }
    if ((!text || text.trim().split(/\s+/).length < 50) && pastedText) {
      text = pastedText;
    }
    if (!text || text.trim().split(/\s+/).length < 30) {
      return res.status(422).json({
        error: 'We could not read enough text from that file. Please paste your resume text instead.',
        needsPasteFallback: true
      });
    }

    const { score, matched, missing } = scoreResume(text, roleId);
    upsertLead(leadId, { atsScore: score, matchedKeywords: matched, missingKeywords: missing });
    res.json({ score, matched, missing });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong reading that file. Please paste your resume text instead.', needsPasteFallback: true });
  }
});

// ---------- resume-based recommendation ----------
const FDE_SKILLS = [
  'Advanced Python', 'FastAPI', 'REST APIs', 'API Integration', 'Docker', 'AWS',
  'Cloud Deployment', 'OAuth 2.0', 'RBAC', 'Git/GitHub', 'CI/CD', 'LLM APIs',
  'RAG', 'Vector Databases', 'AI Agents', 'Agentic Workflows', 'Tool Calling',
  'MCP Servers', 'Observability', 'System Design'
];

const GENAI_SKILLS = [
  'LLMs', 'Prompt Engineering', 'Embeddings', 'RAG', 'Vector Databases',
  'LLM APIs', 'Function Calling', 'AI Agents', 'Agentic Workflows',
  'LangChain/LangGraph', 'MCP', 'Evaluation', 'Guardrails',
  'Fine-tuning Concepts', 'GenAI Deployment'
];

const OPPORTUNITY_ROLES = [
  'AI Engineer', 'Forward Deployed Engineer (FDE)', 'Python Developer',
  'Data Analyst', 'Data Scientist', 'GenAI Engineer', 'Agentic AI Engineer',
  'AWS / Cloud Engineer', 'DevOps / MLOps Engineer'
];

function choosePath(roleId, score, matched) {
  const normalized = new Set((matched || []).map(x => String(x).toLowerCase()));
  const dataFoundations = ['python','sql','machine learning','deep learning','nlp','pandas','numpy','statistics'];
  const foundationHits = dataFoundations.filter(s => normalized.has(s)).length;

  // GenAI/Agentic AI is an upgrade path for candidates whose resume already
  // demonstrates solid current-role/data foundations. Everyone else receives
  // the broader engineering-oriented FDE path.
  const proficient = score >= 65 || foundationHits >= 5;
  return proficient
    ? {
        id:'genai-agentic',
        name:'GenAI + Agentic AI Upgrade',
        skills:GENAI_SKILLS,
        explanation:'Your resume already shows a reasonably strong base in your current data/technical stack. The more focused next step is to upgrade that foundation with modern GenAI and agentic AI capabilities rather than restart from fundamentals.'
      }
    : {
        id:'fde',
        name:'Forward Deployed Engineer (FDE) Path',
        skills:FDE_SKILLS,
        explanation:'Your resume currently shows broader gaps across the modern engineering stack. A full FDE-oriented path is the stronger recommendation because it combines software, APIs, cloud, deployment and applied AI skills into one broader job-ready stack.'
      };
}

app.post('/api/recommendation/:roleId', (req, res) => {
  const role = ROLES[req.params.roleId];
  if (!role) return res.status(404).json({ error:'Unknown role.' });

  const { leadId, score, matched, missing } = req.body || {};
  const numericScore = Number(score) || 0;
  const path = choosePath(req.params.roleId, numericScore, matched);

  // Final page intentionally shows only NEW skills the recommended path adds.
  // It does not repeat the resume matched-vs-missing comparison.
  const matchedLower = new Set((matched || []).map(x => String(x).toLowerCase()));
  const newSkills = path.skills.filter(s => !matchedLower.has(s.toLowerCase()));

  const missingList = (missing || []).slice(0, 20);
  const message = [
    'Sir, I have taken the NeuraPath resume skill-gap analysis.',
    '',
    `Target role: ${role.label}`,
    `Resume skill match: ${numericScore}%`,
    '',
    'Skills currently not reflected in my resume:',
    ...missingList.map(s => `• ${s}`),
    '',
    `Recommended learning path: ${path.name}`,
    '',
    'I want to understand how I can build these skills and improve my job opportunities.'
  ].join('\n');

  const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  if (leadId) upsertLead(leadId, { recommendedPath:path.name });

  res.json({
    pathId:path.id,
    pathName:path.name,
    explanation:path.explanation,
    newSkills,
    opportunityRoles:OPPORTUNITY_ROLES,
    opportunityNote:'A broader technical stack can make you relevant to more job families and give you more roles to apply for. It can improve your opportunity surface, but hiring still depends on depth, projects, experience, resume quality and interview performance.',
    whatsappUrl
  });
});

// ---------- admin: view & export leads ----------
function checkAdmin(req, res) {
  if ((req.query.key || req.headers['x-admin-key']) !== ADMIN_KEY) {
    res.status(401).send('Unauthorized. Add ?key=YOUR_ADMIN_KEY to the URL.');
    return false;
  }
  return true;
}

app.get('/api/admin/leads.json', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json(readLeads());
});

app.get('/api/admin/leads.csv', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const leads = readLeads();
  const headers = ['createdAt', 'name', 'email', 'phone', 'roleLabel', 'atsScore', 'missingKeywords'];
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = leads.map(l => [
    l.createdAt, l.name, l.email, l.phone, l.roleLabel, l.atsScore,
    (l.missingKeywords || []).join('; ')
  ].map(escape).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send(csv);
});

app.get('/admin', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
