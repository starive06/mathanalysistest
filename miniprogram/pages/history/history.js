const api = require('../../utils/api');
const { formatListTime, getAnswerPreview } = require('../../utils/format');

const PAGE_SIZE = 30;

Page({
  data: {
    questions: [],
    total: 0,
    loading: true,
    loadingMore: false,
    hasMore: false,
    loadError: '',
    skeletons: [1, 2, 3],
  },

  onLoad() {
    this._loadSeq = 0;
  },

  onShow() {
    this.syncTabBar();
    this.loadQuestions({ reset: true });
  },

  onPullDownRefresh() {
    this.loadQuestions({ reset: true, fromPull: true });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) {
      this.loadQuestions();
    }
  },

  syncTabBar() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (!tabBar) return;
    tabBar.setSelected(1);
    tabBar.setHidden(false);
  },

  async loadQuestions(options) {
    const opts = options || {};
    const reset = Boolean(opts.reset);
    if (!reset && (this.data.loading || this.data.loadingMore)) return;
    const seq = ++this._loadSeq;
    const offset = reset ? 0 : this.data.questions.length;
    const showSkeleton = reset && this.data.questions.length === 0;

    this.setData({
      loading: reset ? showSkeleton : this.data.loading,
      loadingMore: !reset,
      loadError: '',
      ...(showSkeleton ? { questions: [] } : {}),
    });

    try {
      const data = await api.getMyQuestions(PAGE_SIZE, offset);
      if (seq !== this._loadSeq) return;
      const incoming = (data.items || []).map((item) => ({
        id: item.id,
        question: item.question,
        answerPreview: getAnswerPreview(item.answer, 88),
        time: formatListTime(item.createdAt),
        likeCount: item.likeCount || 0,
        imageUrl: api.resolveAssetUrl(item.imagePath),
        hasImage: Boolean(item.imagePath),
        teacherComments: (item.teacherComments || []).map((comment) => ({
          id: comment.id,
          authorName: comment.authorName || '课程教师',
          content: comment.content,
          time: formatListTime(comment.createdAt),
        })),
      }));
      const list = reset ? incoming : this.data.questions.concat(incoming);
      this.setData({
        questions: list,
        total: data.total || list.length,
        hasMore: list.length < (data.total || 0),
        loading: false,
        loadingMore: false,
      });
    } catch (error) {
      if (seq !== this._loadSeq) return;
      this.setData({
        loading: false,
        loadingMore: false,
        loadError: error.message || '加载失败，请稍后重试。',
      });
      if (this.data.questions.length) {
        wx.showToast({ title: error.message || '刷新失败', icon: 'none' });
      }
    } finally {
      if (opts.fromPull) wx.stopPullDownRefresh();
    }
  },

  openQuestion(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    getApp().globalData.pendingQuestionId = id;
    wx.switchTab({ url: '/pages/chat/chat' });
  },

  goChat() {
    wx.switchTab({ url: '/pages/chat/chat' });
  },

  retry() {
    this.loadQuestions({ reset: true });
  },
});
