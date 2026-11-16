const state = {
  paper: null,
  template: null,
  questions: null,
  data: null,
  selected: null,
  zoom: 1,
  busy: false,
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 2600);
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function setChip(el, file, onClear) {
  if (!file) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<b>${escapeHtml(file.name)}</b><span>${fmtSize(file.size)}</span><button class="x" type="button">×</button>`;
  el.querySelector('.x').onclick = e => { e.stopPropagation(); onClear(); };
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bindDrop(zoneId, inputId, chipId, key) {
  const zone = $('#' + zoneId), input = $('#' + inputId), chip = $('#' + chipId);
  zone.onclick = () => input.click();
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) setFile(key, e.dataTransfer.files[0], chip, input);
  });
  input.onchange = () => { if (input.files[0]) setFile(key, input.files[0], chip, input); };
}

function setFile(key, file, chip, input) {
  state[key] = file;
  setChip(chip, file, () => { state[key] = null; chip.hidden = true; if (input) input.value = ''; });
}

bindDrop('dropPaper', 'filePaper', 'chipPaper', 'paper');
bindDrop('dropTemplate', 'fileTemplate', 'chipTemplate', 'template');
bindDrop('dropQuestions', 'fileQuestions', 'chipQuestions', 'questions');

$$('.tab[data-tab]').forEach(tab => {
  tab.onclick = () => {
    $$('.tab[data-tab]').forEach(t => t.classList.toggle('active', t === tab));
    $$('.tab-pane').forEach(p => { p.hidden = p.dataset.pane !== tab.dataset.tab; });
  };
});

$$('.tab[data-side]').forEach(tab => {
  tab.onclick = () => {
    $$('.tab[data-side]').forEach(t => t.classList.toggle('active', t === tab));
    $$('.side-pane').forEach(p => { p.hidden = p.dataset.side !== tab.dataset.side; });
  };
});

$('#scrollBtn').onclick = () => $('#studio').scrollIntoView({ behavior: 'smooth' });

$$('#fbChips .chip').forEach(chip => {
  chip.onclick = () => { $('#feedbackText').value = chip.textContent; $('#feedbackText').focus(); };
});

async function runFormat() {
  if (!$('#filePaper').files.length && !$('#fileQuestions').files.length) {
    showError('请至少上传论文文件或题目文件。');
    return;
  }
  const hasTemplate = state.template || $('#templateText').value.trim();
  if (!hasTemplate) { showError('请上传模板文件，或直接输入格式要求。'); return; }
  const form = new FormData();
  if (state.paper) form.append('paper', state.paper);
  if (state.template) form.append('template', state.template);
  if (state.questions) form.append('questions', state.questions);
  form.append('templateText', $('#templateText').value.trim());
  form.append('className', $('#className').value);
  form.append('studentName', $('#studentName').value);
  form.append('studentId', $('#studentId').value);
  form.append('workshop', $('#workshop').value);
  form.append('caption', $('#caption').value);
  form.append('lang', $('#lang').value);
  setBusy(true, '正在解析模板与文档…', '读取格式说明、拆分题目、生成并回读 DOCX');
  hideError();
  try {
    const res = await fetch('/api/format', { method: 'POST', body: form });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || '处理失败');
    state.data = json;
    state.selected = null;
    renderResult();
    $('#result').scrollIntoView({ behavior: 'smooth' });
    toast('排版完成，已回读 DOCX 逐段校验');
  } catch (e) {
    showError(e.message);
  } finally {
    setBusy(false);
  }
}

$('#runBtn').onclick = runFormat;

function setBusy(busy, title, sub) {
  state.busy = busy;
  $('#runBtn').disabled = busy;
  $('#loading').hidden = !busy;
  if (title) $('#loadingTitle').textContent = title;
  if (sub) $('#loadingSub').textContent = sub;
}

function showError(msg) { const b = $('#errorBox'); b.textContent = msg; b.hidden = false; }
function hideError() { $('#errorBox').hidden = true; }

$('#demoBtn').onclick = async () => {
  setBusy(true, '正在生成导出效果示例…', '使用内置示例模板与 8 道题，展示真实导出效果');
  hideError();
  try {
    const res = await fetch('/api/demo');
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || '示例生成失败');
    state.data = json;
    state.selected = null;
    renderResult();
    $('#result').scrollIntoView({ behavior: 'smooth' });
    toast('这是示例输出：换你的文件后可得到同样规整的结果');
  } catch (e) { showError(e.message); }
  finally { setBusy(false); }
};

const FONT_CSS = {
  '宋体': '"SimSun","Songti SC","STSong",serif',
  '新宋体': '"NSimSun","SimSun",serif',
  '仿宋': '"FangSong","FangSong_GB2312","STFangsong",serif',
  '仿宋_GB2312': '"FangSong_GB2312","FangSong",serif',
  '黑体': '"SimHei","Heiti SC","STHeiti",sans-serif',
  '楷体': '"KaiTi","Kaiti SC","STKaiti",serif',
  '微软雅黑': '"Microsoft YaHei","PingFang SC",sans-serif',
  'Times New Roman': '"Times New Roman",serif',
  'Arial': 'Arial,Helvetica,sans-serif',
  'Calibri': 'Calibri,sans-serif',
  'Consolas': 'Consolas,monospace',
};

function roleCss(role) {
  const m = state.data.model.roles[role];
  return {
    fontFamily: FONT_CSS[m.font] || (m.font + ',serif'),
    fontSize: (m.sizePt * 96 / 72) + 'px',
    fontWeight: m.bold ? '700' : '400',
    textAlign: m.align === 'both' ? 'justify' : (m.align || 'left'),
    textIndent: role === 'body' && m.firstLineChars ? m.firstLineChars + 'em' : '0',
    lineHeight: String(((m.lineSpacing || 1.5)) * 1.3),
    margin: '0',
  };
}

function createPage(page) {
  const px = v => v / 15;
  const el = document.createElement('div');
  el.className = 'page';
  const body = document.createElement('div');
  body.className = 'page-body';
  body.style.left = px(page.left) + 'px';
  body.style.right = px(page.right) + 'px';
  body.style.top = px(page.top) + 'px';
  body.style.bottom = px(page.bottom) + 'px';
  el.appendChild(body);
  const num = document.createElement('div');
  num.className = 'page-num';
  el.appendChild(num);
  return { el, body, num };
}

function renderPreview() {
  const pagesWrap = $('#pages');
  pagesWrap.innerHTML = '';
  const data = state.data;
  if (!data) return;
  const pageCfg = data.page;

  const chunks = [];
  for (const b of data.blocks) {
    if (b.type === 'image') { chunks.push(b); continue; }
    const text = b.text || '';
    if (b.role === 'code' && text.split('\n').length > 8) {
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i += 8) {
        chunks.push({ ...b, text: lines.slice(i, i + 8).join('\n') });
      }
    } else if (text.length > 680) {
      const parts = text.split(/(?<=[。；;.!?])\s*/);
      let acc = '';
      for (const p of parts) {
        if (acc.length + p.length > 680 && acc) { chunks.push({ ...b, text: acc }); acc = p; }
        else acc += p;
      }
      if (acc) chunks.push({ ...b, text: acc });
    } else {
      chunks.push(b);
    }
  }

  const pages = [];
  let cur = createPage(pageCfg);
  pages.push(cur);
  pagesWrap.appendChild(cur.el);

  const makeEl = block => {
    if (block.type === 'image') {
      const img = document.createElement('img');
      img.src = block.src;
      img.className = 'paper-img';
      img.style.maxHeight = Math.round(1122 - 160) + 'px';
      img.style.maxWidth = '100%';
      img.dataset.index = block.index;
      img.onclick = () => selectPara(block.index, 'body', img);
      return img;
    }
    const div = document.createElement('div');
    div.className = 'paper-para' + (block.role === 'code' ? ' code' : '');
    div.textContent = block.text;
    Object.assign(div.style, roleCss(block.role));
    if (block.role === 'code') div.style.lineHeight = String((state.data.model.roles.code.lineSpacing || 1) * 1.35);
    div.dataset.index = block.index;
    div.dataset.role = block.role;
    div.onclick = () => selectPara(block.index, block.role, div);
    return div;
  };

  chunks.forEach(block => {
    const el = makeEl(block);
    cur.body.appendChild(el);
    if (cur.body.scrollHeight > cur.body.clientHeight) {
      cur.body.removeChild(el);
      cur = createPage(pageCfg);
      pages.push(cur);
      pagesWrap.appendChild(cur.el);
      cur.body.appendChild(el);
    }
  });

  pages.forEach((p, i) => { p.num.textContent = `${i + 1} / ${pages.length}`; });

  const stage = $('#paperStage');
  const avail = stage.clientWidth - 24;
  const pageW = 794;
  state.baseScale = avail < pageW ? Math.max(0.4, avail / pageW) : 1;
  applyZoom();
}

function applyZoom() {
  const s = (state.baseScale || 1) * state.zoom;
  const pages = $('#pages');
  if ('zoom' in pages.style) pages.style.zoom = s;
  else pages.style.transform = `scale(${s})`;
}

$('#zoomIn').onclick = () => { state.zoom = Math.min(1.3, state.zoom + 0.1); applyZoom(); };
$('#zoomOut').onclick = () => { state.zoom = Math.max(0.6, state.zoom - 0.1); applyZoom(); };
window.addEventListener('resize', () => { if (state.data) renderPreview(); });

function selectPara(index, role, el) {
  $$('.paper-para.selected, .paper-img.selected').forEach(e => e.classList.remove('selected'));
  if (!el.classList.contains('paper-img')) el.classList.add('selected');
  state.selected = { index, role };
  const chip = $('#selectionChip');
  chip.hidden = false;
  const roleName = { title: '文件首部', heading: '标题', body: '正文', code: '代码' }[role] || role;
  chip.textContent = `已选中第 ${index + 1} 段（${roleName}）。修改意见会优先针对这一段。点击取消。`;
  chip.onclick = () => { chip.hidden = true; state.selected = null; $$('.paper-para.selected').forEach(e => e.classList.remove('selected')); };
}

function renderResult() {
  const d = state.data;
  if (!d) return;
  $('#result').hidden = false;
  $('#resultSub').textContent = d.demo
    ? '这是内置示例的导出效果。预览即导出效果示例，导出为可选操作。'
    : '预览即导出的样子。你可以导出，也可以只保留预览；校验报告与修改意见都不受影响。';

  const v = d.validation;
  const stats = [
    { b: v.passRate + '%', s: '模板校验通过率', good: v.passRate >= 90 },
    { b: d.stats.questions, s: '识别题目数' },
    { b: d.stats.paragraphs, s: '段落数' },
    { b: d.stats.codeBlocks, s: '代码块' },
    { b: v.failedCount, s: '未通过校验项', good: v.failedCount === 0 },
  ];
  $('#statbar').innerHTML = stats.map(x => `<div class="stat ${x.good ? 'good' : ''}"><b>${x.b}</b><span>${x.s}</span></div>`).join('');

  const notices = [];
  if (d.inputMode === 'questions') notices.push('检测到上传的是题目文件：已先读模板，再把题目逐题插入模板骨架，并为每题补齐模板要求的「分析：/源程序代码：/运行效果：」。如果你上传的是自己的论文，请把论文放到“论文”位置。');
  if (d.lang === 'en' && d.translated === false) notices.push('翻译服务未完全返回结果，部分段落保留了原文；字体与字号未改变。可在修改意见中再次提交“翻译成英文”。');
  if (d.questions.some(q => q.fromSource)) notices.push('有题目是从题目文件补入的（题目清单中标为“补入”），请核对该题答案是否已填写。');
  if (v.missing && v.missing.length) notices.push('校验发现缺少题号：' + v.missing.join(', ') + '。可在修改意见中说明“第 X 题没识别上”。');
  $('#noticeList').innerHTML = notices.map(n => `<div class="notice">${escapeHtml(n)}</div>`).join('');

  renderPreview();
  renderReport();
  renderQuestions();
  renderRounds();
  $('#exportBtn').disabled = !d.hasExport || !d.jobId;
  $('#fbBtn').disabled = !d.jobId;
  $('#reapplyBtn').disabled = !d.jobId;
  $('#fixAllBtn').disabled = !d.jobId;
}

function renderReport() {
  const v = state.data.validation;
  const okAll = v.failedCount === 0;
  $('#reportSum').innerHTML = `<div class="rate">${v.passRate}<small>%</small></div>
    <div class="rate-badge ${okAll ? '' : 'bad'}">${okAll ? '全部通过 · ' : '存在不符合 · '}${v.total} 项检查</div>`;
  const groups = {};
  v.checks.forEach(c => { (groups[c.group] = groups[c.group] || []).push(c); });
  let html = '';
  for (const [g, list] of Object.entries(groups)) {
    html += `<div class="check-group">${escapeHtml(g)}</div>`;
    for (const c of list) {
      html += `<div class="check ${c.ok ? 'ok' : 'ng'}">
        <span class="icon">${c.ok ? '✓' : '!'}</span>
        <div>
          <b>${escapeHtml(c.label)}</b>
          <div class="exp">模板要求：${escapeHtml(c.expected)}</div>
          <div class="act ${c.ok ? '' : 'ng'}">实际输出：${escapeHtml(c.actual)}</div>
          ${c.evidence ? `<div class="ev">依据：${escapeHtml(c.evidence)}</div>` : ''}
          ${c.ok ? '' : `<button class="chip-btn fix-one" data-label="${escapeHtml(c.label)}" style="width:auto;height:auto;padding:4px 9px;margin-top:6px;font-size:11px">按模板修正这一项</button>`}
        </div>
      </div>`;
    }
  }
  $('#checks').innerHTML = html || '<div class="empty">暂无校验项</div>';
  $$('.fix-one').forEach(btn => {
    btn.onclick = () => submitFeedback(`「${btn.dataset.label}」不符合模板要求，请重新读取模板并按模板修正这一项，然后重新核验。`);
  });
}

function renderQuestions() {
  const qs = state.data.questions || [];
  $('#qlist').innerHTML = qs.length ? qs.map(q => `<div class="qitem">
    <b>${q.number}.</b>${escapeHtml(q.stem || '（题干为空）')}
    ${q.fromSource ? '<span class="src">补入自题目文件</span>' : ''}
  </div>`).join('') : '<div class="empty">未识别到题目。若论文本身没有题号，请同时上传题目文件。</div>';
}

function renderRounds() {
  const rounds = state.data.rounds || [];
  if (!rounds.length) {
    $('#rounds').innerHTML = '<div class="empty">还没有修改记录。提交第一条修改意见后，这里会记录每次“重读模板 → 重新生成 → 再校验”的证据。</div>';
    return;
  }
  $('#rounds').innerHTML = rounds.slice().reverse().map(r => `<div class="round">
    <div class="round-top"><b>第 ${r.index} 轮返修</b><span>通过率 ${r.passRate}% · 未通过 ${r.failed}</span></div>
    <div class="round-fb">${escapeHtml(r.feedback)}</div>
    ${r.actions.map(a => `<div class="round-act">· ${escapeHtml(a.text)}</div>`).join('')}
    <div class="round-chg">${r.changes.map(c => escapeHtml(c)).join(' ｜ ')}</div>
  </div>`).join('');
}

async function submitFeedback(text) {
  const d = state.data;
  if (!d || !d.jobId) { toast('示例不能提交修改意见，请先上传自己的文件排版'); return; }
  if (state.busy) return;
  const msg = text || $('#feedbackText').value.trim();
  if (!msg) { toast('请输入修改意见'); return; }
  setBusy(true, '正在按你的意见返修…', '重读模板 / 题目文件，重新生成并回读校验');
  const status = $('#fbStatus');
  status.hidden = true;
  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: d.jobId, text: msg, selection: state.selected }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || '返修失败');
    state.data = json;
    renderResult();
    $('#feedbackText').value = '';
    status.hidden = false;
    status.textContent = `第 ${json.lastRound.index} 轮完成：` + json.lastRound.actions.map(a => a.text).join(' ');
    $$('.tab[data-side]').forEach(t => t.classList.toggle('active', t.dataset.side === 'feedback'));
    $$('.side-pane').forEach(p => { p.hidden = p.dataset.side !== 'feedback'; });
    toast('返修完成，已重新回读校验');
  } catch (e) { showError(e.message); }
  finally { setBusy(false); }
}

$('#fbBtn').onclick = () => submitFeedback(null);
$('#reapplyBtn').onclick = () => submitFeedback('请重新读取模板，按模板全量重排，并逐段回读校验所有不一致的地方。');
$('#fixAllBtn').onclick = () => submitFeedback('格式存在不一致：请重新读取模板，按模板全量重排，并逐段回读校验。');

$('#exportBtn').onclick = () => {
  const d = state.data;
  if (!d || !d.jobId) return;
  window.location.href = '/api/export/' + d.jobId;
  toast('已开始下载 DOCX');
};

$('#skipExportBtn').onclick = () => {
  toast('已保留预览，未导出文件；随时可以再点“导出 DOCX”。');
};
