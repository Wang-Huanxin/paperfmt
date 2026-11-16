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
function line(tag, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${tag}] ${detail}`);
  if (!ok) process.exitCode = 1;
}

(async () => {
  // 1) 论文缺第8题，题目文件有第8题
  let d = await format({ paper: 'paper-answers-1-7.txt', template: 'template.doc', questions: 'workshop9.txt' }, { workshop: '9' });
  const nums = d.questions.map(q => q.number);
  line('missing-in-paper-numbers', nums.join(',') === '1,2,3,4,5,6,7,8', `numbers=${nums.join(',')}`);
  const q8 = d.questions.find(q => q.number === 8);
  line('missing-in-paper-supplemented', !!q8 && q8.fromSource, `q8.fromSource=${q8 && q8.fromSource} stem=${q8 && q8.stem.slice(0, 60)}`);
  d = await feedback(d.jobId, '第8题没识别上，重新读题目文件把第8题补上');
  const act = d.rounds[d.rounds.length - 1].actions.map(a => a.text).join(' | ');
  line('missing-feedback-truthful', /论文中没有第 8 题/.test(act) && /题目文件/.test(act), act.slice(0, 220));
  line('missing-feedback-both-sections', d.blocks.filter(b => typeof b.text === 'string' && /^8\./.test(b.text)).length >= 1, 'found a block starting with 8.');

  // 2) 论文里两个“5.”，应修正为 5 与 6
  const d2 = await format({ paper: 'paper-dupe-5-6.txt', template: 'template.doc', questions: 'workshop9.txt' }, { workshop: '9' });
  const nums2 = d2.questions.map(q => q.number);
  line('dupe-numbers', nums2.join(',') === '1,2,3,4,5,6,7,8', `numbers=${nums2.join(',')}`);
  const q5 = d2.questions.find(q => q.number === 5);
  const q6 = d2.questions.find(q => q.number === 6);
  line('dupe-q5-stem', !!q5 && /Answer five/.test(q5.stem), `q5=${q5 && q5.stem.slice(0, 60)}`);
  line('dupe-q6-stem', !!q6 && /Answer six/.test(q6.stem), `q6=${q6 && q6.stem.slice(0, 60)}`);
  const b5 = d2.blocks.find(b => typeof b.text === 'string' && /^5\./.test(b.text));
  line('dupe-not-merged', !!b5 && !/Answer six/.test(b5.text), `block5=${b5 && b5.text.slice(0, 80)}`);
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
