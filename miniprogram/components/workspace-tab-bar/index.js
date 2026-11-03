Component({
  properties: {
    selected: {
      type: Number,
      value: 0,
    },
  },

  data: {
    hidden: false,
    list: [
      {
        pagePath: '/pages/chat/chat',
        text: '答疑',
        iconPath: '/assets/tabbar/chat-normal.png',
        selectedIconPath: '/assets/tabbar/chat-active.png',
      },
      {
        pagePath: '/pages/history/history',
        text: '我的',
        iconPath: '/assets/tabbar/history-normal.png',
        selectedIconPath: '/assets/tabbar/history-active.png',
      },
      {
        pagePath: '/pages/community/community',
        text: '同学圈',
        iconPath: '/assets/tabbar/community-normal.png',
        selectedIconPath: '/assets/tabbar/community-active.png',
      },
      {
        pagePath: '/pages/resources/resources',
        text: '资源',
        iconPath: '/assets/tabbar/resources-normal.png',
        selectedIconPath: '/assets/tabbar/resources-active.png',
      },
    ],
  },

  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const target = this.data.list[index];
      if (!target || index === this.data.selected) return;
      wx.redirectTo({ url: target.pagePath });
    },

    setHidden(hidden) {
      if (this.data.hidden !== hidden) this.setData({ hidden });
    },
  },
});
