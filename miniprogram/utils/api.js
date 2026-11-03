const config = require('../config');
const { getClientId } = require('./client');

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function createRequestError(payload, statusCode) {
  const apiError = payload && payload.error ? payload.error : {};
  const error = new Error(apiError.message || `请求失败（${statusCode || '网络异常'}）`);
  error.code = apiError.code || 'REQUEST_FAILED';
  error.statusCode = statusCode || 0;
  return error;
}

function isSuccess(response) {
  return (
    response &&
    response.statusCode >= 200 &&
    response.statusCode < 300 &&
    response.data &&
    response.data.ok
  );
}

function finishResponse(response, resolve, reject) {
  if (isSuccess(response)) {
    resolve(response.data.data);
    return;
  }
  reject(createRequestError(response && response.data, response && response.statusCode));
}

function cloudRequest(path, options) {
  const opts = options || {};
  if (!config.cloudEnv || /^prod-xxxxxxxx$/.test(config.cloudEnv) || !config.cloudService) {
    return Promise.reject(
      Object.assign(
        new Error('云托管配置未完成，请检查 config.js 的 cloudEnv 和 cloudService。'),
        { code: 'CLOUD_CONFIG_MISSING' },
      ),
    );
  }
  if (!wx.cloud || typeof wx.cloud.callContainer !== 'function') {
    return Promise.reject(
      Object.assign(
        new Error('当前环境不支持 wx.cloud.callContainer，请升级微信基础库或改用 HTTP 模式。'),
        { code: 'CLOUD_UNSUPPORTED' },
      ),
    );
  }

  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: {
        env: config.cloudEnv,
      },
      path,
      method: opts.method || 'GET',
      data: opts.data || {},
      // callContainer 单次请求上限为 15 秒；DeepSeek 等长请求走公网 HTTPS。
      timeout: Math.min(Number(opts.timeout) || config.requestTimeout, 15000),
      header: {
        'content-type': 'application/json',
        'X-WX-SERVICE': config.cloudService,
        'X-Client-Id': getClientId(),
      },
      success(response) {
        finishResponse(response, resolve, reject);
      },
      fail(error) {
        const message =
          error && /timeout/i.test(error.errMsg || '')
            ? '回答超时了，请稍后重试。'
            : '云托管服务调用失败，请检查云环境 ID、服务名称、服务是否部署完成以及公网/内网访问配置。';
        const requestError = new Error(message);
        requestError.code =
          error && /timeout/i.test(error.errMsg || '') ? 'REQUEST_TIMEOUT' : 'CLOUD_ERROR';
        reject(requestError);
      },
    });
  });
}

function httpRequest(path, options, baseUrl) {
  const opts = options || {};
  const targetBaseUrl = normalizeBaseUrl(baseUrl || config.apiBaseUrl);
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${targetBaseUrl}${path}`,
      method: opts.method || 'GET',
      data: opts.data || {},
      timeout: opts.timeout || config.requestTimeout,
      header: {
        'content-type': 'application/json',
        'X-Client-Id': getClientId(),
      },
      success(response) {
        finishResponse(response, resolve, reject);
      },
      fail(error) {
        const message =
          error && /timeout/i.test(error.errMsg || '')
            ? '回答超时了，请稍后重试。'
            : '连接答疑服务失败，请确认后端地址、云托管公网域名和网络是否正常。';
        const requestError = new Error(message);
        requestError.code =
          error && /timeout/i.test(error.errMsg || '') ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
        reject(requestError);
      },
    });
  });
}

function publicCloudRequest(path, options) {
  if (!config.cloudPublicBaseUrl) {
    return Promise.reject(
      Object.assign(
        new Error(
          '云托管长请求需要在 config.js 配置 cloudPublicBaseUrl（云托管公网 HTTPS 域名）。',
        ),
        { code: 'CLOUD_PUBLIC_URL_MISSING' },
      ),
    );
  }
  return httpRequest(path, options, config.cloudPublicBaseUrl);
}

function request(path, options) {
  const opts = options || {};
  if (config.transport === 'cloud') {
    if (opts.usePublic) return publicCloudRequest(path, opts);
    return cloudRequest(path, opts);
  }
  return httpRequest(path, opts);
}

function askQuestion(question, context, courseId) {
  return request('/api/questions', {
    method: 'POST',
    data: {
      question,
      context: context || [],
      courseId: courseId || '',
    },
    timeout: Math.min(config.requestTimeout, 60000),
    // callContainer 最长 15 秒，问答必须走公网域名。
    usePublic: true,
  });
}

function askQuestionWithImage(question, context, filePath, courseId) {
  const baseUrl =
    config.transport === 'cloud'
      ? normalizeBaseUrl(config.cloudPublicBaseUrl)
      : normalizeBaseUrl(config.apiBaseUrl);
  if (!baseUrl || !filePath) {
    return Promise.reject(
      new Error(
        config.transport === 'cloud'
          ? '云托管图片提问需要配置 cloudPublicBaseUrl，并把该域名加入 uploadFile 合法域名。'
          : '图片上传地址未配置。',
      ),
    );
  }
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${baseUrl}/api/questions`,
      filePath,
      name: 'image',
      formData: {
        question,
        context: JSON.stringify(context || []),
        courseId: courseId || '',
      },
      timeout: Math.min(config.requestTimeout, 60000),
      header: {
        'X-Client-Id': getClientId(),
      },
      success(response) {
        let payload = null;
        try {
          payload = JSON.parse(response.data || '{}');
        } catch {
          payload = null;
        }
        if (response.statusCode >= 200 && response.statusCode < 300 && payload?.ok) {
          resolve(payload.data);
          return;
        }
        reject(createRequestError(payload, response.statusCode));
      },
      fail(error) {
        const message =
          error && /timeout/i.test(error.errMsg || '')
            ? '图片上传或回答超时，请稍后重试。'
            : '图片上传失败，请检查网络、上传域名和后端服务。';
        const requestError = new Error(message);
        requestError.code = 'IMAGE_UPLOAD_FAILED';
        reject(requestError);
      },
    });
  });
}

function resolveAssetUrl(path) {
  const value = String(path || '');
  if (!value) return '';
  if (/^https?:\/\//.test(value) || value.startsWith('wxfile://')) return value;
  const base =
    config.transport === 'cloud'
      ? normalizeBaseUrl(config.cloudPublicBaseUrl)
      : normalizeBaseUrl(config.apiBaseUrl);
  return base ? `${base}${value}` : value;
}

function getMyQuestions(limit, offset, courseId) {
  return request(
    `/api/questions/mine?limit=${encodeURIComponent(limit || 30)}&offset=${encodeURIComponent(
      offset || 0,
    )}&courseId=${encodeURIComponent(courseId || '')}`,
  );
}

function getQuestion(id) {
  return request(`/api/questions/${encodeURIComponent(id)}`);
}

function toggleLike(id) {
  return request(`/api/questions/${encodeURIComponent(id)}/like`, {
    method: 'POST',
  });
}

function getCommunity(limit, offset, courseId) {
  return request(
    `/api/community?limit=${encodeURIComponent(limit || 30)}&offset=${encodeURIComponent(
      offset || 0,
    )}&courseId=${encodeURIComponent(courseId || '')}`,
  );
}

function getHealth() {
  return request('/api/health', { timeout: 10000 });
}

function bindWeChatIdentity(code) {
  return request('/api/identity/bind', {
    method: 'POST',
    data: { code },
    timeout: 15000,
  });
}

function getQuestionComments(questionId) {
  return request(`/api/questions/${encodeURIComponent(questionId)}/comments`);
}

function addQuestionComment(questionId, content) {
  return request(`/api/questions/${encodeURIComponent(questionId)}/comments`, {
    method: 'POST',
    data: { content },
    timeout: 15000,
  });
}

function toggleCommentLike(commentId) {
  return request(`/api/comments/${encodeURIComponent(commentId)}/like`, {
    method: 'POST',
    timeout: 15000,
  });
}

function getResources(category, courseId) {
  const params = [];
  if (category) params.push(`category=${encodeURIComponent(category)}`);
  if (courseId) params.push(`courseId=${encodeURIComponent(courseId)}`);
  const suffix = params.length ? `?${params.join('&')}` : '';
  return request(`/api/resources${suffix}`);
}

function getCourses() {
  return request('/api/courses');
}

function getMessageSummary() {
  return request('/api/messages/summary', { timeout: 15000 });
}

function getMessages(box, limit, offset) {
  return request(
    `/api/messages?box=${encodeURIComponent(box || 'notice')}&limit=${encodeURIComponent(
      limit || 30,
    )}&offset=${encodeURIComponent(offset || 0)}`,
    { timeout: 15000 },
  );
}

function markMessagesRead(ids, options) {
  return request('/api/messages/read', {
    method: 'POST',
    data: {
      ids: ids || [],
      box: options?.box || '',
      all: Boolean(options?.all),
    },
    timeout: 15000,
  });
}

function downloadFileFrom(baseUrl, filePath) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${normalizeBaseUrl(baseUrl)}${filePath}`,
      timeout: Math.min(config.requestTimeout, 60000),
      header: {
        'X-Client-Id': getClientId(),
      },
      success(response) {
        if (response.statusCode === 200) {
          resolve(response.tempFilePath);
          return;
        }
        reject(new Error(`资源下载失败（HTTP ${response.statusCode}）`));
      },
      fail() {
        reject(
          new Error(
            '资源下载失败。请检查后端地址、downloadFile 合法域名和网络。',
          ),
        );
      },
    });
  });
}

function downloadResourceFile(resource) {
  const filePath = `/api/resources/${encodeURIComponent(resource.id)}/file`;
  if (config.transport === 'cloud' && config.cloudPublicBaseUrl) {
    return downloadFileFrom(config.cloudPublicBaseUrl, filePath);
  }
  if (config.transport === 'cloud') {
    if (!wx.cloud || typeof wx.cloud.callContainer !== 'function') {
      return Promise.reject(
        Object.assign(new Error('当前环境不支持云托管文件下载。'), {
          code: 'CLOUD_UNSUPPORTED',
        }),
      );
    }
    return new Promise((resolve, reject) => {
      wx.cloud.callContainer({
        config: { env: config.cloudEnv },
        path: filePath,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: Math.min(config.requestTimeout, 15000),
        header: {
          'X-WX-SERVICE': config.cloudService,
          'X-Client-Id': getClientId(),
        },
        success(response) {
          if (response.statusCode !== 200) {
            reject(new Error(`资源下载失败（HTTP ${response.statusCode}）`));
            return;
          }
          const targetPath = `${wx.env.USER_DATA_PATH}/resource-${resource.id}.${resource.extension}`;
          wx.getFileSystemManager().writeFile({
            filePath: targetPath,
            data: response.data,
            success: () => resolve(targetPath),
            fail: () => reject(new Error('资源文件写入本地失败，请重试。')),
          });
        },
        fail() {
          reject(
            new Error(
              '云托管资源下载失败，请检查服务名称、云环境以及资源文件是否存在。',
            ),
          );
        },
      });
    });
  }

  return downloadFileFrom(config.apiBaseUrl, filePath);
}

module.exports = {
  askQuestion,
  askQuestionWithImage,
  resolveAssetUrl,
  getMyQuestions,
  getQuestion,
  toggleLike,
  getCommunity,
  getHealth,
  bindWeChatIdentity,
  getQuestionComments,
  addQuestionComment,
  toggleCommentLike,
  getResources,
  downloadResourceFile,
  getCourses,
  getMessageSummary,
  getMessages,
  markMessagesRead,
};
