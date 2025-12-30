const { ensureSchema } = require('./db/migrations');
const { SCHEMA_STATEMENTS } = require('./db/schema');
const { generateStableId } = require('./utils/uuid');
const { joinPath, resolveDocPaths } = require('./utils/paths');

module.exports = {
  ensureSchema,
  SCHEMA_STATEMENTS,
  generateStableId,
  joinPath,
  resolveDocPaths,
};
