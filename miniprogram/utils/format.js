function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatClock(value) {
  const date = parseDate(value);
  if (!date) return '';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDayLabel(value) {
  const date = parseDate(value) || new Date();
  const now = new Date();
  if (isSameDay(date, now)) return '今天';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return '昨天';
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatListTime(value) {
  const date = parseDate(value);
  if (!date) return '';
  const now = new Date();
  if (isSameDay(date, now)) return formatClock(date);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return '昨天';
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function formatRelativeTime(value) {
  const date = parseDate(value);
  if (!date) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`;
  return formatListTime(date);
}

function getAnswerPreview(answer, maxLength) {
  const text = String(answer || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= (maxLength || 60)) return text;
  return `${text.slice(0, maxLength || 60)}…`;
}

module.exports = {
  formatClock,
  formatDayLabel,
  formatListTime,
  formatRelativeTime,
  getAnswerPreview,
};
