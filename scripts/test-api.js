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
function show(tag, d) {
  const v = d.validation;
  console.log(`\n[${tag}] pass=${v.passRate}% failed=${v.failedCount} q=${d.questions.map(q => q.number).join(',')}`);
  console.log('  body=' + d.model.roles.body.font + '/' + d.model.roles.body.sizePt + 'pt  heading=' + d.model.roles.heading.font + '/' + d.model.roles.heading.sizePt + 'pt  title=' + d.model.roles.title.font + '/' + d.model.roles.title.sizePt + 'pt');
  const last = d.rounds[d.rounds.length - 1];
  if (last) console.log('  round actions: ' + last.actions.map(a => a.text).join(' | '));
  const bad = v.checks.filter(c => !c.ok);
  if (bad.length) console.log('  FAIL CHECKS:', bad.map(c => c.id + ' => ' + c.actual).join(' ; '));
  return d;
}

(async () => {
  let d = await format({ paper: 'workshop9.pdf', template: 'template.doc', questions: 'workshop9.pdf' }, { className: '物联网NZ252', studentName: '王焕鑫', studentId: '257037', workshop: '9', caption: '计算思维与算法实验报告' });
  show('base', d);
  fs.writeFileSync(path.join(base, 'job-base.json'), JSON.stringify({ jobId: d.jobId }));
  const q = d.questions.map(x => x.stem);
  console.log('  q1=' + q[0].slice(0, 60) + ' | q8=' + q[7].slice(0, 60));

  d = await feedback(d.jobId, '而且你识别的英文的格式根本不准确，文件里要正文仿宋，你做完之后却不是');
  show('font-vs', d);
  console.log('  body font now = ' + d.model.roles.body.font + '  source=' + d.rounds[0].actions[0].source);

  d = await feedback(d.jobId, '第8题没识别上，请重新去读题目文件把第八题弄上');
  show('q8', d);
  fs.writeFileSync(path.join(base, 'job-q8.json'), JSON.stringify({ jobId: d.jobId }));

  d = await feedback(d.jobId, '第5题和第6题被合并成一题了，要小心');
  show('merge56', d);
  fs.writeFileSync(path.join(base, 'job-merge.json'), JSON.stringify({ jobId: d.jobId }));

  d = await feedback(d.jobId, '全文翻译成英文版，字体不要变');
  show('english', d);
  console.log('  translated=' + d.translated + ' lang=' + d.lang + ' first body=' + (d.blocks.find(b => b.role === 'body') || {}).text);
  fs.writeFileSync(path.join(base, 'job-en.json'), JSON.stringify({ jobId: d.jobId }));

  d = await format({ paper: 'workshop8.pdf', template: 'template.doc', questions: 'workshop8.pdf' }, { workshop: '8' });
  show('workshop8', d);

  d = await format({ paper: 'workshop9.pdf', template: 'template.docx', questions: 'workshop9.pdf' }, { workshop: '9' });
  show('template-docx', d);
  fs.writeFileSync(path.join(base, 'job-docx.json'), JSON.stringify({ jobId: d.jobId }));
})().catch(e => { console.error(e); process.exit(1); });
