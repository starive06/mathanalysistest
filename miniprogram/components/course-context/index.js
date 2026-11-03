const api = require('../../utils/api');

Component({
  properties: {
    course: {
      type: Object,
      value: null,
    },
  },

  data: {
    unread: 0,
  },

  lifetimes: {
    attached() {
      this.loadUnread();
    },
  },

  pageLifetimes: {
    show() {
      this.loadUnread();
    },
  },

  methods: {
    async loadUnread() {
      try {
        const summary = await api.getMessageSummary();
        this.setData({ unread: Number(summary.total) || 0 });
      } catch {
        this.setData({ unread: 0 });
      }
    },

    goCourses() {
      wx.switchTab({ url: '/pages/courses/courses' });
    },

    goMessages() {
      wx.switchTab({ url: '/pages/messages/messages' });
    },
  },
});
