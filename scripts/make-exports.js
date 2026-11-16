const fs = require('fs');
const path = require('path');
const base = path.resolve(__dirname, '../../samples');
const API = 'http://127.0.0.1:8123';

async function format(files, fields = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(files)) form.append(k, new Blob([fs.readFileSync(path.join(base, v))]), v);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(API + '/api/format', { method: 'POST', body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}
async function feedback(jobId, text) {
  const res = await fetch(API + '/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId, text }) });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}
async function save(jobId, name) {
  const res = await fetch(API + '/api/export/' + jobId);
  if (!res.ok) throw new Error('export failed ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(base, name), buf);
  console.log('saved', name, buf.length);
}

(async () => {
  let d = await format({ paper: 'workshop9.pdf', template: 'template.doc', questions: 'workshop9.pdf' }, { className: '物联网NZ252', studentName: '王焕鑫', studentId: '257037', workshop: '9', caption: '计算思维与算法实验报告' });
  await save(d.jobId, 'export-fresh-base.docx');
  d = await feedback(d.jobId, '而且你识别的英文的格式根本不准确，文件里要正文仿宋，你做完之后却不是');
  await save(d.jobId, 'export-fresh-fangsong.docx');
  d = await feedback(d.jobId, '全文翻译成英文版，字体不要变');
  await save(d.jobId, 'export-fresh-en.docx');
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
