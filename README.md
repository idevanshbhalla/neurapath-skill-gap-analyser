# NeuraPath Resume Scan + Skill Check

A lead-capture tool: visitor enters contact details → uploads/pastes resume →
gets a keyword match score → takes a 10-question skill quiz → sees a verdict
→ clicks through to WhatsApp/Calendly to talk to a counsellor. Every lead is
saved so you can follow up.

---

## 1. Getting this running on Replit (first time)

1. Go to replit.com → **Create App/Repl** → choose **Import from... / Upload
   folder** (or "Node.js" template, then upload these files into it).
2. Upload this entire folder's contents, keeping the folder structure
   (`public/`, `data/`, `server.js`, `package.json`, etc).
3. Replit will detect `package.json` and run `npm install` automatically. If
   it doesn't, open the Shell tab and run: `npm install`
4. **Set your secrets** (Replit sidebar → "Secrets" / padlock icon — do NOT
   put these in a plain `.env` file that you might accidentally share):
   - `ADMIN_KEY` → make up any private password, e.g. `neurapath-leads-2026`
   - `WHATSAPP_NUMBER` → your WhatsApp number with country code, no `+`, no
     spaces, e.g. `919876543210`
   - `WHATSAPP_MESSAGE` → optional, the pre-filled message (a sensible
     default is already built in if you skip this)
   - (Only if you'd rather use Calendly instead of WhatsApp: set
     `CALENDLY_URL` and leave `WHATSAPP_NUMBER` blank)
5. Click **Run**. Replit will give you a live `.replit.app` URL — that's your
   app, share that link.

---

## 2. Viewing and exporting your leads

Every submission is saved automatically. To see them:

- Open `https://your-repl-url.replit.app/admin?key=YOUR_ADMIN_KEY`
  (use the same `ADMIN_KEY` you set in Secrets)
- Click **Download CSV** on that page to export into Excel/Google Sheets

That's it — no database, no separate login system. Keep the admin URL
private; anyone with the key can view lead contact details.

**Why not Google Sheets directly, like the original plan?** Wiring live
writes into Google Sheets needs a Google Cloud service account with its own
credentials — something only you can create (an AI assistant can't generate
Google API keys on your behalf). This local version works immediately with
zero setup. If you later want it, `data/leads.json` already has every field
in the shape you'd need — that's a follow-up task, not a blocker to shipping
today.

---

## 3. Customizing the content (do this before sharing the link widely)

Open `data/roles.json`. It has one entry per target role:

- `label` — shown in the role dropdown
- `course` — which NeuraPath course this role's verdict points toward
- `keywords` — the list the resume is scanned against
- `mcqs` — the 10 skill-check questions (`correct` is the 0-indexed correct
  option)

Currently there are 5 roles, matched to NeuraPath's 5 courses: Data Analyst,
Python Developer, Business Analyst, Data Scientist, Gen AI Engineer. Add,
remove, or edit roles by editing this file directly — no code changes
needed. Keep each keyword list to roughly 20-30 real, specific terms pulled
from actual job postings, not generic guesses.

---

## 4. Known limitations (by design, not oversights)

- **Keyword matching is literal, not smart.** It checks whether each keyword
  appears as a whole word/phrase in the resume text. It will miss plurals
  ("Pivot Tables" won't match a keyword written as "Pivot Table") and won't
  understand synonyms. This mirrors how real simple ATS keyword-matchers
  behave — it is not a flaw unique to this app, but don't oversell the score
  as more rigorous than it is.
- **Not a real ATS simulation.** Real ATS platforms also check formatting,
  section structure, and dates. This tool only checks keyword presence.
  That's the intended, scoped-down MVP — see the PRD for why.
- **MCQs are static**, not adaptive or AI-generated. This is intentional:
  predictable quality, zero per-user API cost, easy for you to edit.
- **File parsing can fail on unusual resume layouts** (multi-column,
  scanned/image-based PDFs). The "paste your resume text instead" fallback
  exists specifically for this — it's not a backup feature, it's load-bearing.

## 5. If something breaks

- **"Cannot find module X"** → run `npm install` in the Shell tab.
- **PDF/DOCX upload always fails** → check the file is a real `.pdf` or
  `.docx` (not `.doc`, not a scanned image with no selectable text) — ask the
  user to use the paste option instead.
- **Admin page says Unauthorized** → the `?key=` in the URL must exactly
  match your `ADMIN_KEY` secret.
