# paperfmt

论文模板排版工具：提取 → 结构化 → 套用模板 → 导出 docx。

## 结构

- `src/` 核心流程（extract / structure / template / compose / docxgen / validate / translate）
- `public/` 前端页面
- `scripts/` 测试与导出脚本
- `samples/` 样例论文与模板

## 运行

```bash
npm install
node server.js
```

## 测试

```bash
node scripts/test-pipeline.js
```
