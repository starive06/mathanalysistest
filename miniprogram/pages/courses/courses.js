const api = require('../../utils/api');
const {
  getActiveCourse,
  setActiveCourse,
} = require('../../utils/course');

function decorateCourse(course) {
  return {
    ...course,
    initial: String(course.name || '课').slice(0, 1),
    colorIndex: Math.abs(Number(course.colorIndex) || 0) % 6,
    teacherText: course.teacherName || '课程教师',
    codeText: course.courseCode || '未设置课程编号',
    metaText: [course.term, course.questionCount ? `${course.questionCount} 个问题` : '']
      .filter(Boolean)
      .join(' · '),
  };
}

Page({
  data: {
    courses: [],
    loading: true,
    loadError: '',
    activeCourseId: '',
    messageUnread: 0,
    skeletons: [1, 2, 3, 4],
  },

  onLoad() {
    this._loadSeq = 0;
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) {
      tabBar.setSelected(0);
      tabBar.setHidden(false);
    }
    const active = getActiveCourse();
    this.setData({ activeCourseId: active?.id || '' });
    this.loadCourses();
    this.loadSummary();
  },

  onPullDownRefresh() {
    Promise.all([this.loadCourses(), this.loadSummary()]).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadCourses() {
    const seq = ++this._loadSeq;
    const hasCourses = this.data.courses.length > 0;
    this.setData({ loading: !hasCourses, loadError: '' });
    try {
      const data = await api.getCourses();
      if (seq !== this._loadSeq) return;
      this.setData({
        courses: (data.courses || []).map(decorateCourse),
        loading: false,
      });
    } catch (error) {
      if (seq !== this._loadSeq) return;
      this.setData({
        loading: false,
        loadError: error.message || '课程加载失败，请稍后重试。',
      });
    }
  },

  async loadSummary() {
    try {
      const summary = await api.getMessageSummary();
      const unread = Number(summary.total) || 0;
      this.setData({ messageUnread: unread });
      const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
      if (tabBar) tabBar.setMessageUnread(unread);
    } catch {
      this.setData({ messageUnread: 0 });
    }
  },

  enterCourse(event) {
    const id = event.currentTarget.dataset.id;
    const course = this.data.courses.find((item) => item.id === id);
    if (!course) return;
    setActiveCourse(course);
    this.setData({ activeCourseId: course.id });
    wx.navigateTo({ url: '/pages/chat/chat' });
  },

  goMessages() {
    wx.switchTab({ url: '/pages/messages/messages' });
  },

  retry() {
    this.loadCourses();
  },
});
