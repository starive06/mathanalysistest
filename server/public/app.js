(() => {
  'use strict';

  const TOKEN_KEY = 'mathTutorAdminToken';
  const elements = {
    loginScreen: document.getElementById('login-screen'),
    app: document.getElementById('app'),
    emailLoginForm: document.getElementById('email-login-form'),
    emailLogin: document.getElementById('login-email'),
    emailPassword: document.getElementById('login-password'),
    emailLoginError: document.getElementById('login-error'),
    emailLoginSubmit: document.getElementById('email-login-submit'),
    legacyLoginForm: document.getElementById('legacy-login-form'),
    legacyToken: document.getElementById('admin-token'),
    legacyError: document.getElementById('legacy-login-error'),
    legacyLoginSubmit: document.getElementById('legacy-login-submit'),
    authTabs: [...document.querySelectorAll('.login-tab')],
    showRegister: document.getElementById('show-register'),
    backToLogin: document.getElementById('back-to-login'),
    registerForm: document.getElementById('register-form'),
    registerEmail: document.getElementById('register-email'),
    registerName: document.getElementById('register-name'),
    registerPublicId: document.getElementById('register-public-id'),
    registerPassword: document.getElementById('register-password'),
    registerCode: document.getElementById('register-code'),
    registerError: document.getElementById('register-error'),
    registerSubmit: document.getElementById('register-submit'),
    togglePassword: document.getElementById('toggle-password'),
    profileButton: document.getElementById('profile-button'),
    teacherAvatar: document.getElementById('teacher-avatar'),
    teacherName: document.getElementById('teacher-name'),
    teacherPublicId: document.getElementById('teacher-public-id'),
    profileBackdrop: document.getElementById('profile-backdrop'),
    profileModal: document.getElementById('profile-modal'),
    profileClose: document.getElementById('profile-close'),
    profileAvatar: document.getElementById('profile-avatar'),
    profileSummaryName: document.getElementById('profile-summary-name'),
    profileSummaryEmail: document.getElementById('profile-summary-email'),
    profileMode: document.getElementById('profile-mode'),
    profileForm: document.getElementById('profile-form'),
    profileName: document.getElementById('profile-name'),
    profilePublicId: document.getElementById('profile-public-id'),
    profileEmail: document.getElementById('profile-email'),
    profileCurrentPassword: document.getElementById('profile-current-password'),
    profileError: document.getElementById('profile-error'),
    profileSave: document.getElementById('profile-save'),
    passwordForm: document.getElementById('password-form'),
    passwordCurrent: document.getElementById('password-current'),
    passwordNew: document.getElementById('password-new'),
    passwordConfirm: document.getElementById('password-confirm'),
    passwordError: document.getElementById('password-error'),
    passwordSave: document.getElementById('password-save'),
    profileLegacyNote: document.getElementById('profile-legacy-note'),
    courseTrigger: document.getElementById('course-trigger'),
    courseMenu: document.getElementById('course-menu'),
    currentCourseName: document.getElementById('current-course-name'),
    courseBackdrop: document.getElementById('course-backdrop'),
    courseModal: document.getElementById('course-modal'),
    courseModalClose: document.getElementById('course-modal-close'),
    courseManageList: document.getElementById('course-manage-list'),
    courseForm: document.getElementById('course-form'),
    courseFormTitle: document.getElementById('course-form-title'),
    courseName: document.getElementById('course-name'),
    courseTeacher: document.getElementById('course-teacher'),
    courseCode: document.getElementById('course-code'),
    courseTerm: document.getElementById('course-term'),
    courseColor: document.getElementById('course-color'),
    courseError: document.getElementById('course-error'),
    courseEditId: document.getElementById('course-edit-id'),
    courseSave: document.getElementById('course-save'),
    logoutButton: document.getElementById('logout-button'),
    refreshButton: document.getElementById('refresh-button'),
    backupButton: document.getElementById('backup-button'),
    backupIndicator: document.getElementById('backup-indicator'),
    backupState: document.getElementById('backup-state'),
    backupStateText: document.getElementById('backup-state-text'),
    storageLabel: document.getElementById('storage-label'),
    deepseekStatus: document.getElementById('deepseek-status'),
    pageSubtitle: document.getElementById('page-subtitle'),
    statTotal: document.getElementById('stat-total'),
    statStudents: document.getElementById('stat-students'),
    statLikes: document.getElementById('stat-likes'),
    statToday: document.getElementById('stat-today'),
    statTotalNote: document.getElementById('stat-total-note'),
    statTodayNote: document.getElementById('stat-today-note'),
    searchInput: document.getElementById('search-input'),
    filterTabs: [...document.querySelectorAll('.filter-tab')],
    resultCount: document.getElementById('result-count'),
    selectionBar: document.getElementById('selection-bar'),
    selectedCount: document.getElementById('selected-count'),
    clearSelection: document.getElementById('clear-selection'),
    selectAll: document.getElementById('select-all'),
    questionRows: document.getElementById('question-rows'),
    questionTable: document.querySelector('.question-table'),
    tableLoading: document.getElementById('table-loading'),
    emptyState: document.getElementById('empty-state'),
    emptyTitle: document.getElementById('empty-title'),
    emptyCopy: document.getElementById('empty-copy'),
    emptyReset: document.getElementById('empty-reset'),
    footerCount: document.getElementById('footer-count'),
    lastRefresh: document.getElementById('last-refresh'),
    exportMd: document.getElementById('export-md'),
    exportDocx: document.getElementById('export-docx'),
    exportMdLabel: document.getElementById('export-md-label'),
    exportDocxLabel: document.getElementById('export-docx-label'),
    drawer: document.getElementById('drawer'),
    drawerBackdrop: document.getElementById('drawer-backdrop'),
    drawerClose: document.getElementById('drawer-close'),
    detailAvatar: document.getElementById('detail-avatar'),
    detailStudent: document.getElementById('detail-student'),
    detailTime: document.getElementById('detail-time'),
    detailLikes: document.getElementById('detail-likes'),
    detailQuestion: document.getElementById('detail-question'),
    detailImage: document.getElementById('detail-image'),
    detailAnswer: document.getElementById('detail-answer'),
    detailTech: document.getElementById('detail-tech'),
    drawerCommentCount: document.getElementById('drawer-comment-count'),
    drawerComments: document.getElementById('drawer-comments'),
    teacherCommentForm: document.getElementById('teacher-comment-form'),
    teacherCommentInput: document.getElementById('teacher-comment-input'),
    teacherCommentError: document.getElementById('teacher-comment-error'),
    teacherCommentSubmit: document.getElementById('teacher-comment-submit'),
    toast: document.getElementById('toast'),
  };

  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    teacher: null,
    authView: 'email',
    questions: [],
    stats: null,
    filter: 'all',
    query: '',
    selected: new Set(),
    loading: false,
    exporting: false,
    activeQuestionId: null,
    toastTimer: null,
    searchTimer: null,
    backupStatus: null,
    backupRunning: false,
    activeQuestion: null,
    drawerComments: [],
    commentLoading: false,
    profileOpen: false,
    courses: [],
    activeCourseId: 'all',
    courseMenuOpen: false,
    courseModalOpen: false,
    editingCourseId: '',
  };

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('zh-CN');
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function isSameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function formatDisplayTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const now = new Date();
    const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    if (isSameDay(date, now)) return `今天 ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (isSameDay(date, yesterday)) return `昨天 ${time}`;
    if (date.getFullYear() === now.getFullYear()) {
      return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${time}`;
    }
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function formatFullTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
      date.getHours(),
    )}:${pad2(date.getMinutes())}`;
  }

  function todayStart() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function showToast(message, type = 'success') {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle('error', type === 'error');
    elements.toast.classList.add('is-visible');
    state.toastTimer = setTimeout(() => {
      elements.toast.classList.remove('is-visible');
    }, 3200);
  }

  function setStatus(kind, text) {
    elements.deepseekStatus.className = `status-pill ${kind}`;
    elements.deepseekStatus.querySelector('span').textContent = text;
    elements.deepseekStatus.title = text;
  }

  function setAuthView(view) {
    state.authView = view === 'legacy' ? 'legacy' : 'email';
    const loginView = state.authView;
    elements.emailLoginForm.hidden = loginView !== 'email';
    elements.legacyLoginForm.hidden = loginView !== 'legacy';
    elements.registerForm.hidden = true;
    elements.authTabs.forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.authView === loginView);
    });
    window.setTimeout(() => {
      if (loginView === 'legacy') elements.legacyToken.focus();
      else elements.emailLogin.focus();
    }, 80);
  }

  function showLogin(message = '') {
    elements.app.hidden = true;
    elements.loginScreen.hidden = false;
    elements.emailLoginError.textContent = message;
    elements.legacyError.textContent = message;
    elements.registerError.textContent = '';
    elements.emailLoginSubmit.classList.remove('is-loading');
    elements.emailLoginSubmit.disabled = false;
    elements.legacyLoginSubmit.classList.remove('is-loading');
    elements.legacyLoginSubmit.disabled = false;
    setAuthView(state.authView || 'email');
  }

  function showApp() {
    elements.loginScreen.hidden = true;
    elements.app.hidden = false;
  }

  function updateTeacherUI(teacher) {
    state.teacher = teacher || null;
    const name = teacher?.name || '教师';
    const publicId = teacher?.publicId || 'teacher';
    const avatar = name.slice(0, 1) || '师';
    elements.teacherName.textContent = name;
    elements.teacherPublicId.textContent = publicId;
    elements.teacherAvatar.textContent = avatar;
    elements.profileAvatar.textContent = avatar;
    elements.profileSummaryName.textContent = name;
    elements.profileSummaryEmail.textContent = teacher?.legacy
      ? '教师口令登录'
      : teacher?.email || '—';
    elements.profileMode.textContent = teacher?.legacy ? '口令模式' : '邮箱账号';
    if (teacher) {
      elements.profileName.value = teacher.name || '';
      elements.profilePublicId.value = teacher.publicId || '';
      elements.profileEmail.value = teacher.email || '';
    }
    const legacy = Boolean(teacher?.legacy);
    elements.profileForm.querySelectorAll('input, button').forEach((input) => {
      input.disabled = legacy;
    });
    elements.passwordForm.querySelectorAll('input, button').forEach((input) => {
      input.disabled = legacy;
    });
    elements.profileLegacyNote.hidden = !legacy;
  }

  function activeCourse() {
    return state.courses.find((course) => course.id === state.activeCourseId) || null;
  }

  function activeCourseLabel() {
    return activeCourse()?.name || '全部课程';
  }

  function renderCourseSelector() {
    if (!elements.currentCourseName) return;
    elements.currentCourseName.textContent = activeCourseLabel();
    elements.courseMenu.replaceChildren();
    const addItem = (id, label, meta) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `course-menu-item${state.activeCourseId === id ? ' active' : ''}`;
      const labelSpan = document.createElement('span');
      labelSpan.textContent = label;
      button.append(labelSpan);
      if (meta) {
        const metaSpan = document.createElement('small');
        metaSpan.textContent = meta;
        button.append(metaSpan);
      }
      button.addEventListener('click', () => selectCourse(id));
      elements.courseMenu.append(button);
    };
    addItem('all', '全部课程', '汇总');
    for (const course of state.courses.filter((item) => item.status !== 'archived')) {
      addItem(course.id, course.name, course.courseCode);
    }
    const divider = document.createElement('div');
    divider.className = 'course-menu-divider';
    elements.courseMenu.append(divider);
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'course-menu-item course-menu-manage';
    manage.textContent = '管理课程 / 新建课程';
    manage.addEventListener('click', () => {
      closeCourseMenu();
      openCourseModal();
    });
    elements.courseMenu.append(manage);
  }

  async function loadCourses() {
    try {
      const data = await api('/api/admin/courses');
      state.courses = Array.isArray(data?.courses) ? data.courses : [];
      const saved = localStorage.getItem('mathTutorAdminCourse') || 'all';
      const valid = state.courses.some(
        (course) => course.id === saved && course.status !== 'archived',
      );
      state.activeCourseId = valid ? saved : 'all';
      renderCourseSelector();
    } catch (error) {
      state.courses = [];
      state.activeCourseId = 'all';
      renderCourseSelector();
      showToast(error.message, 'error');
    }
  }

  function toggleCourseMenu() {
    state.courseMenuOpen = !state.courseMenuOpen;
    elements.courseMenu.hidden = !state.courseMenuOpen;
    elements.courseTrigger.setAttribute('aria-expanded', String(state.courseMenuOpen));
  }

  function closeCourseMenu() {
    state.courseMenuOpen = false;
    elements.courseMenu.hidden = true;
    elements.courseTrigger.setAttribute('aria-expanded', 'false');
  }

  function selectCourse(id) {
    if (state.activeCourseId === id) {
      closeCourseMenu();
      return;
    }
    state.activeCourseId = id;
    localStorage.setItem('mathTutorAdminCourse', id);
    state.selected.clear();
    closeCourseMenu();
    renderCourseSelector();
    void loadData();
  }

  function renderCourseManageList() {
    elements.courseManageList.replaceChildren();
    if (!state.courses.length) {
      const empty = document.createElement('p');
      empty.className = 'course-manage-empty';
      empty.textContent = '还没有课程，先在下面创建一门。';
      elements.courseManageList.append(empty);
      return;
    }
    for (const course of state.courses) {
      const row = document.createElement('div');
      row.className = 'course-manage-row';
      const copy = document.createElement('div');
      copy.className = 'course-manage-copy';
      const title = document.createElement('strong');
      title.textContent = `${course.name}${course.status === 'archived' ? '（已归档）' : ''}`;
      const meta = document.createElement('small');
      meta.textContent = `${course.courseCode} · ${course.teacherName}`;
      copy.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'course-manage-actions';
      if (course.status !== 'archived') {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = '编辑';
        edit.addEventListener('click', () => fillCourseForm(course));
        const archive = document.createElement('button');
        archive.type = 'button';
        archive.className = 'danger';
        archive.textContent = '归档';
        archive.addEventListener('click', () => void archiveCourse(course));
        actions.append(edit, archive);
      }
      row.append(copy, actions);
      elements.courseManageList.append(row);
    }
  }

  function resetCourseForm() {
    state.editingCourseId = '';
    elements.courseEditId.value = '';
    elements.courseFormTitle.textContent = '新建课程';
    elements.courseSave.textContent = '创建课程';
    elements.courseName.value = '';
    elements.courseTeacher.value = state.teacher?.name || '';
    elements.courseCode.value = '';
    elements.courseTerm.value = '';
    elements.courseColor.value = '0';
    elements.courseError.textContent = '';
  }

  function fillCourseForm(course) {
    state.editingCourseId = course.id;
    elements.courseEditId.value = course.id;
    elements.courseFormTitle.textContent = '编辑课程';
    elements.courseSave.textContent = '保存修改';
    elements.courseName.value = course.name || '';
    elements.courseTeacher.value = course.teacherName || '';
    elements.courseCode.value = course.courseCode || '';
    elements.courseTerm.value = course.term || '';
    elements.courseColor.value = String(course.colorIndex || 0);
    elements.courseError.textContent = '';
    elements.courseForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function openCourseModal() {
    if (!state.token) return;
    state.courseModalOpen = true;
    renderCourseManageList();
    resetCourseForm();
    elements.courseBackdrop.hidden = false;
    elements.courseBackdrop.classList.add('is-open');
    elements.courseModal.classList.add('is-open');
    elements.courseModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeCourseModal() {
    state.courseModalOpen = false;
    elements.courseBackdrop.classList.remove('is-open');
    elements.courseBackdrop.hidden = true;
    elements.courseModal.classList.remove('is-open');
    elements.courseModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  async function archiveCourse(course) {
    if (!window.confirm(`确定归档「${course.name}」吗？历史数据会保留，但学生将看不到这门课。`)) {
      return;
    }
    try {
      await api(`/api/admin/courses/${encodeURIComponent(course.id)}`, {
        method: 'DELETE',
      });
      await loadCourses();
      if (state.activeCourseId !== 'all' && !activeCourse()) state.activeCourseId = 'all';
      renderCourseManageList();
      renderCourseSelector();
      await loadData({ silent: true });
      showToast('课程已归档');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function saveCourse(event) {
    event.preventDefault();
    const payload = {
      name: elements.courseName.value.trim(),
      teacherName: elements.courseTeacher.value.trim(),
      courseCode: elements.courseCode.value.trim(),
      term: elements.courseTerm.value.trim(),
      colorIndex: Number(elements.courseColor.value),
    };
    elements.courseError.textContent = '';
    if (!payload.name || !payload.teacherName || !payload.courseCode) {
      elements.courseError.textContent = '请填写课程名称、教师姓名和课程编号。';
      return;
    }
    const editing = Boolean(state.editingCourseId);
    setButtonBusy(elements.courseSave, true, editing ? '保存中…' : '创建中…');
    try {
      const course = await api(
        editing
          ? `/api/admin/courses/${encodeURIComponent(state.editingCourseId)}`
          : '/api/admin/courses',
        { method: editing ? 'PATCH' : 'POST', body: payload },
      );
      await loadCourses();
      state.activeCourseId = course.id;
      localStorage.setItem('mathTutorAdminCourse', course.id);
      renderCourseSelector();
      renderCourseManageList();
      resetCourseForm();
      await loadData({ silent: true });
      showToast(editing ? '课程已更新' : '课程已创建');
    } catch (error) {
      elements.courseError.textContent = error.message;
    } finally {
      setButtonBusy(elements.courseSave, false);
    }
  }

  async function completeLogin(data) {
    state.token = data.token;
    sessionStorage.setItem(TOKEN_KEY, data.token);
    updateTeacherUI(data.teacher);
    showApp();
    state.questions = [];
    state.stats = null;
    state.activeCourseId = 'all';
    render();
    await loadCourses();
    await loadData();
    checkHealth();
    loadBackupStatus();
  }

  async function restoreSession() {
    try {
      const data = await api('/api/auth/me');
      updateTeacherUI(data.teacher);
      showApp();
      render();
      await loadCourses();
      await loadData();
      checkHealth();
      loadBackupStatus();
    } catch (error) {
      if (state.token) {
        showApp();
        updateTeacherUI(state.teacher);
        render();
        checkHealth();
        showToast(error.message, 'error');
      } else {
        showLogin();
        checkHealth();
      }
    }
  }

  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && state.token) headers.Authorization = `Bearer ${state.token}`;
    let response;
    try {
      response = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('无法连接服务器，请确认后端已启动。');
    }

    let payload = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      payload = await response.json().catch(() => null);
    }

    if (response.status === 401 && auth) {
      logout('登录状态已失效，请重新登录。');
    }
    if (!response.ok) {
      throw new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）`);
    }
    return payload?.data;
  }

  function logout(message = '') {
    const previousToken = state.token;
    state.token = '';
    state.teacher = null;
    state.questions = [];
    state.stats = null;
    state.selected.clear();
    state.activeQuestionId = null;
    state.activeQuestion = null;
    state.courses = [];
    state.activeCourseId = 'all';
    state.courseMenuOpen = false;
    state.courseModalOpen = false;
    state.backupStatus = null;
    state.backupRunning = false;
    elements.backupButton.hidden = true;
    elements.backupButton.classList.remove('is-spinning', 'state-warning', 'state-error');
    elements.backupState.className = 'backup-state';
    elements.backupStateText.textContent = '备份检查中';
    sessionStorage.removeItem(TOKEN_KEY);
    if (previousToken) {
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${previousToken}` },
      }).catch(() => {});
    }
    closeDrawer();
    closeProfile();
    closeCourseMenu();
    closeCourseModal();
    showLogin(message);
  }

  async function checkHealth() {
    try {
      const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('health failed');
      const payload = await response.json();
      if (payload?.data?.deepseekConfigured) {
        setStatus('', `DeepSeek 已连接 · ${payload.data.model}`);
      } else {
        setStatus('warning', 'DeepSeek 未配置');
      }
      if (elements.storageLabel) {
        elements.storageLabel.textContent =
          payload?.data?.storageDriver === 'mysql'
            ? '数据实时读取自 MySQL'
            : '数据实时读取自本地 JSON';
      }
    } catch {
      setStatus('error', '后端服务异常');
    }
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }

  function backupProviderLabel(status) {
    if (status.provider === 'cos+local') return 'COS + 本地';
    if (status.provider === 'cos') return 'COS';
    if (status.provider === 'local') return '本地';
    return '备份';
  }

  function renderBackupStatus() {
    const status = state.backupStatus;
    const setState = (kind, text) => {
      elements.backupState.className = `backup-state${kind ? ` ${kind}` : ''}`;
      elements.backupStateText.textContent = text;
    };

    if (!status) {
      elements.backupButton.hidden = true;
      setState('', '备份状态未知');
      return;
    }
    if (!status.supported) {
      elements.backupButton.hidden = true;
      setState('warning', '备份需 MySQL 模式');
      return;
    }
    if (!status.configured) {
      elements.backupButton.hidden = true;
      setState('warning', 'COS 备份未配置');
      return;
    }

    elements.backupButton.hidden = false;
    elements.backupButton.disabled = state.backupRunning;
    elements.backupButton.classList.toggle('is-spinning', state.backupRunning);
    elements.backupButton.classList.remove('state-warning', 'state-error');
    const provider = backupProviderLabel(status);
    const providerDetail =
      status.provider === 'cos'
        ? `${status.cos?.bucket || 'COS'} / ${status.cos?.region || ''}`
        : provider;

    if (state.backupRunning || status.running) {
      setState('running', '正在备份数据…');
      elements.backupButton.title = '备份进行中';
      return;
    }

    const last = status.lastRun;
    if (last?.status === 'success') {
      setState('ok', `${provider} 已备份 · ${formatDisplayTime(last.createdAt)}`);
      elements.backupButton.title = `最近备份：${formatFullTime(last.createdAt)} · ${formatBytes(
        last.sizeBytes,
      )} · 点击立即备份`;
    } else if (last?.status === 'failed') {
      setState('error', '上次备份失败');
      elements.backupButton.classList.add('state-error');
      elements.backupButton.title = `上次备份失败：${last.errorMessage || '未知错误'}`;
    } else {
      setState('warning', `${provider} 备份待执行`);
      elements.backupButton.title = '尚未产生备份，点击立即备份';
    }

    if (!status.automatic) {
      elements.backupStateText.textContent += ' · 仅手动';
    }
    elements.backupButton.setAttribute(
      'aria-label',
      `立即备份数据到 ${providerDetail}`,
    );
  }

  async function loadBackupStatus() {
    if (!state.token) return;
    try {
      state.backupStatus = await api('/api/admin/backup');
      renderBackupStatus();
    } catch (error) {
      if (state.token) {
        elements.backupButton.hidden = true;
        elements.backupState.className = 'backup-state warning';
        elements.backupStateText.textContent = '备份状态读取失败';
      }
    }
  }

  async function triggerBackup() {
    if (!state.backupStatus?.configured || state.backupRunning) return;
    const provider = backupProviderLabel(state.backupStatus);
    if (!window.confirm(`立即将当前 MySQL 数据备份到 ${provider} 吗？`)) return;
    state.backupRunning = true;
    renderBackupStatus();
    try {
      const result = await api('/api/admin/backup', { method: 'POST' });
      showToast(`备份成功：${formatBytes(result.sizeBytes)}（${provider}）`);
    } catch (error) {
      if (state.token) showToast(error.message, 'error');
    } finally {
      state.backupRunning = false;
      await loadBackupStatus();
    }
  }

  function getFilteredQuestions() {
    const query = state.query.trim().toLowerCase();
    const start = todayStart();
    return state.questions.filter((item) => {
      if (state.filter === 'liked' && item.likeCount <= 0) return false;
      if (state.filter === 'today') {
        const created = new Date(item.createdAt);
        if (Number.isNaN(created.getTime()) || created < start) return false;
      }
      if (!query) return true;
      return [item.question, item.answer, item.studentLabel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }

  function getExportIds() {
    if (state.selected.size) return [...state.selected];
    return getFilteredQuestions().map((item) => item.id);
  }

  function selectionSummaryText(count, isFiltered) {
    if (state.selected.size) return `导出所选 (${count})`;
    return isFiltered ? `导出筛选 (${count})` : `导出全部 (${count})`;
  }

  function updateExportUI() {
    const filtered = getFilteredQuestions();
    const ids = state.selected.size ? [...state.selected] : filtered.map((item) => item.id);
    const isFiltered = Boolean(state.query.trim()) || state.filter !== 'all';
    const label = selectionSummaryText(ids.length, isFiltered);
    elements.exportMdLabel.textContent = `Markdown · ${label.replace(/^导出/, '')}`;
    elements.exportDocxLabel.textContent = `Word · ${label.replace(/^导出/, '')}`;
    const disabled = state.exporting || ids.length === 0;
    elements.exportMd.disabled = disabled;
    elements.exportDocx.disabled = disabled;
    elements.exportMd.title = state.selected.size
      ? `导出所选的 ${ids.length} 条记录为 Markdown`
      : `导出当前结果 ${ids.length} 条为 Markdown`;
    elements.exportDocx.title = state.selected.size
      ? `导出所选的 ${ids.length} 条记录为 Word`
      : `导出当前结果 ${ids.length} 条为 Word`;
  }

  function updateSelectionUI() {
    const filtered = getFilteredQuestions();
    const visibleIds = filtered.map((item) => item.id);
    const selectedVisible = visibleIds.filter((id) => state.selected.has(id)).length;
    elements.selectionBar.hidden = state.selected.size === 0;
    elements.selectedCount.textContent = String(state.selected.size);
    elements.selectAll.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
    elements.selectAll.indeterminate =
      selectedVisible > 0 && selectedVisible < visibleIds.length;
    elements.selectAll.disabled = visibleIds.length === 0;
    updateExportUI();
  }

  function updateFilterTabs() {
    for (const tab of elements.filterTabs) {
      const active = tab.dataset.filter === state.filter;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-pressed', String(active));
    }
  }

  function updateEmptyState(filtered) {
    const hasQuestions = state.questions.length > 0;
    const isFiltered = Boolean(state.query.trim()) || state.filter !== 'all';
    const isEmpty = filtered.length === 0;
    elements.emptyState.hidden = !isEmpty;
    elements.questionTable.hidden = isEmpty;
    elements.selectAll.disabled = isEmpty;
    if (!isEmpty) return;
    if (!hasQuestions) {
      elements.emptyTitle.textContent = '还没有学生提问';
      elements.emptyCopy.textContent = '学生在小程序中提交问题后，记录会自动出现在这里。';
    } else {
      elements.emptyTitle.textContent = '没有找到匹配的提问';
      elements.emptyCopy.textContent = '试试更换关键词，或清除当前筛选条件。';
    }
    elements.emptyReset.hidden = !isFiltered;
  }

  function createRow(item) {
    const row = document.createElement('tr');
    row.dataset.id = item.id;
    row.tabIndex = 0;
    row.setAttribute('aria-label', `${item.studentLabel}的提问：${item.question.slice(0, 40)}`);

    const checkCell = document.createElement('td');
    checkCell.className = 'checkbox-column';
    const label = document.createElement('label');
    label.className = 'checkbox';
    label.title = '选择这条提问';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selected.has(item.id);
    checkbox.setAttribute('aria-label', `选择 ${item.studentLabel} 的提问`);
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selected.add(item.id);
      else state.selected.delete(item.id);
      updateSelectionUI();
    });
    const boxVisual = document.createElement('span');
    label.append(checkbox, boxVisual);
    checkCell.append(label);

    const studentCell = document.createElement('td');
    const studentWrap = document.createElement('div');
    studentWrap.className = 'student-cell';
    const avatar = document.createElement('span');
    avatar.className = 'student-avatar';
    avatar.textContent = item.studentLabel.replace(/\D/g, '').slice(-2) || '--';
    const studentName = document.createElement('span');
    studentName.textContent = item.studentLabel;
    studentWrap.append(avatar, studentName);
    studentCell.append(studentWrap);

    const questionCell = document.createElement('td');
    const questionWrap = document.createElement('div');
    questionWrap.className = 'question-cell';
    if (state.activeCourseId === 'all' && item.courseName) {
      const courseTag = document.createElement('span');
      courseTag.className = 'course-row-tag';
      courseTag.textContent = item.courseName;
      questionWrap.append(courseTag);
    }
    const questionText = document.createElement('p');
    questionText.className = 'question-text';
    questionText.textContent = item.question;
    const answerPreview = document.createElement('p');
    answerPreview.className = 'answer-preview';
    answerPreview.textContent = String(item.answer || '暂无回答').replace(/\s+/g, ' ');
    questionWrap.append(questionText, answerPreview);
    questionCell.append(questionWrap);

    const likeCell = document.createElement('td');
    const likePill = document.createElement('span');
    likePill.className = `like-pill${item.likeCount ? '' : ' muted'}`;
    likePill.textContent = `♥ ${formatNumber(item.likeCount)}`;
    likeCell.append(likePill);

    const timeCell = document.createElement('td');
    const time = document.createElement('time');
    time.dateTime = item.createdAt;
    time.textContent = formatDisplayTime(item.createdAt);
    time.title = formatFullTime(item.createdAt);
    timeCell.append(time);

    const statusCell = document.createElement('td');
    const status = document.createElement('span');
    status.className = 'status-badge';
    status.textContent = '已回答';
    statusCell.append(status);

    const actionCell = document.createElement('td');
    actionCell.className = 'action-column';
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'row-action';
    action.textContent = item.commentCount ? `查看 · ${item.commentCount}` : '查看';
    action.addEventListener('click', (event) => {
      event.stopPropagation();
      openDrawer(item);
    });
    actionCell.append(action);

    row.append(checkCell, studentCell, questionCell, likeCell, timeCell, statusCell, actionCell);
    row.addEventListener('click', (event) => {
      if (event.target.closest('input, button, label')) return;
      openDrawer(item);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDrawer(item);
      }
    });
    return row;
  }

  function renderTable() {
    const filtered = getFilteredQuestions();
    const fragment = document.createDocumentFragment();
    for (const item of filtered) fragment.append(createRow(item));
    elements.questionRows.replaceChildren(fragment);
    updateEmptyState(filtered);
    elements.resultCount.textContent =
      state.questions.length === 0
        ? '0 条'
        : `${formatNumber(filtered.length)} / ${formatNumber(state.questions.length)} 条`;
    elements.footerCount.textContent = `共 ${formatNumber(state.questions.length)} 条记录 · 当前显示 ${formatNumber(
      filtered.length,
    )} 条`;
    updateFilterTabs();
    updateSelectionUI();
    updateExportUI();
  }

  function renderStats() {
    const stats = state.stats || {
      totalQuestions: 0,
      totalStudents: 0,
      totalLikes: 0,
      todayQuestions: 0,
    };
    elements.statTotal.textContent = formatNumber(stats.totalQuestions);
    elements.statStudents.textContent = formatNumber(stats.totalStudents);
    elements.statLikes.textContent = formatNumber(stats.totalLikes);
    elements.statToday.textContent = formatNumber(stats.todayQuestions);
    elements.statTotalNote.textContent = `累计 ${formatNumber(stats.answeredQuestions)} 条已回答`;
    elements.statTodayNote.textContent =
      stats.todayQuestions > 0 ? '今天的课堂追问' : '今天还没有新提问';
    const updated = state.lastUpdated ? formatDisplayTime(state.lastUpdated) : '—';
    const courseLabel = activeCourseLabel();
    elements.pageSubtitle.textContent = stats.totalQuestions
      ? `${courseLabel} · 共 ${formatNumber(stats.totalQuestions)} 条答疑记录，来自 ${formatNumber(
          stats.totalStudents,
        )} 位匿名学生 · 最近更新 ${updated}`
      : `${courseLabel} · 尚无答疑记录，学生提交问题后会自动汇总到这里。`;
  }

  function render() {
    renderStats();
    renderTable();
  }

  async function loadData({ silent = false } = {}) {
    if (!state.token || state.loading) return;
    state.loading = true;
    elements.refreshButton.classList.add('is-spinning');
    const showSkeleton = !silent && state.questions.length === 0;
    if (showSkeleton) {
      elements.tableLoading.hidden = false;
      elements.emptyState.hidden = true;
      elements.questionTable.hidden = true;
    }
    try {
      const data = await api(
        `/api/admin/questions?courseId=${encodeURIComponent(state.activeCourseId || 'all')}`,
      );
      state.questions = Array.isArray(data?.questions) ? data.questions : [];
      state.stats = data?.stats || null;
      state.lastUpdated = new Date();
      const existingIds = new Set(state.questions.map((item) => item.id));
      for (const id of [...state.selected]) {
        if (!existingIds.has(id)) state.selected.delete(id);
      }
      render();
      elements.lastRefresh.textContent = formatDisplayTime(new Date());
      if (!silent && !showSkeleton) showToast('数据已刷新');
    } catch (error) {
      if (state.token) {
        showToast(error.message, 'error');
        elements.pageSubtitle.textContent = '读取数据失败，请检查后端服务后重试。';
        if (state.questions.length === 0) {
          elements.emptyTitle.textContent = '数据加载失败';
          elements.emptyCopy.textContent = error.message;
          elements.emptyState.hidden = false;
          elements.emptyReset.hidden = true;
          elements.questionTable.hidden = true;
        }
      }
    } finally {
      state.loading = false;
      elements.tableLoading.hidden = true;
      elements.refreshButton.classList.remove('is-spinning');
      if (state.questions.length > 0) elements.questionTable.hidden = getFilteredQuestions().length === 0;
      updateExportUI();
    }
  }

  function openDrawer(item) {
    state.activeQuestionId = item.id;
    state.activeQuestion = item;
    state.drawerComments = [];
    elements.detailAvatar.textContent = item.studentLabel.replace(/\D/g, '').slice(-2) || '--';
    elements.detailStudent.textContent = item.studentLabel;
    elements.detailTime.textContent = `${formatFullTime(item.createdAt)} 提问`;
    elements.detailLikes.textContent = `♥ ${formatNumber(item.likeCount)}`;
    elements.detailQuestion.textContent = item.question;
    if (item.imagePath) {
      elements.detailImage.src = item.imagePath;
      elements.detailImage.hidden = false;
    } else {
      elements.detailImage.removeAttribute('src');
      elements.detailImage.hidden = true;
    }
    elements.detailAnswer.textContent = item.answer || '暂无回答';
    elements.drawerCommentCount.textContent = '0';
    elements.drawerComments.innerHTML =
      '<p class="comments-empty">正在读取评论…</p>';
    elements.teacherCommentInput.value = '';
    elements.teacherCommentError.textContent = '';
    elements.detailTech.replaceChildren();
    const chips = [
      item.model ? `模型 ${item.model}` : '',
      Number.isFinite(item.latencyMs) && item.latencyMs > 0
        ? `响应 ${(item.latencyMs / 1000).toFixed(1)} 秒`
        : '',
      item.id ? `记录 ${item.id.slice(0, 12)}` : '',
    ].filter(Boolean);
    for (const chip of chips) {
      const span = document.createElement('span');
      span.className = 'tech-chip';
      span.textContent = chip;
      elements.detailTech.append(span);
    }

    elements.drawerBackdrop.hidden = false;
    elements.drawer.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      elements.drawer.classList.add('is-open');
      elements.drawerBackdrop.classList.add('is-open');
    });
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => elements.drawerClose.focus(), 120);
    void loadDrawerComments(item.id);
  }

  function closeDrawer() {
    state.activeQuestionId = null;
    state.activeQuestion = null;
    state.drawerComments = [];
    elements.detailImage.hidden = true;
    elements.detailImage.removeAttribute('src');
    elements.drawer.classList.remove('is-open');
    elements.drawerBackdrop.classList.remove('is-open');
    elements.drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    window.setTimeout(() => {
      if (!elements.drawer.classList.contains('is-open')) {
        elements.drawerBackdrop.hidden = true;
      }
    }, 260);
  }

  function renderDrawerComments() {
    const comments = state.drawerComments;
    elements.drawerCommentCount.textContent = String(comments.length);
    if (!comments.length) {
      elements.drawerComments.innerHTML =
        '<p class="comments-empty">还没有评论。写下第一条教师评论，学生会收到服务号推送。</p>';
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const comment of comments) {
      const card = document.createElement('article');
      card.className = `comment-card${comment.authorType === 'teacher' ? ' teacher' : ''}`;
      const head = document.createElement('div');
      head.className = 'comment-head';
      const author = document.createElement('span');
      author.className = 'comment-author';
      author.textContent = comment.authorName;
      head.append(author);
      if (comment.authorType === 'teacher') {
        const tag = document.createElement('span');
        tag.className = 'comment-teacher-tag';
        tag.textContent = '教师评论';
        head.append(tag);
      }
      const time = document.createElement('time');
      time.className = 'comment-time';
      time.textContent = formatDisplayTime(comment.createdAt);
      time.title = formatFullTime(comment.createdAt);
      head.append(time);
      const content = document.createElement('p');
      content.className = 'comment-content';
      content.textContent = comment.content;
      const actions = document.createElement('div');
      actions.className = 'comment-actions';
      const like = document.createElement('button');
      like.type = 'button';
      like.className = `comment-like${comment.likedByMe ? ' liked' : ''}`;
      like.textContent = `${comment.likedByMe ? '♥' : '♡'} ${formatNumber(comment.likeCount)}`;
      like.setAttribute('aria-label', comment.likedByMe ? '取消点赞' : '点赞评论');
      like.addEventListener('click', () => toggleAdminCommentLike(comment.id));
      actions.append(like);
      card.append(head, content, actions);
      fragment.append(card);
    }
    elements.drawerComments.replaceChildren(fragment);
  }

  async function loadDrawerComments(questionId) {
    state.commentLoading = true;
    try {
      const data = await api(`/api/admin/questions/${encodeURIComponent(questionId)}/comments`);
      if (state.activeQuestionId !== questionId) return;
      state.drawerComments = Array.isArray(data.comments) ? data.comments : [];
      renderDrawerComments();
    } catch (error) {
      if (state.activeQuestionId !== questionId) return;
      elements.drawerComments.textContent = `评论加载失败：${error.message}`;
    } finally {
      state.commentLoading = false;
    }
  }

  async function toggleAdminCommentLike(commentId) {
    const comment = state.drawerComments.find((item) => item.id === commentId);
    if (!comment) return;
    try {
      const result = await api(`/api/admin/comments/${encodeURIComponent(commentId)}/like`, {
        method: 'POST',
      });
      comment.likedByMe = Boolean(result.liked);
      comment.likeCount = Number(result.likeCount) || 0;
      renderDrawerComments();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function submitTeacherComment(event) {
    event.preventDefault();
    if (!state.activeQuestionId) return;
    const content = elements.teacherCommentInput.value.trim();
    if (!content) {
      elements.teacherCommentError.textContent = '请先写评论内容。';
      return;
    }
    elements.teacherCommentSubmit.disabled = true;
    elements.teacherCommentSubmit.classList.add('is-loading');
    elements.teacherCommentError.textContent = '';
    try {
      const result = await api(
        `/api/admin/questions/${encodeURIComponent(state.activeQuestionId)}/comments`,
        { method: 'POST', body: { content } },
      );
      elements.teacherCommentInput.value = '';
      showToast(
        result.pushStarted
          ? '评论已发布，已尝试推送服务号通知。'
          : '评论已发布，学生可在小程序中查看。',
      );
      await loadDrawerComments(state.activeQuestionId);
      await loadData({ silent: true });
    } catch (error) {
      elements.teacherCommentError.textContent = error.message;
    } finally {
      elements.teacherCommentSubmit.disabled = false;
      elements.teacherCommentSubmit.classList.remove('is-loading');
    }
  }

  function openProfile() {
    if (!state.teacher) return;
    updateTeacherUI(state.teacher);
    elements.profileError.textContent = '';
    elements.passwordError.textContent = '';
    elements.profileBackdrop.hidden = false;
    elements.profileModal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      elements.profileModal.classList.add('is-open');
      elements.profileBackdrop.classList.add('is-open');
    });
    document.body.style.overflow = 'hidden';
    state.profileOpen = true;
    window.setTimeout(() => {
      if (!elements.profileForm.querySelector('input:not(:disabled)')) return;
      elements.profileName.focus();
    }, 100);
  }

  function closeProfile() {
    state.profileOpen = false;
    elements.profileModal.classList.remove('is-open');
    elements.profileBackdrop.classList.remove('is-open');
    elements.profileModal.setAttribute('aria-hidden', 'true');
    if (!elements.drawer.classList.contains('is-open')) document.body.style.overflow = '';
    window.setTimeout(() => {
      if (!elements.profileModal.classList.contains('is-open')) {
        elements.profileBackdrop.hidden = true;
      }
    }, 220);
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!state.teacher || state.teacher.legacy) return;
    elements.profileSave.disabled = true;
    elements.profileError.textContent = '';
    try {
      const data = await api('/api/auth/profile', {
        method: 'PATCH',
        body: {
          name: elements.profileName.value.trim(),
          publicId: elements.profilePublicId.value.trim(),
          email: elements.profileEmail.value.trim(),
          currentPassword: elements.profileCurrentPassword.value,
        },
      });
      elements.profileCurrentPassword.value = '';
      updateTeacherUI(data.teacher);
      showToast('资料已更新');
    } catch (error) {
      elements.profileError.textContent = error.message;
    } finally {
      elements.profileSave.disabled = false;
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    if (!state.teacher || state.teacher.legacy) return;
    const next = elements.passwordNew.value;
    if (next !== elements.passwordConfirm.value) {
      elements.passwordError.textContent = '两次新密码不一致。';
      return;
    }
    elements.passwordSave.disabled = true;
    elements.passwordError.textContent = '';
    try {
      const data = await api('/api/auth/password', {
        method: 'POST',
        body: {
          currentPassword: elements.passwordCurrent.value,
          newPassword: next,
        },
      });
      state.token = data.token;
      sessionStorage.setItem(TOKEN_KEY, data.token);
      updateTeacherUI(data.teacher);
      elements.passwordForm.reset();
      showToast('密码已更新，其他登录会话已失效。');
    } catch (error) {
      elements.passwordError.textContent = error.message;
    } finally {
      elements.passwordSave.disabled = false;
    }
  }

  async function downloadExport(format) {
    if (state.exporting) return;
    const ids = getExportIds();
    if (!ids.length) {
      showToast('当前没有可导出的记录。', 'error');
      return;
    }
    state.exporting = true;
    const labelElement = format === 'md' ? elements.exportMdLabel : elements.exportDocxLabel;
    updateExportUI();
    labelElement.textContent = '正在生成…';
    try {
      const response = await fetch(`/api/admin/export.${format}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.token}`,
        },
        body: JSON.stringify({ ids, courseId: state.activeCourseId || 'all' }),
      });
      if (response.status === 401) {
        logout('登录状态已失效，请重新登录。');
        return;
      }
      if (!response.ok) {
        let message = `导出失败（HTTP ${response.status}）`;
        try {
          const payload = await response.json();
          message = payload?.error?.message || message;
        } catch {
          // 保持通用错误信息。
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const asciiMatch = disposition.match(/filename="([^"]+)"/i);
      let filename = `数学分析_学生提问汇总.${format}`;
      if (utf8Match) {
        try {
          filename = decodeURIComponent(utf8Match[1]);
        } catch {
          // 使用默认文件名。
        }
      } else if (asciiMatch) {
        filename = asciiMatch[1];
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast(`已导出 ${ids.length} 条记录（${format === 'md' ? 'Markdown' : 'Word'}）`);
    } catch (error) {
      if (state.token) showToast(error.message, 'error');
    } finally {
      state.exporting = false;
      updateExportUI();
    }
  }

  function clearFilters() {
    state.filter = 'all';
    state.query = '';
    elements.searchInput.value = '';
    renderTable();
  }

  function setButtonBusy(button, busy, busyText) {
    if (!button) return;
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = busy;
    button.classList.toggle('is-loading', busy);
    button.textContent = busy ? busyText : '';
    if (!busy) button.innerHTML = button.dataset.originalHtml;
  }

  async function handleEmailLogin() {
    const email = elements.emailLogin.value.trim();
    const password = elements.emailPassword.value;
    elements.emailLoginError.textContent = '';
    if (!email || !password) {
      elements.emailLoginError.textContent = '请输入邮箱和密码。';
      return;
    }
    setButtonBusy(elements.emailLoginSubmit, true, '登录中…');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { email, password },
        auth: false,
      });
      elements.emailPassword.value = '';
      await completeLogin(data);
    } catch (error) {
      elements.emailLoginError.textContent = error.message;
    } finally {
      setButtonBusy(elements.emailLoginSubmit, false);
    }
  }

  async function handleLegacyLogin() {
    const token = elements.legacyToken.value.trim();
    elements.legacyError.textContent = '';
    if (!token) {
      elements.legacyError.textContent = '请输入教师口令。';
      elements.legacyToken.focus();
      return;
    }
    setButtonBusy(elements.legacyLoginSubmit, true, '登录中…');
    try {
      const data = await api('/api/admin/login', {
        method: 'POST',
        body: { token },
        auth: false,
      });
      elements.legacyToken.value = '';
      await completeLogin(data);
    } catch (error) {
      elements.legacyError.textContent = error.message;
    } finally {
      setButtonBusy(elements.legacyLoginSubmit, false);
    }
  }

  async function handleRegister() {
    elements.registerError.textContent = '';
    const payload = {
      email: elements.registerEmail.value.trim(),
      name: elements.registerName.value.trim(),
      publicId: elements.registerPublicId.value.trim(),
      password: elements.registerPassword.value,
      registerCode: elements.registerCode.value.trim(),
    };
    if (!payload.email || !payload.name || !payload.publicId || !payload.password) {
      elements.registerError.textContent = '请把注册信息填写完整。';
      return;
    }
    setButtonBusy(elements.registerSubmit, true, '创建中…');
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: payload,
        auth: false,
      });
      elements.registerForm.reset();
      await completeLogin(data);
    } catch (error) {
      elements.registerError.textContent = error.message;
    } finally {
      setButtonBusy(elements.registerSubmit, false);
    }
  }

  function showRegisterForm() {
    elements.emailLoginForm.hidden = true;
    elements.legacyLoginForm.hidden = true;
    elements.registerForm.hidden = false;
    elements.authTabs.forEach((tab) => tab.classList.remove('active'));
    elements.registerError.textContent = '';
    window.setTimeout(() => elements.registerEmail.focus(), 80);
  }

  function bindEvents() {
    elements.emailLoginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void handleEmailLogin();
    });
    elements.legacyLoginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void handleLegacyLogin();
    });
    elements.registerForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void handleRegister();
    });
    elements.authTabs.forEach((tab) => {
      tab.addEventListener('click', () => setAuthView(tab.dataset.authView));
    });
    elements.showRegister.addEventListener('click', showRegisterForm);
    elements.backToLogin.addEventListener('click', () => setAuthView('email'));
    elements.togglePassword.addEventListener('click', () => {
      const show = elements.legacyToken.type === 'password';
      elements.legacyToken.type = show ? 'text' : 'password';
      elements.togglePassword.textContent = show ? '隐藏' : '显示';
      elements.togglePassword.setAttribute('aria-label', show ? '隐藏口令' : '显示口令');
      elements.legacyToken.focus();
    });

    elements.logoutButton.addEventListener('click', () => {
      logout();
      showToast('已退出教师后台');
    });
    elements.courseTrigger.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleCourseMenu();
    });
    elements.courseModalClose.addEventListener('click', closeCourseModal);
    elements.courseBackdrop.addEventListener('click', closeCourseModal);
    elements.courseForm.addEventListener('submit', (event) => void saveCourse(event));
    document.addEventListener('click', (event) => {
      if (!state.courseMenuOpen) return;
      if (!event.target.closest('.course-selector')) closeCourseMenu();
    });

    elements.profileButton.addEventListener('click', openProfile);
    elements.profileClose.addEventListener('click', closeProfile);
    elements.profileBackdrop.addEventListener('click', closeProfile);
    elements.profileForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveProfile(event);
    });
    elements.passwordForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void savePassword(event);
    });
    elements.teacherCommentForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void submitTeacherComment(event);
    });

    elements.refreshButton.addEventListener('click', () => loadData());
    elements.backupButton.addEventListener('click', triggerBackup);
    elements.clearSelection.addEventListener('click', () => {
      state.selected.clear();
      renderTable();
    });

    elements.filterTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        state.filter = tab.dataset.filter;
        renderTable();
      });
    });

    elements.searchInput.addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        state.query = elements.searchInput.value;
        renderTable();
      }, 120);
    });

    elements.selectAll.addEventListener('change', () => {
      const visible = getFilteredQuestions();
      if (elements.selectAll.checked) {
        for (const item of visible) state.selected.add(item.id);
      } else {
        for (const item of visible) state.selected.delete(item.id);
      }
      renderTable();
    });

    elements.emptyReset.addEventListener('click', clearFilters);
    elements.exportMd.addEventListener('click', () => downloadExport('md'));
    elements.exportDocx.addEventListener('click', () => downloadExport('docx'));

    elements.drawerClose.addEventListener('click', closeDrawer);
    elements.drawerBackdrop.addEventListener('click', closeDrawer);

    document.addEventListener('keydown', (event) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      if (event.key === '/' && !typing && !elements.app.hidden) {
        event.preventDefault();
        elements.searchInput.focus();
      }
      if (event.key === 'Escape') {
        if (elements.courseModal.classList.contains('is-open')) closeCourseModal();
        else if (state.courseMenuOpen) closeCourseMenu();
        else if (elements.profileModal.classList.contains('is-open')) closeProfile();
        else if (elements.drawer.classList.contains('is-open')) closeDrawer();
        else if (document.activeElement === elements.searchInput) elements.searchInput.blur();
      }
    });
  }

  function init() {
    bindEvents();
    if (state.token) {
      void restoreSession();
    } else {
      showLogin();
      checkHealth();
    }
  }

  init();
})();
