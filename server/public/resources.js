(() => {
  'use strict';

  const TOKEN_KEY = 'mathTutorAdminToken';
  const DEFAULT_CATEGORIES = [
    '讲义',
    '课件',
    '作业题',
    '作业题答案',
    '练习题',
    '模拟试卷',
  ];
  const ALLOWED_EXTENSIONS = ['ppt', 'pptx', 'doc', 'docx', 'pdf'];

  const elements = {
    gate: document.getElementById('auth-gate'),
    app: document.getElementById('app'),
    logoutButton: document.getElementById('logout-button'),
    uploadButton: document.getElementById('upload-button'),
    pageSubtitle: document.getElementById('page-subtitle'),
    summaryTotal: document.getElementById('summary-total'),
    summaryCategories: document.getElementById('summary-categories'),
    summaryUpdated: document.getElementById('summary-updated'),
    search: document.getElementById('resource-search'),
    categoryFilter: document.getElementById('category-filter'),
    count: document.getElementById('resource-count'),
    rows: document.getElementById('resource-rows'),
    table: document.querySelector('.resource-table'),
    loading: document.getElementById('resource-loading'),
    empty: document.getElementById('resource-empty'),
    emptyTitle: document.getElementById('empty-title'),
    emptyCopy: document.getElementById('empty-copy'),
    emptyUpload: document.getElementById('empty-upload'),
    emptyReset: document.getElementById('empty-reset'),
    footer: document.getElementById('resource-footer'),
    maxFileSize: document.getElementById('max-file-size'),
    modal: document.getElementById('resource-modal'),
    modalBackdrop: document.getElementById('resource-modal-backdrop'),
    modalClose: document.getElementById('resource-modal-close'),
    modalTitle: document.getElementById('resource-modal-title'),
    form: document.getElementById('resource-form'),
    title: document.getElementById('resource-title'),
    category: document.getElementById('resource-category'),
    description: document.getElementById('resource-description'),
    file: document.getElementById('resource-file'),
    fileDropTitle: document.getElementById('file-drop-title'),
    fileDropCopy: document.getElementById('file-drop-copy'),
    currentFile: document.getElementById('current-file'),
    requiredMark: document.getElementById('file-required-mark'),
    formError: document.getElementById('resource-form-error'),
    cancel: document.getElementById('resource-cancel'),
    save: document.getElementById('resource-save'),
    toast: document.getElementById('toast'),
  };

  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    resources: [],
    categories: DEFAULT_CATEGORIES.slice(),
    query: '',
    category: '',
    editingId: null,
    loading: false,
    submitting: false,
    maxSizeMb: 30,
    toastTimer: null,
  };

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function formatSize(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const now = new Date();
    const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    if (date.toDateString() === now.toDateString()) return `今天 ${time}`;
    if (date.getFullYear() === now.getFullYear()) {
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
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

  function showGate() {
    elements.app.hidden = true;
    elements.gate.hidden = false;
  }

  function showApp() {
    elements.gate.hidden = true;
    elements.app.hidden = false;
  }

  function handleUnauthorized() {
    state.token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    closeModal();
    showGate();
  }

  async function api(path, options = {}) {
    const headers = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.auth !== false && state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }
    let response;
    try {
      response = await fetch(path, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new Error('无法连接服务器，请确认后端或云托管服务正在运行。');
    }

    let payload = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      payload = await response.json().catch(() => null);
    }
    if (response.status === 401) {
      handleUnauthorized();
      throw new Error('教师登录已失效，请重新登录。');
    }
    if (!response.ok) {
      throw new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）`);
    }
    return payload?.data;
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function extensionOf(fileName) {
    return String(fileName || '').split('.').pop().toLowerCase();
  }

  function fileBadgeClass(resource) {
    const label = String(resource.fileTypeLabel || resource.extension || '').toLowerCase();
    if (label === 'pdf') return 'pdf';
    if (label === 'ppt') return 'ppt';
    if (label === 'word') return 'word';
    return '';
  }

  function fillCategorySelect(select, includeAll) {
    const previous = select.value;
    select.replaceChildren();
    if (includeAll) {
      const all = createElement('option', '', '全部分类');
      all.value = '';
      select.append(all);
    } else {
      const placeholder = createElement('option', '', '请选择分类');
      placeholder.value = '';
      select.append(placeholder);
    }
    for (const category of state.categories) {
      const option = createElement('option', '', category);
      option.value = category;
      select.append(option);
    }
    if ([...select.options].some((option) => option.value === previous)) {
      select.value = previous;
    }
  }

  function filteredResources() {
    const query = state.query.trim().toLowerCase();
    return state.resources.filter((resource) => {
      if (state.category && resource.category !== state.category) return false;
      if (!query) return true;
      return [resource.title, resource.description, resource.fileName, resource.category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }

  function renderSummary() {
    const filtered = filteredResources();
    elements.summaryTotal.textContent = String(state.resources.length);
    elements.summaryCategories.textContent = String(
      new Set(state.resources.map((resource) => resource.category)).size,
    );
    const latest = state.resources
      .map((resource) => new Date(resource.updatedAt).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    elements.summaryUpdated.textContent = latest ? formatTime(latest) : '暂无';
    elements.count.textContent =
      state.resources.length === 0
        ? '0 份'
        : `${filtered.length} / ${state.resources.length} 份`;
    elements.footer.textContent = `共 ${state.resources.length} 份资源 · 当前显示 ${filtered.length} 份`;
  }

  function createResourceRow(resource) {
    const row = document.createElement('tr');

    const mainCell = document.createElement('td');
    const main = createElement('div', 'resource-main');
    const badge = createElement(
      'span',
      `file-badge ${fileBadgeClass(resource)}`,
      String(resource.fileTypeLabel || resource.extension || 'FILE').toUpperCase(),
    );
    const copy = createElement('div', 'resource-copy');
    const title = createElement('p', 'resource-title', resource.title);
    const description = createElement(
      'p',
      'resource-description',
      resource.description || resource.fileName || '暂无简介',
    );
    copy.append(title, description);
    main.append(badge, copy);
    mainCell.append(main);

    const categoryCell = document.createElement('td');
    categoryCell.append(createElement('span', 'resource-category', resource.category));

    const formatCell = document.createElement('td');
    formatCell.append(
      createElement(
        'span',
        'resource-format',
        String(resource.fileTypeLabel || resource.extension || '').toUpperCase(),
      ),
    );

    const sizeCell = document.createElement('td');
    sizeCell.append(createElement('span', 'resource-meta', formatSize(resource.sizeBytes)));

    const timeCell = document.createElement('td');
    const time = createElement('time', 'resource-time', formatTime(resource.updatedAt));
    time.dateTime = resource.updatedAt || '';
    timeCell.append(time);

    const actionCell = document.createElement('td');
    actionCell.className = 'resource-actions-col';
    const actions = createElement('div', 'resource-actions');
    const openButton = createElement('button', 'resource-action', '下载');
    openButton.type = 'button';
    openButton.addEventListener('click', () => downloadResource(resource));
    const editButton = createElement('button', 'resource-action', '编辑');
    editButton.type = 'button';
    editButton.addEventListener('click', () => openEditModal(resource));
    const deleteButton = createElement('button', 'resource-action danger', '删除');
    deleteButton.type = 'button';
    deleteButton.addEventListener('click', () => deleteResource(resource));
    actions.append(openButton, editButton, deleteButton);
    actionCell.append(actions);

    row.append(mainCell, categoryCell, formatCell, sizeCell, timeCell, actionCell);
    return row;
  }

  function renderTable() {
    const filtered = filteredResources();
    const fragment = document.createDocumentFragment();
    for (const resource of filtered) fragment.append(createResourceRow(resource));
    elements.rows.replaceChildren(fragment);
    elements.loading.hidden = true;
    elements.table.hidden = filtered.length === 0;
    elements.empty.hidden = filtered.length !== 0;

    if (filtered.length === 0) {
      const hasFilter = Boolean(state.query.trim() || state.category);
      elements.emptyTitle.textContent = hasFilter ? '没有匹配的资源' : '还没有教学资源';
      elements.emptyCopy.textContent = hasFilter
        ? '试试更换关键词或分类。'
        : '上传第一份讲义、课件或作业资料，学生就能在小程序「资源」中查看。';
      elements.emptyUpload.hidden = hasFilter;
      elements.emptyReset.hidden = !hasFilter;
    }
    renderSummary();
  }

  async function loadResources() {
    state.loading = true;
    elements.loading.hidden = false;
    elements.empty.hidden = true;
    try {
      const data = await api('/api/admin/resources');
      state.resources = Array.isArray(data.resources) ? data.resources : [];
      state.categories =
        Array.isArray(data.categories) && data.categories.length
          ? data.categories
          : DEFAULT_CATEGORIES;
      state.maxSizeMb = data.maxSizeMb || 30;
      elements.maxFileSize.textContent = `${state.maxSizeMb} MB`;
      fillCategorySelect(elements.categoryFilter, true);
      fillCategorySelect(elements.category, false);
      elements.pageSubtitle.textContent = state.resources.length
        ? `共 ${state.resources.length} 份资源，学生在小程序「资源」中浏览。`
        : '管理讲义、课件和练习资料，学生在小程序「资源」中浏览。';
      renderTable();
    } catch (error) {
      if (state.token) showToast(error.message, 'error');
    } finally {
      state.loading = false;
      elements.loading.hidden = true;
    }
  }

  async function downloadResource(resource) {
    try {
      const response = await fetch(`/api/admin/resources/${encodeURIComponent(resource.id)}/file`, {
        headers: {
          Authorization: `Bearer ${state.token}`,
        },
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        let message = `下载失败（HTTP ${response.status}）`;
        try {
          const payload = await response.json();
          message = payload?.error?.message || message;
        } catch {
          // keep generic message
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = resource.fileName || `${resource.title}.${resource.extension}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function resetFileInput() {
    elements.file.value = '';
    elements.fileDropTitle.textContent = '点击选择文件';
    elements.fileDropCopy.textContent = '支持 .ppt、.pptx、.doc、.docx、.pdf';
    elements.currentFile.hidden = true;
  }

  function openModal() {
    elements.modalBackdrop.hidden = false;
    elements.modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      elements.modal.classList.add('is-open');
      elements.modalBackdrop.classList.add('is-open');
    });
    document.body.style.overflow = 'hidden';
    setTimeout(() => elements.title.focus(), 120);
  }

  function closeModal() {
    elements.modal.classList.remove('is-open');
    elements.modalBackdrop.classList.remove('is-open');
    elements.modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    setTimeout(() => {
      if (!elements.modal.classList.contains('is-open')) {
        elements.modalBackdrop.hidden = true;
      }
    }, 220);
  }

  function openCreateModal() {
    state.editingId = null;
    elements.modalTitle.textContent = '上传资源';
    elements.form.reset();
    elements.requiredMark.hidden = false;
    elements.formError.textContent = '';
    resetFileInput();
    fillCategorySelect(elements.category, false);
    elements.save.textContent = '保存资源';
    openModal();
  }

  function openEditModal(resource) {
    state.editingId = resource.id;
    elements.modalTitle.textContent = '编辑资源';
    elements.title.value = resource.title;
    fillCategorySelect(elements.category, false);
    elements.category.value = resource.category;
    elements.description.value = resource.description || '';
    elements.requiredMark.hidden = true;
    elements.formError.textContent = '';
    resetFileInput();
    elements.currentFile.textContent = `当前文件：${resource.fileName}（不选择新文件则保留）`;
    elements.currentFile.hidden = false;
    elements.save.textContent = '保存修改';
    openModal();
  }

  function validateSelectedFile(file) {
    if (!file) return false;
    const extension = extensionOf(file.name);
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      elements.formError.textContent = '只支持 PPT、Word（doc/docx）和 PDF 文件';
      elements.file.value = '';
      resetFileInput();
      return false;
    }
    if (file.size > state.maxSizeMb * 1024 * 1024) {
      elements.formError.textContent = `文件不能超过 ${state.maxSizeMb} MB`;
      elements.file.value = '';
      resetFileInput();
      return false;
    }
    elements.fileDropTitle.textContent = file.name;
    elements.fileDropCopy.textContent = `${formatSize(file.size)} · 已选择新文件`;
    elements.formError.textContent = '';
    return true;
  }

  async function submitResource(event) {
    event.preventDefault();
    if (state.submitting) return;
    const title = elements.title.value.trim();
    const category = elements.category.value;
    const description = elements.description.value.trim();
    const file = elements.file.files?.[0];
    elements.formError.textContent = '';

    if (!title) {
      elements.formError.textContent = '请填写资源标题';
      elements.title.focus();
      return;
    }
    if (!category) {
      elements.formError.textContent = '请选择资源分类';
      elements.category.focus();
      return;
    }
    if (!state.editingId && !file) {
      elements.formError.textContent = '请选择要上传的文件';
      return;
    }
    if (file && !validateSelectedFile(file)) return;

    const data = new FormData();
    data.append('title', title);
    data.append('category', category);
    data.append('description', description);
    if (file) data.append('file', file);

    state.submitting = true;
    elements.save.disabled = true;
    elements.save.classList.add('is-loading');
    const originalText = elements.save.textContent;
    elements.save.textContent = '保存中…';
    try {
      const path = state.editingId
        ? `/api/admin/resources/${encodeURIComponent(state.editingId)}`
        : '/api/admin/resources';
      const response = await fetch(path, {
        method: state.editingId ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${state.token}`,
        },
        body: data,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        throw new Error(payload?.error?.message || `保存失败（HTTP ${response.status}）`);
      }
      closeModal();
      showToast(state.editingId ? '资源已更新' : '资源已上传');
      await loadResources();
    } catch (error) {
      elements.formError.textContent = error.message;
    } finally {
      state.submitting = false;
      elements.save.disabled = false;
      elements.save.classList.remove('is-loading');
      elements.save.textContent = originalText === '保存中…' ? '保存资源' : originalText;
    }
  }

  async function deleteResource(resource) {
    if (!window.confirm(`确定删除「${resource.title}」吗？删除后学生将无法看到该资源。`)) {
      return;
    }
    try {
      await api(`/api/admin/resources/${encodeURIComponent(resource.id)}`, {
        method: 'DELETE',
      });
      showToast('资源已删除');
      await loadResources();
    } catch (error) {
      if (state.token) showToast(error.message, 'error');
    }
  }

  function resetFilters() {
    state.query = '';
    state.category = '';
    elements.search.value = '';
    elements.categoryFilter.value = '';
    renderTable();
  }

  function bindEvents() {
    elements.uploadButton.addEventListener('click', openCreateModal);
    elements.emptyUpload.addEventListener('click', openCreateModal);
    elements.emptyReset.addEventListener('click', resetFilters);
    elements.logoutButton.addEventListener('click', () => {
      sessionStorage.removeItem(TOKEN_KEY);
      window.location.href = '/admin';
    });
    elements.search.addEventListener('input', () => {
      state.query = elements.search.value;
      renderTable();
    });
    elements.categoryFilter.addEventListener('change', () => {
      state.category = elements.categoryFilter.value;
      renderTable();
    });
    elements.modalClose.addEventListener('click', closeModal);
    elements.modalBackdrop.addEventListener('click', closeModal);
    elements.cancel.addEventListener('click', closeModal);
    elements.form.addEventListener('submit', submitResource);
    elements.file.addEventListener('change', () => {
      const file = elements.file.files?.[0];
      if (file) validateSelectedFile(file);
      else resetFileInput();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && elements.modal.classList.contains('is-open')) {
        closeModal();
      }
    });
  }

  async function init() {
    bindEvents();
    fillCategorySelect(elements.categoryFilter, true);
    fillCategorySelect(elements.category, false);
    if (!state.token) {
      showGate();
      return;
    }
    showApp();
    await loadResources();
  }

  init();
})();
