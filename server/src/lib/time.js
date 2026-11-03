/**
 * 以业务时区计算“今天 00:00”对应的 UTC 时间。
 * 中国标准时间为 UTC+8，默认 480 分钟。
 */
export function startOfBusinessDay(now = new Date(), offsetMinutes = 480) {
  const offsetMs = offsetMinutes * 60 * 1000;
  const shifted = new Date(now.getTime() + offsetMs);
  const localMidnightAsUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return new Date(localMidnightAsUtc - offsetMs);
}

export function toIsoString(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toSafeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
