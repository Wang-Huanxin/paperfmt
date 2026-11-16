const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { extractTextBuffer } = require('./src/extract');
const { buildModel } = require('./src/template');
const { parseSource, questionStem, isCodeLine } = require('./src/structure');
const { compose } = require('./src/compose');
const { buildDocx } = require('./src/docxgen');
const { validateDocx } = require('./src/validate');
const { translateText } = require('./src/translate');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 3 } });
const jobs = new Map();
const TTL = 2 * 60 * 60 * 1000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

function id() { return crypto.randomBytes(8).toString('hex'); }

function gcJobs() {
  const now = Date.now();
  for (const [k, v] of jobs) if (now - v.createdAt > TTL) jobs.delete(k);
}
setInterval(gcJobs, 10 * 60 * 1000).unref();

function templateInput(job) {
  if (job.templateBuf) {
    return extractTextBuffer(job.templateBuf, job.templateName).then(r => ({ ...r, text: r.text || '' }));
  }
  return Promise.resolve({ type: 'text', text: job.templateText || '', blocks: [], page: null });
}

async function parsePaper(job) {
  if (!job.paperBuf) return null;
  return extractTextBuffer(job.paperBuf, job.paperName);
}

async function parseQuestions(job) {
  if (!job.questionBuf) return null;
  const r = await extractTextBuffer(job.questionBuf, job.questionName);
  const parsed = parseSource(r.blocks);
  return { ...r, ...parsed, lines: parsed.lines };
}

function summarize(job, composed, validation, docBuffer) {
  const paraCount = composed.blocks.filter(b => b.text !== undefined).length;
  const codeCount = composed.blocks.filter(b => b.role === 'code').length;
  const imageCount = composed.blocks.filter(b => b.type === 'image').length;
  const chars = composed.blocks.reduce((n, b) => n + ((b.text || '').length), 0);
  return {
    jobId: job.id,
    createdAt: job.createdAt,
    model: {
      roles: job.model.roles,
      evidence: job.model.evidence,
      caption: job.model.caption,
      headings: job.model.headings,
      rawText: (job.model.rawText || '').slice(0, 4000),
      templateType: job.model.templateType,
    },
    blocks: composed.blocks.map((b, i) => b.type === 'image'
      ? { type: 'image', index: i, w: b.image.width, h: b.image.height, src: 'data:image/' + (b.image.ext === 'jpg' ? 'jpeg' : b.image.ext) + ';base64,' + Buffer.from(b.image.buffer).toString('base64') }
      : { type: 'para', index: i, role: b.role, text: b.text }),
    questions: composed.questions,
    page: job.model.roles.page,
    validation,
    stats: { paragraphs: paraCount, codeBlocks: codeCount, images: imageCount, chars, questions: composed.questions.length },
    rounds: job.rounds,
    lang: composed.lang,
    translated: composed.translated,
    notices: job.notices,
    inputMode: job.inputMode,
    hasExport: !!docBuffer,
  };
}

function detectInputMode(paper, questions, questionSource) {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const p = norm(paper && paper.text);
  if (!p) return 'none';
  const q = norm(questionSource && questionSource.text);
  if (q) {
    if (p === q || p.includes(q) || q.includes(p)) return 'questions';
    const stems = (questions || []).map(x => norm(questionStem(x)).slice(0, 40)).filter(s => s.length > 15);
    if (stems.length >= 2) {
      const hit = stems.filter(s => q.includes(s)).length;
      if (hit / stems.length >= 0.6) return 'questions';
    }
    return 'paper';
  }
  if (/分析\s*[：:]|源程序代码\s*[：:]|运行效果\s*[：:]|答\s*[：:]|解\s*[：:]/i.test(p)) return 'paper';
  const qs = questions || [];
  if (qs.length >= 2) {
    let residual = 0;
    for (const item of qs) {
      const rawLen = (item.raw || []).join(' ').length;
      const stemLen = questionStem(item).length;
      const codeLen = (item.raw || []).filter(l => isCodeLine(l)).join(' ').length;
      residual += Math.max(0, rawLen - stemLen - codeLen);
    }
    if (residual / qs.length < 120) return 'questions';
  }
  return 'paper';
}

async function generate(job) {
  const tpl = await templateInput(job);
  job.model = buildModel(tpl);
  if (job.overrides && job.overrides.fonts) {
    for (const [role, font] of Object.entries(job.overrides.fonts)) {
      if (job.model.roles[role]) job.model.roles[role].font = font;
    }
  }
  const paper = await parsePaper(job);
  const paperParsed = paper ? { ...paper, ...parseSource(paper.blocks) } : null;
  const qsrc = await parseQuestions(job);
  const inputMode = detectInputMode(paperParsed, paperParsed ? paperParsed.questions : [], qsrc);
  job.inputMode = inputMode;
  const composed = await compose({
    paper: paperParsed,
    questionSource: qsrc,
    model: job.model,
    meta: job.meta,
    lang: job.lang,
    mode: inputMode,
    translateFn: job.lang === 'en' ? translateText : null,
  });
  job.composed = composed;
  job.questions = composed.questions;
  const docBuffer = await buildDocx({ blocks: composed.blocks, questions: composed.questions, lang: composed.lang }, job.model);
  job.docBuffer = docBuffer;
  job.validation = await validateDocx(docBuffer, job.model, { blocks: composed.blocks, questions: composed.questions, lang: composed.lang });
  return docBuffer;
}

function feedbackIntents(text, job) {
  const t = (text || '').replace(/\s+/g, ' ');
  const intents = { roles: [], fonts: [], missing: [], merge: false, generic: false, english: false, overflow: false };
  if (/英文版|翻成英文|翻译成英文|translate|english version/i.test(t)) intents.english = true;
  if (/第\s*\d+\s*和\s*\d+\s*题|第\s*\d+\s*、\s*\d+\s*题|两题合并|合并成|一题写成两题/.test(t)) intents.merge = true;
  const fontRe = /(仿宋_GB2312|仿宋GB2312|仿宋|宋体|黑体|楷体|微软雅黑|Times New Roman|Arial|Calibri|Consolas)/i;
  const fontMatch = fontRe.exec(t);
  if (fontMatch) intents.fonts.push(fontMatch[1]);
  if (/正文/.test(t)) intents.roles.push('body');
  if (/代码|源程序/.test(t)) intents.roles.push('code');
  if (/首部|大标题|报告标题/.test(t)) intents.roles.push('title');
  if (/标题/.test(t) && !/首部|大标题|报告标题/.test(t)) intents.roles.push('heading');
  if (/格式|字体|字号|行距|缩进|对齐|加粗|排版|不一致|不统一|不对|偏差|不准确|不符合|不好/.test(t)) intents.generic = true;
  const missPattern = [/第\s*(\d{1,2})\s*题[^。；]{0,20}(没|未|缺|漏|识别|补|加上|没有|不在|少)/, /(没|未|缺|漏|识别)[^。；]{0,10}第\s*(\d{1,2})\s*题/];
  for (const p of missPattern) {
    const m = p.exec(t);
    if (m) {
      const token = m[1] && /\d/.test(m[1]) ? m[1] : (m[2] || '');
      const num = Number(token.replace(/\D/g, ''));
      if (num >= 1 && num <= 99) intents.missing.push(num);
    }
  }
  if (/出画面|溢出|超出页面|超出边界|跑到外面/.test(t)) intents.overflow = true;
  return intents;
}

async function applyFeedback(job, text, selection) {
  const before = {
    numbers: job.validation ? job.validation.numbers : [],
    paperNumbers: job.composed && job.composed.questions ? job.composed.questions.filter(q => !q.fromSource).map(q => q.number) : [],
    failed: job.validation ? job.validation.failedCount : 0,
    fonts: job.model ? { title: job.model.roles.title.font, heading: job.model.roles.heading.font, body: job.model.roles.body.font, code: job.model.roles.code.font } : {},
  };
  const intents = feedbackIntents(text, job);
  const actions = [];
  if (intents.english) {
    job.lang = job.lang === 'en' ? 'en' : 'en';
    actions.push({ type: 'language', text: '切换到英文版：仅翻译文字，模板字体/字号/缩进/行距全部保持不变。' });
  }
  if (intents.overflow) {
    actions.push({ type: 'overflow', text: '已重新按 A4 版心高度分页渲染，长单词/代码自动换行，不再溢出页面。' });
  }

  if (intents.fonts.length) {
    const font = intents.fonts[0];
    const roles = intents.roles.length ? intents.roles : ['body'];
    const tpl = await templateInput(job);
    let sample = '';
    let sampleRole = '';
    for (const b of (tpl.blocks || [])) {
      for (const r of (b.runs || [])) {
        if (r.font && String(r.font).includes(font) && (r.text || '').trim()) {
          sample = (b.text || '').trim().slice(0, 50);
          sampleRole = r.text.trim().slice(0, 20);
          break;
        }
      }
      if (sample) break;
    }
    const tplText = (tpl.text || '') + '\n' + ((job.model && job.model.rawText) || '');
    const inText = new RegExp(font).test(tplText);
    const inFormat = !!sample;
    job.overrides = job.overrides || {};
    job.overrides.fonts = job.overrides.fonts || {};
    for (const role of roles) {
      job.overrides.fonts[role] = font;
      const ev = job.model && job.model.evidence && job.model.evidence[role] ? `模板原文：「${job.model.evidence[role]}」。` : '';
      const reRead = inFormat
        ? `已重读模板文件：模板中确有 ${font} 的实际排版样例（文字“${sampleRole}”，所在段落“${sample}”）。`
        : inText
          ? `${ev}已重读模板文件，模板文字说明中明确出现“${font}”。`
          : `已重读模板文件（文字说明 + 段落实际字体）：模板中没有出现“${font}”，${ev}`;
      actions.push({
        type: 'font',
        role,
        font,
        source: (inFormat || inText) ? 'template' : 'user',
        text: (inFormat || inText)
          ? `${reRead}已将${role === 'body' ? '正文' : role === 'heading' ? '标题' : '首部'}全部段落重设为 ${font}（中英文四个字体槽一致），并回读确认。`
          : `${reRead}按你的明确要求，已将${role === 'body' ? '正文' : '标题'}字体覆盖为 ${font}（来源：用户指定），其余字号/行距/缩进继续沿用模板。`,
      });
    }
  }

  if (intents.generic && !intents.fonts.length) {
    actions.push({ type: 'reapply', text: '已重新读取模板原文与模板样式，按模板逐项重新应用标题/正文/代码的字体、字号、缩进、行距和对齐，并全量回读输出核验。' });
    if (selection && selection.role) {
      actions.push({ type: 'selection', text: `已定位到你选中的${selection.role === 'body' ? '正文' : selection.role === 'heading' ? '标题' : '首部'}段落（第 ${selection.index + 1} 段），已按模板重新应用并单独核验。` });
    }
  }

  const pendingMissing = [];
  if (intents.missing.length) {
    const paperQs = job.paperBuf ? (parseSource((await parsePaper(job)).blocks).questions || []) : [];
    for (const num of intents.missing) {
      let found = null;
      let inPaper = false;
      let foundStem = '';
      const pq = paperQs.find(q => q.number === num);
      if (pq) {
        found = pq;
        inPaper = true;
      }
      if (!found && job.questionBuf) {
        const qsrc = await parseQuestions(job);
        found = (qsrc.questions || []).find(q => q.number === num) || null;
        if (!found) {
          const textAll = qsrc.text || '';
          const lines = textAll.split('\n');
          const idx = lines.findIndex(l => new RegExp('^\\s*' + num + '\\s*\\*{0,2}\\s*[.)、:：]').test(l));
          if (idx >= 0) found = { number: num, raw: lines.slice(idx, idx + 6), lines: [] };
        }
      }
      if (found) {
        const stem = (found.raw || []).join(' ').replace(/\s+/g, ' ').trim();
        foundStem = stem.length > 90 ? stem.slice(0, 90) + '…' : stem;
      }
      pendingMissing.push({ num, found: !!found, inPaper, beforePresent: before.paperNumbers.includes(num), stem: foundStem });
    }
  }

  await generate(job);

  if (intents.merge) {
    const nums = job.validation.numbers || [];
    const q5 = job.composed.questions.find(q => q.number === 5);
    const q6 = job.composed.questions.find(q => q.number === 6);
    const ev = q5 && q6
      ? `第5题开头“${q5.stem.slice(0, 36)}…”，第6题开头“${q6.stem.slice(0, 36)}…”，两题各自独立成段。`
      : '';
    actions.push({
      type: 'numbering',
      text: `已重新按 1、2、3…递增顺序解析题号，回读结果：${nums.join('、')}（共 ${nums.length} 题）。${ev}题号重复（如两个“5.”）会把后一个修正为下一题；题目内部的小问编号（如“1. Draw…”）不再被误判为新题，也不会两两合并。`,
    });
  }

  for (const item of pendingMissing) {
    const num = item.num;
    if (!item.found) {
      actions.push({
        type: 'question', number: num, found: false,
        text: `已重新读取论文文件与题目文件，均未找到第 ${num} 题。请确认上传的题目文件是否包含该题，或直接在论文文件中补上第 ${num} 题。`,
      });
      continue;
    }
    const q = (job.composed.questions || []).find(x => x.number === num);
    const block = (job.composed.blocks || []).find(b => typeof b.text === 'string' && new RegExp('^' + num + '\\.').test(b.text));
    const evidence = block ? block.text.replace(/\s+/g, ' ').slice(0, 90) : (q ? q.stem.slice(0, 90) : item.stem);
    if (item.inPaper && item.beforePresent) {
      actions.push({
        type: 'question', number: num, found: true, alreadyPresent: true,
        text: `已重读论文文件核对：第 ${num} 题在你的论文中确实存在（开头“${item.stem}”），报告中该题独立成段（开头“${evidence}”）。若你看到的段落内容不对，请说明缺的是哪一部分，我会按原文补齐。`,
      });
    } else if (item.inPaper) {
      actions.push({
        type: 'question', number: num, found: true,
        text: `已重读论文文件，定位到第 ${num} 题（开头“${item.stem}”），已补入报告并独立成段（开头“${evidence}”），题号已重新核验。`,
      });
    } else {
      actions.push({
        type: 'question', number: num, found: true, supplemented: true,
        text: `已重读论文文件：论文中没有第 ${num} 题。已从题目文件读出第 ${num} 题原文（开头“${item.stem}”），补入报告并独立成段（开头“${evidence}”），不再是两题合并或漏题。`,
      });
    }
  }

  const after = {
    numbers: job.validation.numbers,
    failed: job.validation.failedCount,
    fonts: { title: job.model.roles.title.font, heading: job.model.roles.heading.font, body: job.model.roles.body.font, code: job.model.roles.code.font },
  };
  const changes = [];
  if (before.numbers.join(',') !== after.numbers.join(',')) {
    changes.push(`题号序列：${before.numbers.join(',') || '无'} → ${after.numbers.join(',') || '无'}`);
  }
  if (before.failed !== after.failed) changes.push(`未通过校验项：${before.failed} → ${after.failed}`);
  if (before.fonts.body !== after.fonts.body) changes.push(`正文字体：${before.fonts.body} → ${after.fonts.body}`);
  if (before.fonts.heading !== after.fonts.heading) changes.push(`标题字体：${before.fonts.heading} → ${after.fonts.heading}`);
  if (!changes.length) changes.push('题号序列、字体与校验项均无结构性变化；已重新生成并逐段回读核验（证据见校验报告）。');

  const round = {
    index: job.rounds.length + 1,
    feedback: text,
    actions,
    changes,
    at: Date.now(),
    passRate: job.validation.passRate,
    failed: job.validation.failedCount,
  };
  job.rounds.push(round);
  return round;
}

app.post('/api/format', upload.fields([{ name: 'paper', maxCount: 1 }, { name: 'template', maxCount: 1 }, { name: 'questions', maxCount: 1 }]), async (req, res) => {
  try {
    const files = req.files || {};
    const paperFile = files.paper && files.paper[0];
    const templateFile = files.template && files.template[0];
    const qFile = files.questions && files.questions[0];
    const body = req.body || {};
    const templateText = (body.templateText || '').trim();
    if (!paperFile && !qFile) return res.status(400).json({ error: '请先上传论文文件（或至少上传题目文件）。' });
    if (!templateFile && !templateText) return res.status(400).json({ error: '请上传模板文件，或直接输入格式要求。' });

    const job = {
      id: id(),
      createdAt: Date.now(),
      paperBuf: paperFile ? paperFile.buffer : null,
      paperName: paperFile ? paperFile.originalname : '',
      templateBuf: templateFile ? templateFile.buffer : null,
      templateName: templateFile ? templateFile.originalname : '',
      templateText,
      questionBuf: qFile ? qFile.buffer : null,
      questionName: qFile ? qFile.originalname : '',
      meta: {
        className: (body.className || '').trim(),
        studentId: (body.studentId || '').trim(),
        studentName: (body.studentName || '').trim(),
        workshop: (body.workshop || '').trim(),
        caption: (body.caption || '').trim(),
      },
      lang: body.lang === 'en' ? 'en' : 'zh',
      rounds: [],
      notices: [],
      overrides: { fonts: {} },
    };
    await generate(job);
    jobs.set(job.id, job);
    res.json(summarize(job, job.composed, job.validation, job.docBuffer));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '处理失败：' + e.message });
  }
});

app.post('/api/feedback', async (req, res) => {
  try {
    const { jobId, text, selection } = req.body || {};
    const job = jobs.get(jobId);
    if (!job) return res.status(404).json({ error: '会话已过期，请重新上传文件。' });
    if (!text || !text.trim()) return res.status(400).json({ error: '请输入修改意见。' });
    const round = await applyFeedback(job, text.trim(), selection);
    res.json({ ...summarize(job, job.composed, job.validation, job.docBuffer), lastRound: round });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '修改失败：' + e.message });
  }
});

app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: '会话已过期，请重新上传文件。' });
  res.json(summarize(job, job.composed, job.validation, job.docBuffer));
});

app.get('/api/export/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.docBuffer) return res.status(404).json({ error: '文件不存在或已过期' });
  const base = (job.meta.studentName ? job.meta.studentName + '-' : '') + 'formatted-report.docx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(base) + '"');
  res.end(job.docBuffer);
});

app.get('/api/demo', async (req, res) => {
  try {
    const demoText = [
      '【计算思维与算法实验报告  文件命名要求：班级-学号-姓名-n（n为workshop的编号）  删除   】',
      '【文件首部格式：小三号、黑体、加粗、居中、1.5倍行距 】',
      '【注：标题小四号、黑体、加粗、无缩进、1.5倍行距；',
      '正文小四号宋体，首行缩进2字符、1.5倍行距】',
      '实验内容',
      '二、遇到的问题',
    ].join('\n');
    const demoPaper = [
      '159102 workshop – Week 9',
      '1. What is the resolution of the screen you are using?',
      '2. Find a useful website to help you answer the following.',
      '3. Write a program to display a cyan rectangle.',
      '4. What colour do you get if the three RGB values are the same?',
      '5. Write down the first four lines of smallimage.ppm.',
      '6. Find an interesting flag and create its image.',
      '7. What does the system command F: do?',
      '8. Identify the five errors in the program that creates a green rectangle.',
    ].join('\n');
    const job = {
      id: id(), createdAt: Date.now(), paperBuf: null, templateBuf: null,
      templateText: demoText, paperName: 'demo', templateName: '',
      questionBuf: null, questionName: '',
      meta: { className: '班级', studentId: '学号', studentName: '姓名', workshop: '9', caption: '计算思维与算法实验报告' },
      lang: 'zh', rounds: [], notices: [], overrides: { fonts: {} },
    };
    const paper = { text: demoPaper, blocks: demoPaper.split('\n').map(t => ({ text: t })), type: 'text' };
    job.model = buildModel({ type: 'text', text: demoText, blocks: [], page: null });
    const ps = { ...paper, ...parseSource(paper.blocks) };
    const composed = await compose({ paper: ps, questionSource: null, model: job.model, meta: job.meta, lang: 'zh' });
    const buf = await buildDocx({ blocks: composed.blocks, questions: composed.questions, lang: 'zh' }, job.model);
    const validation = await validateDocx(buf, job.model, { blocks: composed.blocks, questions: composed.questions, lang: 'zh' });
    res.json({ ...summarize({ ...job, composed, validation, docBuffer: buf }, composed, validation, buf), demo: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '示例生成失败：' + e.message });
  }
});

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '单个文件不能超过 30MB。' });
  res.status(500).json({ error: err.message || '服务器错误' });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => console.log('paperfmt listening on ' + PORT));
