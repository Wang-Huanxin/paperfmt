const fs = require('fs');
const path = require('path');
const base = path.resolve(__dirname, '../../samples');
const API = 'http://127.0.0.1:8123';

(async () => {
  const paper = ['1. 本题要求使用线性查找和递归二分查找，在 1 到 1000 之间生成 300 个随机整数并比较查找次数。', '答：我先用 rand 生成数组，再用线性查找统计比较次数。', '2. 求两个正整数的最大公约数。', '答：使用欧几里得算法递归实现，调用次数为 9 次。'].join('\n');
  const form = new FormData();
  form.append('paper', new Blob([paper]), 'paper-zh.txt');
  form.append('template', new Blob([fs.readFileSync(path.join(base, 'template.doc'))]), 'template.doc');
  form.append('lang', 'en');
  form.append('workshop', '8');
  const res = await fetch(API + '/api/format', { method: 'POST', body: form });
  const d = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(d));
  console.log('pass=' + d.validation.passRate + '% failed=' + d.validation.failedCount + ' lang=' + d.lang + ' translated=' + d.translated);
  const bodies = d.blocks.filter(b => b.role === 'body').slice(0, 6);
  for (const b of bodies) console.log('BODY:', b.text.slice(0, 110));
  const enCheck = d.validation.checks.filter(c => /english/i.test(c.id));
  console.log('english-font checks:', JSON.stringify(enCheck));
  const ex = await fetch(API + '/api/export/' + d.jobId);
  fs.writeFileSync(path.join(base, 'export-zh-en.docx'), Buffer.from(await ex.arrayBuffer()));
  console.log('export saved');
})().catch(e => { console.error(e); process.exit(1); });
