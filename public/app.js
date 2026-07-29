let CONFIG = null;
let state = { leadId:null, roleId:null, file:null, pastedText:'', atsScore:null, matchedKeywords:[], missingKeywords:[] };

const stepperMap = {details:'details', resume:'resume', scanning:'resume', 'ats-result':'analysis', analysis:'analysis'};
const order = ['details','resume','analysis'];

function showStep(name) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-' + name).classList.add('active');
  const activeIdx = order.indexOf(stepperMap[name]);
  document.querySelectorAll('#stepper li').forEach(li => {
    const idx = order.indexOf(li.dataset.step);
    li.classList.toggle('active', idx === activeIdx);
    li.classList.toggle('done', idx < activeIdx);
  });
}

async function init() {
  const res = await fetch('/api/config');
  CONFIG = await res.json();
  const select = document.getElementById('role-select');
  CONFIG.roles.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id; opt.textContent = r.label; select.appendChild(opt);
  });
}
init();

document.getElementById('form-details').addEventListener('submit', async e => {
  e.preventDefault();
  const errorEl = document.getElementById('details-error'); errorEl.textContent = '';
  const f = e.target;
  const payload = {name:f.name.value,email:f.email.value,phone:f.phone.value,roleId:f.roleId.value};
  try {
    const res = await fetch('/api/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data = await res.json();
    if(!res.ok){errorEl.textContent=data.error||'Something went wrong.';return;}
    state.leadId=data.leadId; state.roleId=payload.roleId; showStep('resume');
  } catch { errorEl.textContent='Could not reach the server. Try again.'; }
});

const dropzone=document.getElementById('dropzone'), fileInput=document.getElementById('file-input'), filenameEl=document.getElementById('filename');
dropzone.addEventListener('click',()=>fileInput.click());
dropzone.addEventListener('dragover',e=>{e.preventDefault();dropzone.classList.add('dragover')});
dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop',e=>{e.preventDefault();dropzone.classList.remove('dragover');if(e.dataTransfer.files.length){fileInput.files=e.dataTransfer.files;handleFileChosen();}});
fileInput.addEventListener('change',handleFileChosen);
function handleFileChosen(){if(fileInput.files.length){state.file=fileInput.files[0];filenameEl.textContent=state.file.name;}}
document.getElementById('toggle-paste').addEventListener('click',()=>document.getElementById('paste-area').classList.toggle('hidden'));

document.getElementById('btn-scan').addEventListener('click',async()=>{
  const errorEl=document.getElementById('resume-error'); errorEl.textContent='';
  state.pastedText=document.getElementById('paste-text').value.trim();
  if(!state.file&&!state.pastedText){errorEl.textContent='Upload a file or paste your resume text.';return;}
  showStep('scanning');
  const scanLabel=document.getElementById('scan-label'); scanLabel.textContent='READING DOCUMENT…';
  setTimeout(()=>{if(document.getElementById('step-scanning').classList.contains('active'))scanLabel.textContent='MAPPING SKILLS…';},900);
  const fd=new FormData(); fd.append('leadId',state.leadId);fd.append('roleId',state.roleId);
  if(state.file)fd.append('resume',state.file);if(state.pastedText)fd.append('pastedText',state.pastedText);
  try{
    const res=await fetch('/api/resume',{method:'POST',body:fd});const data=await res.json();
    if(!res.ok){showStep('resume');errorEl.textContent=data.error||'Something went wrong.';if(data.needsPasteFallback)document.getElementById('paste-area').classList.remove('hidden');return;}
    state.atsScore=data.score;state.matchedKeywords=data.matched;state.missingKeywords=data.missing;
    renderAtsResult(data);setTimeout(()=>showStep('ats-result'),400);
  }catch{showStep('resume');errorEl.textContent='Could not reach the server. Try again.';}
});

function renderAtsResult(data){
  document.getElementById('ats-score-inline').textContent=data.score+'%';
  document.getElementById('ats-meter-fill').style.width=data.score+'%';
  const matched=document.getElementById('matched-list'),missing=document.getElementById('missing-list');
  matched.innerHTML='';missing.innerHTML='';
  data.matched.forEach(k=>matched.insertAdjacentHTML('beforeend',`<span class="tag matched">${escapeHtml(k)}</span>`));
  data.missing.forEach(k=>missing.insertAdjacentHTML('beforeend',`<span class="tag missing">${escapeHtml(k)}</span>`));
  if(!data.matched.length)matched.innerHTML='<span class="tag matched">None detected</span>';
  if(!data.missing.length)missing.innerHTML='<span class="tag missing">No major gaps detected</span>';
}

document.getElementById('btn-to-analysis').addEventListener('click', async()=>{
  try{
    const res=await fetch('/api/recommendation/'+state.roleId,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({leadId:state.leadId,score:state.atsScore,matched:state.matchedKeywords,missing:state.missingKeywords})
    });
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||'Could not create recommendation.');
    renderAnalysis(data);showStep('analysis');
  }catch(err){alert(err.message);}
});

function renderAnalysis(data){
  document.getElementById('path-name').textContent=data.pathName;
  document.getElementById('analysis-text').textContent=data.explanation;
  const skills=document.getElementById('new-skills-list');skills.innerHTML='';
  data.newSkills.forEach(k=>skills.insertAdjacentHTML('beforeend',`<span class="tag matched">${escapeHtml(k)}</span>`));
  const roles=document.getElementById('opportunity-list');roles.innerHTML='';
  data.opportunityRoles.forEach(k=>roles.insertAdjacentHTML('beforeend',`<span class="tag matched">${escapeHtml(k)}</span>`));
  document.getElementById('opportunity-note').textContent=data.opportunityNote;
  document.getElementById('btn-cta').href=data.whatsappUrl;
}
function escapeHtml(v){const d=document.createElement('div');d.textContent=v;return d.innerHTML;}
