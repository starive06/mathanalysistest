const api = require('../../utils/api');
const { formatRelativeTime, getAnswerPreview } = require('../../utils/format');

function decorateQuestion(item) {
  const serverAlias = item.alias || '匿名同学';
  const aliasCode = serverAlias.replace(/\s/g, '').slice(-4).toUpperCase();
  return {
    id: item.id,
    alias: '匿名同学',
    avatarText: aliasCode || '匿',
    question: item.question,
    answerPreview: getAnswerPreview(item.answer, 72),
    time: formatRelativeTime(item.createdAt),
    likeCount: item.likeCount || 0,
    likedByMe: Boolean(item.likedByMe),
    commentCount: item.commentCount || 0,
    teacherCommentCount: item.teacherCommentCount || 0,
    imageUrl: api.resolveAssetUrl(item.imagePath),
    hasImage: Boolean(item.imagePath),
  };
}

function decorateComment(comment) {
  return {
    id: comment.id,
    authorType: comment.authorType,
    authorName: comment.authorName || (comment.authorType === 'teacher' ? '课程教师' : '匿名同学'),
    content: comment.content,
    time: formatRelativeTime(comment.createdAt),
    likeCount: comment.likeCount || 0,
    likedByMe: Boolean(comment.likedByMe),
    isTeacher: comment.authorType === 'teacher',
  };
}

Page({
  data: {
    top: [],
    recent: [],
    stats: {
      totalQuestions: 0,
      totalStudents: 0,
      totalLikes: 0,
    },
    loading: true,
    loadingMore: false,
    hasMore: false,
    loadError: '',
    skeletons: [1, 2, 3],
    commentSheetOpen: false,
    commentQuestion: null,
    comments: [],
    commentLoading: false,
    commentError: '',
    commentDraft: '',
    commentSubmitting: false,
  },

  onLoad() {
    this._loadSeq = 0;
    this._liking = {};
  },

  onShow() {
    this.syncTabBar();
    this.loadCommunity({ silent: this.data.top.length + this.data.recent.length > 0 });
  },

  onPullDownRefresh() {
    this.loadCommunity({ fromPull: true });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) {
      this.loadMore();
    }
  },

  async loadCommunity(options) {
    const opts = options || {};
    const seq = ++this._loadSeq;
    const hasContent = this.data.top.length + this.data.recent.length > 0;
    this.setData({
      loading: !hasContent && !opts.silent,
      loadError: '',
    });
    try {
      const data = await api.getCommunity(30, 0);
      if (seq !== this._loadSeq) return;
      this.setData({
        top: (data.top || []).map(decorateQuestion),
        recent: (data.recent || []).map(decorateQuestion),
        stats: data.stats || this.data.stats,
        hasMore: Boolean(data.hasMore),
        loading: false,
        loadingMore: false,
      });
    } catch (error) {
      if (seq !== this._loadSeq) return;
      this.setData({
        loading: false,
        loadError: error.message || '加载失败，请稍后重试。',
      });
      if (hasContent) {
        wx.showToast({ title: error.message || '刷新失败', icon: 'none' });
      }
    } finally {
      if (opts.fromPull) wx.stopPullDownRefresh();
    }
  },

  async loadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    const seq = this._loadSeq;
    this.setData({ loadingMore: true });
    try {
      const data = await api.getCommunity(30, this.data.recent.length);
      if (seq !== this._loadSeq) return;
      const existingIds = new Set(this.data.recent.map((item) => item.id));
      const incoming = (data.recent || [])
        .map(decorateQuestion)
        .filter((item) => !existingIds.has(item.id));
      this.setData({
        top: (data.top || []).map(decorateQuestion),
        recent: this.data.recent.concat(incoming),
        stats: data.stats || this.data.stats,
        hasMore: Boolean(data.hasMore),
        loadingMore: false,
      });
    } catch (error) {
      if (seq !== this._loadSeq) return;
      this.setData({ loadingMore: false });
      wx.showToast({ title: error.message || '加载更多失败', icon: 'none' });
    }
  },

  syncTabBar() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (!tabBar) return;
    tabBar.setSelected(2);
    tabBar.setHidden(false);
  },

  previewQuestionImage(event) {
    const src = event.currentTarget.dataset.src;
    if (!src) return;
    wx.previewImage({ urls: [src], current: src });
  },

  openQuestion(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    getApp().globalData.pendingQuestionId = id;
    wx.switchTab({ url: '/pages/chat/chat' });
  },

  applyLikeState(id, liked, likeCount) {
    const update = (list) =>
      list.map((item) =>
        item.id === id
          ? {
              ...item,
              likedByMe: liked,
              likeCount: Math.max(0, likeCount),
            }
          : item,
      );
    this.setData({
      top: update(this.data.top),
      recent: update(this.data.recent),
    });
  },

  findQuestion(id) {
    return this.data.top.concat(this.data.recent).find((item) => item.id === id);
  },

  updateQuestionCommentCount(id, count, teacherCount) {
    const update = (list) =>
      list.map((item) =>
        item.id === id
          ? {
              ...item,
              commentCount: Math.max(0, count),
              teacherCommentCount: Math.max(0, teacherCount),
            }
          : item,
      );
    this.setData({ top: update(this.data.top), recent: update(this.data.recent) });
  },

  async openComments(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const question = this.findQuestion(id);
    if (!question) return;
    this.setData({
      commentSheetOpen: true,
      commentQuestion: question,
      comments: [],
      commentLoading: true,
      commentError: '',
      commentDraft: '',
    });
    await this.loadComments(id);
  },

  async loadComments(questionId) {
    this.setData({ commentLoading: true, commentError: '' });
    try {
      const data = await api.getQuestionComments(questionId);
      if (!this.data.commentSheetOpen || this.data.commentQuestion?.id !== questionId) return;
      const comments = (data.comments || []).map(decorateComment);
      this.setData({
        comments,
        commentLoading: false,
      });
      this.updateQuestionCommentCount(
        questionId,
        comments.length,
        comments.filter((comment) => comment.isTeacher).length,
      );
    } catch (error) {
      if (!this.data.commentSheetOpen) return;
      this.setData({
        commentLoading: false,
        commentError: error.message || '评论加载失败，请稍后重试。',
      });
    }
  },

  noop() {},

  closeComments() {
    this.setData({
      commentSheetOpen: false,
      commentQuestion: null,
      comments: [],
      commentError: '',
      commentDraft: '',
      commentSubmitting: false,
    });
  },

  onCommentInput(event) {
    this.setData({ commentDraft: event.detail.value });
  },

  async submitComment() {
    const question = this.data.commentQuestion;
    const content = String(this.data.commentDraft || '').trim();
    if (!question || !content || this.data.commentSubmitting) return;
    if (content.length > 1000) {
      wx.showToast({ title: '评论不能超过 1000 字', icon: 'none' });
      return;
    }
    this.setData({ commentSubmitting: true });
    try {
      await api.addQuestionComment(question.id, content);
      this.setData({ commentDraft: '', commentSubmitting: false });
      wx.showToast({ title: '评论已发布', icon: 'none' });
      await this.loadComments(question.id);
    } catch (error) {
      this.setData({ commentSubmitting: false });
      wx.showToast({ title: error.message || '评论失败', icon: 'none' });
    }
  },

  async toggleCommentLike(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this._likingComment?.[id]) return;
    this._likingComment = this._likingComment || {};
    this._likingComment[id] = true;
    try {
      const result = await api.toggleCommentLike(id);
      this.setData({
        comments: this.data.comments.map((comment) =>
          comment.id === id
            ? { ...comment, likedByMe: Boolean(result.liked), likeCount: result.likeCount }
            : comment,
        ),
      });
      wx.vibrateShort({ type: 'light' });
    } catch (error) {
      wx.showToast({ title: error.message || '点赞失败', icon: 'none' });
    } finally {
      delete this._likingComment[id];
    }
  },

  async toggleLike(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this._liking[id]) return;
    const all = this.data.top.concat(this.data.recent);
    const target = all.find((item) => item.id === id);
    if (!target) return;
    this._liking[id] = true;
    const previousLiked = target.likedByMe;
    const previousCount = target.likeCount;
    const optimisticLiked = !previousLiked;
    const optimisticCount = Math.max(0, previousCount + (optimisticLiked ? 1 : -1));
    this.applyLikeState(id, optimisticLiked, optimisticCount);

    try {
      const result = await api.toggleLike(id);
      this.applyLikeState(id, result.liked, result.likeCount);
      wx.vibrateShort({ type: 'light' });
    } catch (error) {
      this.applyLikeState(id, previousLiked, previousCount);
      wx.showToast({
        title: error.message || '操作失败，请稍后重试',
        icon: 'none',
      });
    } finally {
      delete this._liking[id];
    }
  },

  retry() {
    this.loadCommunity({});
  },

  goChat() {
    wx.switchTab({ url: '/pages/chat/chat' });
  },
});
