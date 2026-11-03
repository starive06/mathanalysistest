export const SCHEMA_VERSION = 4;

export const CREATE_MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT UNSIGNED NOT NULL,
    applied_at DATETIME(3) NOT NULL,
    PRIMARY KEY (version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

/**
 * 按版本增量执行。不要修改已经发布过的 migration；需要变更时追加新版本。
 */
export const MIGRATIONS = [
  {
    version: 1,
    statements: [
      `
        CREATE TABLE IF NOT EXISTS students (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          owner_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          alias_code CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          created_at DATETIME(3) NOT NULL,
          last_seen_at DATETIME(3) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_students_owner_hash (owner_hash),
          KEY idx_students_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
      `
        CREATE TABLE IF NOT EXISTS questions (
          id VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          student_id BIGINT UNSIGNED NOT NULL,
          question TEXT NOT NULL,
          answer MEDIUMTEXT NULL,
          model VARCHAR(80) NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'answered',
          prompt_tokens INT UNSIGNED NULL,
          completion_tokens INT UNSIGNED NULL,
          latency_ms INT UNSIGNED NULL,
          created_at DATETIME(3) NOT NULL,
          deleted_at DATETIME(3) NULL,
          PRIMARY KEY (id),
          KEY idx_questions_student_created (student_id, created_at),
          KEY idx_questions_created (created_at),
          KEY idx_questions_deleted_created (deleted_at, created_at),
          CONSTRAINT fk_questions_student
            FOREIGN KEY (student_id) REFERENCES students (id)
            ON UPDATE CASCADE ON DELETE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
      `
        CREATE TABLE IF NOT EXISTS likes (
          question_id VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          student_id BIGINT UNSIGNED NOT NULL,
          created_at DATETIME(3) NOT NULL,
          PRIMARY KEY (question_id, student_id),
          KEY idx_likes_student (student_id),
          KEY idx_likes_created (created_at),
          CONSTRAINT fk_likes_question
            FOREIGN KEY (question_id) REFERENCES questions (id)
            ON UPDATE CASCADE ON DELETE CASCADE,
          CONSTRAINT fk_likes_student
            FOREIGN KEY (student_id) REFERENCES students (id)
            ON UPDATE CASCADE ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
      `
        CREATE TABLE IF NOT EXISTS backup_runs (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          provider VARCHAR(24) NOT NULL,
          status VARCHAR(20) NOT NULL,
          reason VARCHAR(24) NOT NULL,
          object_key VARCHAR(512) NULL,
          local_path VARCHAR(512) NULL,
          size_bytes BIGINT UNSIGNED NULL,
          error_message VARCHAR(500) NULL,
          created_at DATETIME(3) NOT NULL,
          PRIMARY KEY (id),
          KEY idx_backup_runs_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
    ],
  },
  {
    version: 3,
    statements: [
      `
        ALTER TABLE students
          ADD COLUMN mini_openid VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
          ADD UNIQUE KEY uq_students_mini_openid (mini_openid)
      `,
      `
        CREATE TABLE IF NOT EXISTS teachers (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          email VARCHAR(254) NOT NULL,
          password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          name VARCHAR(80) NOT NULL,
          public_id VARCHAR(40) NOT NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_teachers_email (email),
          UNIQUE KEY uq_teachers_public_id (public_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
      `
        CREATE TABLE IF NOT EXISTS teacher_sessions (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          teacher_id BIGINT UNSIGNED NOT NULL,
          token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          created_at DATETIME(3) NOT NULL,
          expires_at DATETIME(3) NOT NULL,
          last_used_at DATETIME(3) NOT NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_teacher_sessions_token (token_hash),
          KEY idx_teacher_sessions_teacher (teacher_id),
          KEY idx_teacher_sessions_expires (expires_at),
          CONSTRAINT fk_teacher_sessions_teacher
            FOREIGN KEY (teacher_id) REFERENCES teachers (id)
            ON UPDATE CASCADE ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
      `
        CREATE TABLE IF NOT EXISTS question_comments (
          id VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          question_id VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          author_type VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          student_owner_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
          teacher_id BIGINT UNSIGNED NULL,
          author_name VARCHAR(80) NOT NULL,
          author_public_id VARCHAR(40) NULL,
          content TEXT NOT NULL,
          created_at DATETIME(3) NOT NULL,
          deleted_at DATETIME(3) NULL,
          PRIMARY KEY (id),
          KEY idx_question_comments_question (question_id, created_at),
          KEY idx_question_comments_teacher (teacher_id),
          CONSTRAINT fk_question_comments_question
            FOREIGN KEY (question_id) REFERENCES questions (id)
            ON UPDATE CASCADE ON DELETE CASCADE,
          CONSTRAINT fk_question_comments_teacher
            FOREIGN KEY (teacher_id) REFERENCES teachers (id)
            ON UPDATE CASCADE ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
      `
        CREATE TABLE IF NOT EXISTS comment_likes (
          comment_id VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          actor_type VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          actor_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          created_at DATETIME(3) NOT NULL,
          PRIMARY KEY (comment_id, actor_type, actor_hash),
          KEY idx_comment_likes_created (created_at),
          CONSTRAINT fk_comment_likes_comment
            FOREIGN KEY (comment_id) REFERENCES question_comments (id)
            ON UPDATE CASCADE ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
      `
        CREATE TABLE IF NOT EXISTS push_notifications (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          comment_id VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          student_owner_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          channel VARCHAR(20) NOT NULL,
          status VARCHAR(20) NOT NULL,
          error_message VARCHAR(500) NULL,
          created_at DATETIME(3) NOT NULL,
          sent_at DATETIME(3) NULL,
          PRIMARY KEY (id),
          UNIQUE KEY uq_push_comment_channel (comment_id, student_owner_hash, channel),
          KEY idx_push_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
    ],
  },
  {
    version: 4,
    statements: [
      `
        ALTER TABLE questions
          ADD COLUMN image_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NULL,
          ADD COLUMN image_mime VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
          ADD COLUMN image_provider VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
          ADD COLUMN image_token CHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
          ADD COLUMN image_size_bytes BIGINT UNSIGNED NULL,
          ADD UNIQUE KEY uq_questions_image_token (image_token)
      `,
    ],
  },
  {
    version: 2,
    statements: [
      `
        CREATE TABLE IF NOT EXISTS resources (
          id VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          title VARCHAR(200) NOT NULL,
          category VARCHAR(32) NOT NULL,
          description VARCHAR(1000) NULL,
          file_name VARCHAR(255) NOT NULL,
          extension VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          mime_type VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          size_bytes BIGINT UNSIGNED NOT NULL,
          storage_provider VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          storage_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          created_at DATETIME(3) NOT NULL,
          updated_at DATETIME(3) NOT NULL,
          deleted_at DATETIME(3) NULL,
          PRIMARY KEY (id),
          KEY idx_resources_category_updated (category, updated_at),
          KEY idx_resources_updated (updated_at),
          KEY idx_resources_deleted (deleted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
    ],
  },
];

// 保持按版本号执行；后续新增迁移时直接追加，避免顺序依赖。
MIGRATIONS.sort((a, b) => a.version - b.version);

export const SCHEMA_STATEMENTS = MIGRATIONS.flatMap((migration) => migration.statements);
