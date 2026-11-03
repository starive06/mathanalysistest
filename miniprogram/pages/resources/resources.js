const api = require('../../utils/api');
const { formatRelativeTime } = require('../../utils/format');
const { getActiveCourse, requireActiveCourse } = require('../../utils/course');

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function decorateResource(resource) {
  const label = String(resource.fileTypeLabel || resource.extension || 'FILE').toUpperCase();
  let badgeClass = 'other';
  if (label === 'PDF') badgeClass = 'pdf';
  else if (label === 'PPT') badgeClass = 'ppt';
  else if (label === 'WORD') badgeClass = 'word';
  return {
    ...resource,
    fileTypeLabel: label,
    badgeClass,
    sizeText: formatSize(resource.sizeBytes),
    timeText: formatRelativeTime(resource.updatedAt),
  };
}

Page({
  data: {
    resources: [],
    filteredResources: [],
    categories: [],
    activeCategory: '',
    loading: true,
    loadError: '',
    openingId: '',
    skeletons: [1, 2, 3],
    activeCourse: null,
  },

  onLoad(options) {
    this._loadSeq = 0;
    this._pendingResourceId = options?.resourceId || '';
  },

  onShow() {
    const course = requireActiveCourse();
    if (!course) return;
    this.setData({ activeCourse: course });
    this.syncTabBar();
    this.loadResources({ silent: this.data.resources.length > 0 });
  },

  onPullDownRefresh() {
    this.loadResources({ fromPull: true });
  },

  syncTabBar() {
    const tabBar = this.selectComponent('#workspaceTabBar');
    if (tabBar) tabBar.setHidden(false);
  },

  async loadResources(options) {
    const opts = options || {};
    const seq = ++this._loadSeq;
    const hasContent = this.data.resources.length > 0;
    this.setData({
      loading: !hasContent,
      loadError: '',
    });
    try {
      const courseId = this.data.activeCourse?.id || getActiveCourse()?.id || '';
      const data = await api.getResources('', courseId);
      if (seq !== this._loadSeq) return;
      const resources = (data.resources || []).map(decorateResource);
      const categories = Array.isArray(data.categories) ? data.categories : [];
      this.setData(
        {
          resources,
          categories,
          loading: false,
          loadError: '',
        },
        () => {
          this.applyFilter();
          const pendingId = this._pendingResourceId;
          this._pendingResourceId = '';
          if (pendingId) {
            setTimeout(() => {
              this.openResource({ currentTarget: { dataset: { id: pendingId } } });
            }, 250);
          }
        },
      );
    } catch (error) {
      if (seq !== this._loadSeq) return;
      this.setData({
        loading: false,
        loadError: error.message || '资源加载失败，请稍后重试。',
      });
      if (hasContent) {
        wx.showToast({ title: error.message || '刷新失败', icon: 'none' });
      }
    } finally {
      if (opts.fromPull) wx.stopPullDownRefresh();
    }
  },

  applyFilter() {
    const activeCategory = this.data.activeCategory;
    const filtered = activeCategory
      ? this.data.resources.filter((resource) => resource.category === activeCategory)
      : this.data.resources;
    this.setData({ filteredResources: filtered });
  },

  selectCategory(event) {
    const category = event.currentTarget.dataset.category || '';
    if (category === this.data.activeCategory) return;
    this.setData({ activeCategory: category }, () => this.applyFilter());
  },

  async openResource(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.data.openingId) return;
    const resource = this.data.resources.find((item) => item.id === id);
    if (!resource) return;
    this.setData({ openingId: id });
    wx.showLoading({ title: '正在打开', mask: true });
    try {
      const filePath = await api.downloadResourceFile(resource);
      wx.hideLoading();
      wx.openDocument({
        filePath,
        fileType: resource.extension,
        showMenu: true,
        fail() {
          wx.showToast({
            title: '文件打开失败，请稍后重试',
            icon: 'none',
          });
        },
      });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || '资源下载失败',
        icon: 'none',
        duration: 2600,
      });
    } finally {
      this.setData({ openingId: '' });
    }
  },

  retry() {
    this.loadResources({});
  },
});
