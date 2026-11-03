import { DeepSeekError } from './errors.js';

const SYSTEM_PROMPT = `你是一名耐心、严谨的大学《数学分析》答疑老师。学生的问题通常涉及极限、连续、导数、积分、级数、多元函数等主题。

请用中文回答，目标是让学生真正理解，而不是只得到答案：
1. 先判断题目类型和关键条件，必要时指出隐含假设；
2. 说明解题思路，再给出关键推导步骤；
3. 最后用一句话给出明确结论；
4. 如果题目条件不足或有歧义，先说明你的理解，再在合理假设下作答；
5. 发现学生概念错误时，温和地指出并解释原因。

输出会直接显示在微信小程序的纯文本气泡中，请遵守以下格式：
- 不使用 Markdown 标题、表格、代码块或分隔线；
- 用短段落和“1. 2. 3.”组织步骤，必要时使用小标题（不带 #）；
- 数学公式尽量使用 Unicode 符号，例如 ∫、∑、lim、→、≤、ε、δ；
- 复杂公式可单独换行，用 $...$ 包裹；不要输出 \\\\[ 或 \\\\]；
- 避免冗长寒暄，回答控制在约 1200 字以内，除非题目确实需要更长推导。`;

const DEFAULT_SYSTEM_PROMPT = SYSTEM_PROMPT;

function normalizeContext(context, maxMessages) {
  if (!Array.isArray(context) || maxMessages <= 0) return [];
  return context
    .slice(-maxMessages)
    .filter(
      (item) =>
        item &&
        (item.role === 'user' || item.role === 'assistant') &&
        typeof item.content === 'string' &&
        item.content.trim(),
    )
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, 6000),
    }));
}

function upstreamMessage(payload) {
  const message = payload?.error?.message;
  if (typeof message !== 'string') return '';
  return message.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DeepSeekClient {
  constructor({
    apiKey,
    baseUrl = 'https://api.deepseek.com',
    model = 'deepseek-chat',
    visionModel = 'deepseek-flash',
    timeoutMs = 60_000,
    maxContextMessages = 12,
  }) {
    this.apiKey = apiKey;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.model = model;
    this.visionModel = visionModel;
    this.timeoutMs = timeoutMs;
    this.maxContextMessages = maxContextMessages;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async ask({ question, context = [], image = null }) {
    if (!this.configured) {
      throw new DeepSeekError(
        'DEEPSEEK_NOT_CONFIGURED',
        'DeepSeek API Key 尚未配置，请在后端 .env 中填写 DEEPSEEK_API_KEY 后重启服务。',
        { status: 503 },
      );
    }
    if (image && !this.visionModel) {
      throw new DeepSeekError(
        'DEEPSEEK_VISION_NOT_CONFIGURED',
        '图片答疑模型尚未配置，请设置 DEEPSEEK_VISION_MODEL。',
        { status: 503 },
      );
    }

    const userContent = image
      ? [
          { type: 'text', text: question },
          {
            type: 'image_url',
            image_url: {
              url: `data:${image.mimeType};base64,${image.buffer.toString('base64')}`,
              detail: 'high',
            },
          },
        ]
      : question;
    const messages = [
      { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
      ...normalizeContext(context, this.maxContextMessages),
      { role: 'user', content: userContent },
    ];
    const model = image ? this.visionModel : this.model;

    const startedAt = Date.now();
    let lastError;

    // 对网络异常、429 和 5xx 做一次短暂重试；4xx 参数错误不重试。
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const payload = await this._request(messages, model);
        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          throw new DeepSeekError('DEEPSEEK_EMPTY_RESPONSE', 'DeepSeek 返回了空回答，请稍后重试。');
        }
        return {
          answer: content
            .replace(/\r\n/g, '\n')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
            .trim(),
          model: payload.model || model,
          usage: payload.usage ?? null,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof DeepSeekError &&
          (error.code === 'DEEPSEEK_NETWORK_ERROR' ||
            error.code === 'DEEPSEEK_RATE_LIMITED' ||
            error.code === 'DEEPSEEK_UPSTREAM_ERROR');
        if (!retryable || attempt === 1) break;
        await wait(700);
      }
    }

    throw lastError;
  }

  async _request(messages, model = this.model) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          max_tokens: 2400,
          ...(model.includes('reasoner') ? {} : { temperature: 0.25 }),
        }),
        signal: controller.signal,
      });

      const rawText = await response.text();
      let payload = null;
      try {
        payload = rawText ? JSON.parse(rawText) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const detail = upstreamMessage(payload);
        if (response.status === 401 || response.status === 403) {
          throw new DeepSeekError(
            'DEEPSEEK_AUTH_ERROR',
            'DeepSeek API Key 无效或没有访问权限，请检查后端配置。',
            { status: 502, upstreamStatus: response.status },
          );
        }
        if (response.status === 429) {
          throw new DeepSeekError(
            'DEEPSEEK_RATE_LIMITED',
            'DeepSeek 当前请求过于频繁，请稍后再试。',
            { status: 503, upstreamStatus: response.status },
          );
        }
        if (response.status === 402) {
          throw new DeepSeekError(
            'DEEPSEEK_INSUFFICIENT_BALANCE',
            'DeepSeek 账户余额不足，请联系课程管理员。',
            { status: 502, upstreamStatus: response.status },
          );
        }
        throw new DeepSeekError(
          'DEEPSEEK_UPSTREAM_ERROR',
          detail ? `DeepSeek 服务返回错误：${detail}` : 'DeepSeek 服务暂时不可用，请稍后重试。',
          { status: 502, upstreamStatus: response.status },
        );
      }

      if (!payload) {
        throw new DeepSeekError('DEEPSEEK_BAD_RESPONSE', 'DeepSeek 返回内容无法解析，请稍后重试。');
      }
      return payload;
    } catch (error) {
      if (error instanceof DeepSeekError) throw error;
      if (error.name === 'AbortError' || controller.signal.aborted) {
        throw new DeepSeekError(
          'DEEPSEEK_TIMEOUT',
          `DeepSeek 回答超时（${Math.round((Date.now() - startedAt) / 1000)} 秒），请稍后重试。`,
          { status: 504 },
        );
      }
      throw new DeepSeekError(
        'DEEPSEEK_NETWORK_ERROR',
        '无法连接 DeepSeek 服务，请检查服务器网络后重试。',
        { status: 502 },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export { DEFAULT_SYSTEM_PROMPT };
