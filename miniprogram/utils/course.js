const STORAGE_KEY = 'mathTutorActiveCourse';

function getActiveCourse() {
  const app = typeof getApp === 'function' ? getApp() : null;
  if (app?.globalData?.activeCourse) return app.globalData.activeCourse;
  try {
    const stored = wx.getStorageSync(STORAGE_KEY);
    if (stored && stored.id) {
      if (app) app.globalData.activeCourse = stored;
      return stored;
    }
  } catch {
    // 本地存储不可用时按未选课程处理。
  }
  return null;
}

function setActiveCourse(course) {
  if (!course?.id) return null;
  const value = {
    id: course.id,
    name: course.name || '课程',
    teacherName: course.teacherName || '',
    courseCode: course.courseCode || '',
    term: course.term || '',
    colorIndex: Number(course.colorIndex) || 0,
  };
  try {
    wx.setStorageSync(STORAGE_KEY, value);
  } catch {
    // 仍写入 globalData，保证当前会话可用。
  }
  const app = typeof getApp === 'function' ? getApp() : null;
  if (app) app.globalData.activeCourse = value;
  return value;
}

function clearActiveCourse() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch {
    // ignore
  }
  const app = typeof getApp === 'function' ? getApp() : null;
  if (app) app.globalData.activeCourse = null;
}

function getActiveCourseId() {
  return getActiveCourse()?.id || '';
}

function goToCourses() {
  wx.switchTab({ url: '/pages/courses/courses' });
}

function requireActiveCourse(options = {}) {
  const course = getActiveCourse();
  if (course?.id) return course;
  if (options.redirect !== false) {
    wx.showToast({ title: '请先选择一门课程', icon: 'none' });
    setTimeout(goToCourses, 350);
  }
  return null;
}

module.exports = {
  STORAGE_KEY,
  getActiveCourse,
  setActiveCourse,
  clearActiveCourse,
  getActiveCourseId,
  goToCourses,
  requireActiveCourse,
};
