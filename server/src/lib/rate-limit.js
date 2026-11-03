/**
 * 进程内滑动窗口限流。重启即清空；多实例部署时应替换为 Redis 等共享存储。
 */
export class SlidingWindowLimiter {
  constructor({ limit, windowMs, name = 'limiter' }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.name = name;
    this.buckets = new Map();
    this.lastCleanup = 0;
  }

  _cleanup(now) {
    if (now - this.lastCleanup < this.windowMs) return;
    this.lastCleanup = now;
    for (const [key, timestamps] of this.buckets) {
      const alive = timestamps.filter((time) => now - time < this.windowMs);
      if (alive.length) this.buckets.set(key, alive);
      else this.buckets.delete(key);
    }
  }

  check(key) {
    const now = Date.now();
    this._cleanup(now);
    const timestamps = (this.buckets.get(key) ?? []).filter(
      (time) => now - time < this.windowMs,
    );
    if (timestamps.length >= this.limit) {
      const oldest = timestamps[0];
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.max(1, Math.ceil((this.windowMs - (now - oldest)) / 1000)),
      };
    }
    timestamps.push(now);
    this.buckets.set(key, timestamps);
    return {
      allowed: true,
      remaining: this.limit - timestamps.length,
      retryAfter: 0,
    };
  }
}
