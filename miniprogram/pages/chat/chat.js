const api = require('../../utils/api');
const { formatClock } = require('../../utils/format');

const SUGGESTIONS = [
  {
    tag: '极限',
    title: '为什么 sin x / x 的极限是 1？',
    desc: '从几何直观到严格证明',
    question: '请解释为什么 lim(x→0) sin x / x = 1，并说明证明中每一步的依据。',
  },
  {
    tag: '概念辨析',
    title: '一致连续和连续有什么区别？',
    desc: '用反例真正理解 δ 与 x 的关系',
    question: '请解释函数的一致连续与连续有什么区别，并举一个在某个区间上连续但不一致连续的例子。',
  },
  {
    tag: '级数',
    title: '∑ 1/n² 为什么收敛？',
    desc: '比较判别法与 p 级数',
    question: '请判断级数 ∑(n=1→∞) 1/n² 的敛散性，并写出主要的判别过程。',
  },
];

function buildContext(messages) {
  const usable = messages.filter((message) => !message.isError);
  let lastAssistantIndex = -1;
  usable.forEach((message, index) => {
    if (message.role === 'assistant') lastAssistantIndex = index;
  });
  if (lastAssistantIndex < 0) return [];
  return usable
    .slice(0, lastAssistantIndex + 1)
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 3500),
    }));
}

Page({
  data: {
    messages: [],
    suggestions: SUGGESTIONS,
    inputValue: '',
    canSend: false,
    loading: false,
    loadingRecord: false,
    viewingRecord: false,
    dayLabel: '今天',
    scrollIntoView: '',
    lastFailedQuestion: '',
    lastFailedImage: '',
    selectedImagePath: '',
    selectedImageName: '',
    selectedImageSizeText: '',
    maxLength: 2000,
    keyboardOpen: false,
    inputFocused: false,
    apiStatus: 'checking',
    apiStatusText: '正在连接 DeepSeek',
  },

  onLoad() {
    this._requestSeq = 0;
    this.checkService();
  },

  onShow() {
    this.syncTabBar();
    const app = getApp();
    const pendingId = app.globalData.pendingQuestionId;
    if (pendingId) {
      app.globalData.pendingQuestionId = null;
      this.loadRecord(pendingId);
    }
  },

  onHide() {
    wx.hideKeyboard();
    this.setTabBarHidden(false);
    this.setData({ keyboardOpen: false, inputFocused: false });
  },

  onUnload() {
    this._requestSeq += 1;
    wx.hideLoading();
  },

  syncTabBar() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (!tabBar) return;
    tabBar.setSelected(0);
    tabBar.setHidden(false);
  },

  setTabBarHidden(hidden) {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) tabBar.setHidden(hidden);
  },

  async checkService() {
    try {
      const data = await api.getHealth();
      if (data.deepseekConfigured) {
        this.setData({
          apiStatus: 'online',
          apiStatusText: `DeepSeek 在线 · ${data.model || 'deepseek-chat'}`,
        });
      } else {
        this.setData({
          apiStatus: 'warning',
          apiStatusText: 'DeepSeek 尚未配置',
        });
      }
    } catch (error) {
      this.setData({
        apiStatus: 'offline',
        apiStatusText: '答疑服务未连接',
      });
    }
  },

  async loadRecord(id) {
    const seq = ++this._requestSeq;
    wx.hideKeyboard();
    this.setTabBarHidden(false);
    this.setData({
      loadingRecord: true,
      loading: false,
      lastFailedQuestion: '',
      lastFailedImage: '',
      selectedImagePath: '',
      selectedImageName: '',
      selectedImageSizeText: '',
      canSend: false,
      keyboardOpen: false,
      inputFocused: false,
    });
    wx.showLoading({ title: '加载提问', mask: true });
    try {
      const record = await api.getQuestion(id);
      if (seq !== this._requestSeq) return;
      const time = formatClock(record.createdAt);
      const messages = [
        {
          id: `record-user-${record.id}`,
          role: 'user',
          content: record.question,
          imagePath: record.imagePath || '',
          imageUrl: api.resolveAssetUrl(record.imagePath),
          time,
          isError: false,
        },
        {
          id: `record-ai-${record.id}`,
          role: 'assistant',
          content: record.answer,
          time,
          isError: false,
        },
      ];
      this.setData(
        {
          messages,
          viewingRecord: true,
          loadingRecord: false,
          inputValue: '',
          canSend: false,
        },
        () => this.scrollToBottom(),
      );
    } catch (error) {
      if (seq !== this._requestSeq) return;
      this.setData({ loadingRecord: false });
      wx.showToast({
        title: error.message || '加载失败',
        icon: 'none',
        duration: 2600,
      });
    } finally {
      wx.hideLoading();
    }
  },

  onInput(event) {
    const value = event.detail.value;
    this.setData({
      inputValue: value,
      canSend:
        Boolean(value.trim() || this.data.selectedImagePath) &&
        !this.data.loading &&
        !this.data.loadingRecord,
    });
  },

  formatImageSize(size) {
    const value = Number(size || 0);
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  },

  chooseImage() {
    if (this.data.loading || this.data.loadingRecord) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (result) => {
        const file = result.tempFiles?.[0];
        if (!file?.tempFilePath) return;
        if (Number(file.size || 0) > 8 * 1024 * 1024) {
          wx.showToast({
            title: '图片不能超过 8 MB，请压缩后重试',
            icon: 'none',
          });
          return;
        }
        this.setData({
          selectedImagePath: file.tempFilePath,
          selectedImageName: file.tempFilePath.split('/').pop() || '题目图片',
          selectedImageSizeText: this.formatImageSize(file.size),
          canSend: !this.data.loading && !this.data.loadingRecord,
        });
      },
      fail: (error) => {
        if (error?.errMsg && !/cancel/i.test(error.errMsg)) {
          wx.showToast({ title: '选择图片失败', icon: 'none' });
        }
      },
    });
  },

  removeImage() {
    this.setData({
      selectedImagePath: '',
      selectedImageName: '',
      selectedImageSizeText: '',
      canSend: Boolean(this.data.inputValue.trim()) && !this.data.loading,
    });
  },

  previewSelectedImage() {
    if (!this.data.selectedImagePath) return;
    wx.previewImage({
      urls: [this.data.selectedImagePath],
      current: this.data.selectedImagePath,
    });
  },

  previewMessageImage(event) {
    const src = event.currentTarget.dataset.src;
    if (!src) return;
    wx.previewImage({ urls: [src], current: src });
  },

  onInputFocus() {
    this.setData({ inputFocused: true, keyboardOpen: true });
    this.setTabBarHidden(true);
    setTimeout(() => this.scrollToBottom(), 250);
  },

  onInputBlur() {
    this.setData({ inputFocused: false, keyboardOpen: false });
    this.setTabBarHidden(false);
  },

  useSuggestion(event) {
    if (this.data.loading || this.data.loadingRecord) return;
    const question = event.currentTarget.dataset.question;
    if (!question) return;
    this.setData(
      {
        inputValue: question,
        selectedImagePath: '',
        selectedImageName: '',
        selectedImageSizeText: '',
        canSend: true,
      },
      () => this.sendCurrentQuestion(),
    );
  },

  onSend() {
    this.sendCurrentQuestion();
  },

  sendCurrentQuestion() {
    const text = String(this.data.inputValue || '').trim();
    const imagePath = this.data.selectedImagePath;
    if ((!text && !imagePath) || this.data.loading || this.data.loadingRecord) return;
    const question = text || '请分析这张图片中的数学问题。';
    if (question.length < 2) {
      wx.showToast({ title: '请补充完整问题', icon: 'none' });
      return;
    }
    const context = buildContext(this.data.messages);
    wx.hideKeyboard();
    this.setData({
      inputValue: '',
      selectedImagePath: '',
      selectedImageName: '',
      selectedImageSizeText: '',
      canSend: false,
      inputFocused: false,
      keyboardOpen: false,
    });
    this.setTabBarHidden(false);
    this.submitQuestion(question, {
      appendUser: true,
      context,
      imagePath,
    });
  },

  retryLast() {
    const question = this.data.lastFailedQuestion;
    const imagePath = this.data.lastFailedImage;
    if ((!question && !imagePath) || this.data.loading || this.data.loadingRecord) return;
    const messages = this.data.messages.filter((message) => !message.isError);
    const context = buildContext(messages);
    this.setData({
      messages,
      lastFailedQuestion: '',
      lastFailedImage: '',
      canSend: false,
    });
    this.submitQuestion(question || '请分析这张图片中的数学问题。', {
      appendUser: false,
      context,
      baseMessages: messages,
      imagePath,
    });
  },

  async submitQuestion(question, options) {
    const seq = ++this._requestSeq;
    const baseMessages = options.baseMessages || this.data.messages;
    const imagePath = options.imagePath || '';
    const userMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: question,
      imagePath,
      imageUrl: imagePath,
      time: formatClock(new Date()),
      isError: false,
    };
    const messages = options.appendUser ? baseMessages.concat(userMessage) : baseMessages;
    this.setData(
      {
        messages,
        loading: true,
        canSend: false,
        lastFailedQuestion: '',
        lastFailedImage: '',
      },
      () => this.scrollToBottom(),
    );

    try {
      const record = imagePath
        ? await api.askQuestionWithImage(question, options.context, imagePath)
        : await api.askQuestion(question, options.context);
      if (seq !== this._requestSeq) return;
      const assistantMessage = {
        id: `answer-${record.id}`,
        role: 'assistant',
        content: record.answer,
        time: formatClock(record.createdAt || new Date()),
        isError: false,
      };
      this.setData(
        {
          messages: messages.concat(assistantMessage),
          loading: false,
          canSend: Boolean(this.data.inputValue.trim() || this.data.selectedImagePath),
        },
        () => this.scrollToBottom(),
      );
      wx.vibrateShort({ type: 'light' });
    } catch (error) {
      if (seq !== this._requestSeq) return;
      const errorMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: error.message || '回答失败，请稍后重试。',
        time: formatClock(new Date()),
        isError: true,
      };
      this.setData(
        {
          messages: messages.concat(errorMessage),
          loading: false,
          lastFailedQuestion: question,
          lastFailedImage: imagePath,
          canSend: Boolean(this.data.inputValue.trim() || this.data.selectedImagePath),
        },
        () => this.scrollToBottom(),
      );
    }
  },

  copyMessage(event) {
    const index = Number(event.currentTarget.dataset.index);
    const message = this.data.messages[index];
    if (!message || message.isError) return;
    wx.setClipboardData({
      data: message.content,
      success() {
        wx.showToast({ title: '已复制', icon: 'none' });
      },
    });
  },

  startNew() {
    this._requestSeq += 1;
    wx.hideKeyboard();
    this.setTabBarHidden(false);
    this.setData({
      messages: [],
      viewingRecord: false,
      dayLabel: '今天',
      lastFailedQuestion: '',
      lastFailedImage: '',
      selectedImagePath: '',
      selectedImageName: '',
      selectedImageSizeText: '',
      loading: false,
      loadingRecord: false,
      scrollIntoView: '',
      inputValue: '',
      canSend: false,
      keyboardOpen: false,
      inputFocused: false,
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  scrollToBottom() {
    const messages = this.data.messages;
    const target = this.data.loading || !messages.length
      ? 'bottom-anchor'
      : `msg-${messages[messages.length - 1].id}`;
    this.setData({ scrollIntoView: '' }, () => {
      const apply = () => this.setData({ scrollIntoView: target });
      if (typeof wx.nextTick === 'function') wx.nextTick(apply);
      else setTimeout(apply, 30);
    });
  },
});
