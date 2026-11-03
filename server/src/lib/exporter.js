import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  PageNumber,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';

const FONT = {
  ascii: 'Calibri',
  hAnsi: 'Calibri',
  eastAsia: 'Microsoft YaHei',
  cs: 'Microsoft YaHei',
};

const GREEN = '087F4F';
const DARK = '1F2937';
const MUTED = '6B7280';
const LIGHT_GREEN = 'EEF8F2';
const BORDER = 'DDE7E1';

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}

export function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function formatFileTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${formatDate(date)}_${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

function buildSummary(questions) {
  const students = new Set(questions.map((item) => item.studentLabel));
  const likes = questions.reduce((sum, item) => sum + item.likeCount, 0);
  const times = questions.map((item) => new Date(item.createdAt).getTime()).filter(Number.isFinite);
  const range = times.length
    ? `${formatDateTime(new Date(Math.min(...times)))} 至 ${formatDateTime(new Date(Math.max(...times)))}`
    : '暂无提问';
  return {
    count: questions.length,
    students: students.size,
    likes,
    range,
  };
}

function blockquote(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

export function createMarkdownExport({ questions, generatedAt = new Date() }) {
  const summary = buildSummary(questions);
  const lines = [
    '# 数学分析课程 · 学生提问汇总',
    '',
    `> 导出时间：${formatDateTime(generatedAt)}  `,
    `> 提问数量：${summary.count} 条 · 参与学生：${summary.students} 人 · 累计点赞：${summary.likes}  `,
    `> 时间范围：${summary.range}`,
    '',
  ];

  if (!questions.length) {
    lines.push('暂无提问记录。', '');
  }

  questions.forEach((item, index) => {
    lines.push(
      `## ${index + 1}. ${item.studentLabel}`,
      '',
      `**时间**：${formatDateTime(item.createdAt)} · **点赞**：${item.likeCount} · **状态**：已回答`,
      '',
      '**问题**',
      '',
      blockquote(item.question),
      '',
      '**DeepSeek 回答**',
      '',
      String(item.answer || '').trim() || '_暂无回答_',
      '',
      '---',
      '',
    );
  });

  lines.push('', `_由数学分析答疑系统自动生成 · ${formatDate(generatedAt)}_`, '');
  return lines.join('\n');
}

function dividerParagraph() {
  return new Paragraph({
    spacing: { before: 220, after: 220 },
    border: {
      bottom: { color: BORDER, style: BorderStyle.SINGLE, size: 6, space: 1 },
    },
    children: [],
  });
}

function richTextParagraph(text, { size = 21, color = DARK, bold = false, indent = 0 } = {}) {
  return new Paragraph({
    indent: indent ? { left: indent } : undefined,
    spacing: { after: 110, line: 330 },
    children: [
      new TextRun({
        text,
        size,
        color,
        bold,
        font: FONT,
      }),
    ],
  });
}

function textBlock(text, options = {}) {
  const source = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!source) return [richTextParagraph('暂无回答', { ...options, color: MUTED })];
  return source.split('\n').map((line) => {
    if (!line.trim()) {
      return new Paragraph({ spacing: { after: 80 }, children: [] });
    }
    return richTextParagraph(line, options);
  });
}

function header() {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: '数学分析课程 · 答疑记录',
            color: MUTED,
            size: 18,
            font: FONT,
          }),
        ],
      }),
    ],
  });
}

function footer() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: '第 ',
            color: MUTED,
            size: 18,
            font: FONT,
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            color: MUTED,
            size: 18,
            font: FONT,
          }),
          new TextRun({
            text: ' 页',
            color: MUTED,
            size: 18,
            font: FONT,
          }),
        ],
      }),
    ],
  });
}

export async function createDocxExport({ questions, generatedAt = new Date() }) {
  const summary = buildSummary(questions);
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 110 },
      children: [
        new TextRun({
          text: '数学分析课程',
          bold: true,
          size: 44,
          color: GREEN,
          font: FONT,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 280 },
      children: [
        new TextRun({
          text: '学生提问汇总',
          bold: true,
          size: 30,
          color: DARK,
          font: FONT,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
      children: [
        new TextRun({
          text: `导出时间：${formatDateTime(generatedAt)}`,
          size: 19,
          color: MUTED,
          font: FONT,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 140, line: 330 },
      shading: { fill: LIGHT_GREEN },
      indent: { left: 180, right: 180 },
      children: [
        new TextRun({
          text: `共 ${summary.count} 条提问 · ${summary.students} 位学生参与 · 累计 ${summary.likes} 个赞`,
          bold: true,
          size: 21,
          color: GREEN,
          font: FONT,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 240, line: 300 },
      indent: { left: 180, right: 180 },
      children: [
        new TextRun({
          text: `时间范围：${summary.range}`,
          size: 19,
          color: MUTED,
          font: FONT,
        }),
      ],
    }),
    dividerParagraph(),
  ];

  if (!questions.length) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 600 },
        children: [
          new TextRun({
            text: '暂无提问记录',
            size: 24,
            color: MUTED,
            font: FONT,
          }),
        ],
      }),
    );
  }

  questions.forEach((item, index) => {
    children.push(
      new Paragraph({
        spacing: { before: index === 0 ? 80 : 280, after: 80 },
        keepNext: true,
        children: [
          new TextRun({
            text: `${String(index + 1).padStart(2, '0')}`,
            bold: true,
            size: 23,
            color: GREEN,
            font: FONT,
          }),
          new TextRun({
            text: `  ${item.studentLabel}`,
            bold: true,
            size: 24,
            color: DARK,
            font: FONT,
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: 160 },
        keepNext: true,
        children: [
          new TextRun({
            text: `${formatDateTime(item.createdAt)}  ·  点赞 ${item.likeCount}  ·  已回答`,
            size: 18,
            color: MUTED,
            font: FONT,
          }),
        ],
      }),
      new Paragraph({
        spacing: { before: 80, after: 80 },
        keepNext: true,
        children: [
          new TextRun({
            text: '问题',
            bold: true,
            size: 20,
            color: GREEN,
            font: FONT,
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: 160, line: 330 },
        shading: { fill: LIGHT_GREEN },
        indent: { left: 180, right: 180 },
        children: [
          new TextRun({
            text: String(item.question || '').trim(),
            size: 21,
            color: DARK,
            font: FONT,
          }),
        ],
      }),
      new Paragraph({
        spacing: { before: 110, after: 80 },
        keepNext: true,
        children: [
          new TextRun({
            text: 'DeepSeek 回答',
            bold: true,
            size: 20,
            color: GREEN,
            font: FONT,
          }),
        ],
      }),
      ...textBlock(item.answer, { size: 21, color: DARK }),
    );
    if (index < questions.length - 1) children.push(dividerParagraph());
  });

  const doc = new Document({
    creator: '数学分析答疑系统',
    title: '数学分析课程 · 学生提问汇总',
    description: '由数学分析答疑系统导出的学生提问与 DeepSeek 回答记录',
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 21, color: DARK },
          paragraph: { spacing: { line: 330 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1100, right: 1000, bottom: 1000, left: 1000 },
          },
        },
        headers: { default: header() },
        footers: { default: footer() },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export function exportFileName(format, generatedAt = new Date()) {
  return `数学分析_学生提问汇总_${formatFileTime(generatedAt)}.${format}`;
}

export function contentDisposition(filename) {
  const fallback = filename
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
