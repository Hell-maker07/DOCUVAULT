-- Reference data every deployment needs. Idempotent: safe to run repeatedly.
INSERT INTO classification_levels (level, name) VALUES
  (1, 'Public'), (2, 'Internal'), (3, 'Confidential'), (4, 'Restricted')
ON CONFLICT (level) DO NOTHING;

INSERT INTO permissions (code, description) VALUES
  ('VIEW',       'Open metadata and download files'),
  ('UPLOAD',     'Create a document (version 1) in a workspace'),
  ('EDIT',       'Add a new version to a document'),
  ('SIGN',       'Sign a specific version'),
  ('SHARE',      'Give another user time-limited access to one document'),
  ('AUDIT',      'Read the audit log and run integrity checks across the organisation'),
  ('MANAGE_ORG', 'Manage departments, positions and users')
ON CONFLICT (code) DO NOTHING;
-- There is deliberately no DELETE permission: records are superseded, never destroyed.
