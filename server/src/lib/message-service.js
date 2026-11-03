import crypto from 'node:crypto';

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function preview(value, max = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export class MessageService {
  constructor({ store, logger = console }) {
    this.store = store;
    this.logger = logger;
  }

  async createResourceNotice({ courseId, resource, actorName = '老师', action = 'published' }) {
    if (!courseId) return null;
    const title =
      action === 'updated'
        ? `${actorName} 更新了课程内容`
        : `${actorName} 发布了新的课程内容`;
    return this.store.createCourseNotice({
      id: makeId('notice'),
      courseId,
      type: action === 'updated' ? 'resource_updated' : 'resource',
      title,
      body: `${resource.title} · ${resource.category}`,
      resourceId: resource.id,
    });
  }

  async createCommentEvent({
    questionMeta,
    commentId,
    actorHash,
    actorName,
    content,
    teacher = false,
  }) {
    if (!questionMeta?.ownerHash || questionMeta.ownerHash === actorHash) return null;
    const title = teacher
      ? `${actorName} 回复了你的问题`
      : `${actorName} 评论了你的问题`;
    return this.store.createStudentEvent({
      id: makeId('event'),
      courseId: questionMeta.courseId,
      recipientHash: questionMeta.ownerHash,
      actorHash,
      type: teacher ? 'teacher_comment' : 'comment',
      title,
      body: preview(content),
      questionId: questionMeta.id,
      commentId,
    });
  }

  async createQuestionLikeEvent({ questionMeta, actorHash, actorName }) {
    if (!questionMeta?.ownerHash || questionMeta.ownerHash === actorHash) return null;
    return this.store.createStudentEvent({
      id: makeId('event'),
      courseId: questionMeta.courseId,
      recipientHash: questionMeta.ownerHash,
      actorHash,
      type: 'like_question',
      title: `${actorName} 赞了你的问题`,
      body: '',
      questionId: questionMeta.id,
    });
  }

  async createCommentLikeEvent({ commentMeta, actorHash, actorName }) {
    if (
      !commentMeta?.studentOwnerHash ||
      commentMeta.studentOwnerHash === actorHash ||
      commentMeta.authorType !== 'student'
    ) {
      return null;
    }
    return this.store.createStudentEvent({
      id: makeId('event'),
      courseId: commentMeta.courseId,
      recipientHash: commentMeta.studentOwnerHash,
      actorHash,
      type: 'like_comment',
      title: `${actorName} 赞了你的评论`,
      body: '',
      questionId: commentMeta.questionId,
      commentId: commentMeta.id,
    });
  }

  async list(ownerHash, { box = 'notice', limit = 30, offset = 0 } = {}) {
    return box === 'comment'
      ? this.store.listStudentEvents(ownerHash, { limit, offset })
      : this.store.listCourseNotices(ownerHash, { limit, offset });
  }

  async summary(ownerHash) {
    return this.store.messageSummary(ownerHash);
  }

  /**
   * 返回成功标记的数量。未知/不属于此学生的 id 会忽略。
   */
  async markRead(ownerHash, ids = []) {
    let count = 0;
    for (const id of ids) {
      if (!id) continue;
      if (id.startsWith('notice_')) {
        if (await this.store.markNoticeRead(ownerHash, id)) count += 1;
      } else if (id.startsWith('event_')) {
        if (await this.store.markStudentEventRead(ownerHash, id)) count += 1;
      }
    }
    return count;
  }

  async markAllRead(ownerHash, box) {
    if (box === 'notice') await this.store.markAllNoticesRead(ownerHash);
    else if (box === 'comment') await this.store.markAllStudentEventsRead(ownerHash);
    else {
      await this.store.markAllNoticesRead(ownerHash);
      await this.store.markAllStudentEventsRead(ownerHash);
    }
    return this.summary(ownerHash);
  }
}
