Component({
  data: {
    selected: 0,
    hidden: false,
    messageUnread: 0,
    list: [
      {
        pagePath: '/pages/courses/courses',
        text: '课堂',
        iconPath: '/assets/tabbar/class-normal.png',
        selectedIconPath: '/assets/tabbar/class-active.png',
      },
      {
        pagePath: '/pages/messages/messages',
        text: '消息',
        iconPath: '/assets/tabbar/message-normal.png',
        selectedIconPath: '/assets/tabbar/message-active.png',
      },
    ],
  },

  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const target = this.data.list[index];
      if (!target || index === this.data.selected) return;
      this.setData({ selected: index });
      wx.switchTab({
        url: target.pagePath,
      });
    },

    setSelected(index) {
      if (this.data.selected !== index) this.setData({ selected: index });
    },

    setHidden(hidden) {
      if (this.data.hidden !== hidden) this.setData({ hidden });
    },

    setMessageUnread(count) {
      const value = Math.max(0, Number(count) || 0);
      if (this.data.messageUnread !== value) this.setData({ messageUnread: value });
    },
  },
});
