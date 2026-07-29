# NeuraPath Skill Gap Analyser

A Node/Express app that analyses a candidate's resume against role-specific skills, lets the candidate manually confirm parser-missed skills, runs a technical test, and recommends either a targeted improvement path, GenAI + Agentic AI, or a broader FDE path.

## Run locally

```bash
npm install
cp .env.example .env
npm start
```
Open `http://localhost:3000`.

## Free deployment (no Replit dependency)

### Render
1. Push this folder to a GitHub repository.
2. In Render, create a new **Web Service** from that repository (or use the included `render.yaml`).
3. Build command: `npm install`
4. Start command: `npm start`
5. Set `WHATSAPP_NUMBER=9818108500` and a strong `ADMIN_KEY`.
6. Deploy.

The app uses the host-provided `PORT`, so no Replit-specific configuration is required.

### Important about lead storage
`data/leads.json` is intentionally kept as a zero-setup fallback. Many free/serverless hosts have ephemeral filesystems, so lead records may disappear after a restart/redeploy. For production lead capture, replace this JSON storage with Supabase/Postgres or another persistent database.

## Resume parsing
- PDF: `pdfjs-dist` extracts text page-by-page.
- DOCX: `mammoth` extracts raw text.
- Scanned/image-only PDFs cannot reliably expose text without OCR, so the UI automatically offers a paste-text fallback.

## Admin
- `/admin?key=YOUR_ADMIN_KEY`
- `/api/admin/leads.csv?key=YOUR_ADMIN_KEY`

## Recommendation logic
The recommendation uses both resume skill coverage and technical-test performance. It deliberately does **not** claim that an ATS will always reject a candidate or that adding skills guarantees interview calls.
