const api = require('../../utils/api');
const { formatRelativeTime } = require('../../utils/format');
const { setActiveCourse } = require('../../utils/course');

function decorateMessage(item, box) {
  return {
    ...item,
    box,
    read: Boolean(item.read),
    timeText: formatRelativeTime(item.createdAt),
    typeLabel:
      box === 'notice'
        ? item.type === 'resource_updated'
          ? '内容更新'
          : '新内容'
        : item.type === 'teacher_comment'
          ? '教师回复'
          : item.type === 'like_question'
            ? '问题获赞'
            : item.type === 'like_comment'
              ? '评论获赞'
              : '新评论',
  };
}

Page({
  data: {
    box: 'notice',
    summary: { notice: 0, comment: 0, total: 0 },
    messages: [],
    loading: true,
    loadingMore: false,
    hasMore: false,
    loadError: '',
  },

  onLoad() {
    this._loadSeq = 0;
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) {
      tabBar.setSelected(1);
      tabBar.setHidden(false);
    }
    this.loadSummary();
    this.loadMessages({ reset: true });
  },

  onPullDownRefresh() {
    Promise.all([this.loadSummary(), this.loadMessages({ reset: true })]).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) {
      this.loadMessages();
    }
  },

  async loadSummary() {
    try {
      const summary = await api.getMessageSummary();
      this.setData({ summary });
      const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
      if (tabBar) tabBar.setMessageUnread(Number(summary.total) || 0);
    } catch {
      // 消息页本身仍可展示列表。
    }
  },

  async loadMessages(options = {}) {
    const reset = Boolean(options.reset);
    if (!reset && (this.data.loading || this.data.loadingMore)) return;
    const seq = ++this._loadSeq;
    const offset = reset ? 0 : this.data.messages.length;
    this.setData({
      loading: reset && !this.data.messages.length,
      loadingMore: !reset,
      loadError: '',
      ...(reset ? { messages: [] } : {}),
    });
    try {
      const data = await api.getMessages(this.data.box, 30, offset);
      if (seq !== this._loadSeq) return;
      const incoming = (data.items || []).map((item) =>
        decorateMessage(item, this.data.box),
      );
      const messages = reset ? incoming : this.data.messages.concat(incoming);
      this.setData({
        messages,
        loading: false,
        loadingMore: false,
        hasMore: Boolean(data.hasMore),
      });
    } catch (error) {
      if (seq !== this._loadSeq) return;
      this.setData({
        loading: false,
        loadingMore: false,
        loadError: error.message || '消息加载失败，请稍后重试。',
      });
    }
  },

  switchBox(event) {
    const box = event.currentTarget.dataset.box === 'comment' ? 'comment' : 'notice';
    if (box === this.data.box) return;
    this.setData({ box, messages: [], hasMore: false }, () => {
      this.loadMessages({ reset: true });
    });
  },

  async markAllRead() {
    const box = this.data.box;
    try {
      const result = await api.markMessagesRead([], { all: true, box });
      if (result?.summary) this.setData({ summary: result.summary });
      this.setData({
        messages: this.data.messages.map((item) => ({ ...item, read: true })),
      });
      const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
      if (tabBar) tabBar.setMessageUnread(Number(result?.summary?.total) || 0);
      wx.showToast({ title: '已全部标记为已读', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '操作失败', icon: 'none' });
    }
  },

  async openMessage(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.messages.find((message) => message.id === id);
    if (!item) return;

    if (!item.read) {
      this.setData({
        messages: this.data.messages.map((message) =>
          message.id === id ? { ...message, read: true } : message,
        ),
      });
      try {
        const result = await api.markMessagesRead([id], { box: this.data.box });
        if (result?.summary) {
          this.setData({ summary: result.summary });
          const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
          if (tabBar) tabBar.setMessageUnread(Number(result.summary.total) || 0);
        }
      } catch {
        // 已读失败不阻断内容跳转。
      }
    }

    if (item.courseId) {
      setActiveCourse({
        id: item.courseId,
        name: item.courseName,
        courseCode: item.courseCode || '',
      });
    }

    if (item.resourceId) {
      wx.navigateTo({
        url: `/pages/resources/resources?resourceId=${encodeURIComponent(item.resourceId)}`,
      });
      return;
    }
    if (item.questionId) {
      wx.navigateTo({
        url: `/pages/chat/chat?questionId=${encodeURIComponent(item.questionId)}`,
      });
    }
  },

  retry() {
    this.loadMessages({ reset: true });
  },
});
