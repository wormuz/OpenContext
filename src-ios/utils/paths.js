function joinPath(...parts) {
  return parts
    .filter((part) => typeof part === 'string' && part.length > 0)
    .map((part, index) => {
      if (index === 0) {
        return part.replace(/\/+$/g, '');
      }
      return part.replace(/^\/+/g, '').replace(/\/+$/g, '');
    })
    .join('/');
}

function resolveDocPaths({ documentsRoot, relPath }) {
  const safeRelPath = String(relPath || '').replace(/^\/+/g, '');
  const absPath = joinPath(documentsRoot, safeRelPath);
  return {
    relPath: safeRelPath,
    absPath,
  };
}

module.exports = {
  joinPath,
  resolveDocPaths,
};
