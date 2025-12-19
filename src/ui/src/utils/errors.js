/**
 * 错误分类工具
 * 统一处理 API 错误，避免到处使用字符串匹配
 */

export const ErrorType = {
  NOT_FOUND: 'NOT_FOUND',         // 资源不存在（文件夹/文档被删除）
  SERVER_ERROR: 'SERVER_ERROR',   // 服务器错误
  NETWORK_ERROR: 'NETWORK_ERROR', // 网络错误
  UNKNOWN: 'UNKNOWN',             // 未知错误
};

/**
 * 从错误对象中提取错误类型
 * @param {Error|string|any} err - 错误对象
 * @returns {string} ErrorType 枚举值
 */
export function classifyError(err) {
  if (!err) return ErrorType.UNKNOWN;
  
  const message = String(err?.message || err || '').toLowerCase();
  const status = err?.status || err?.statusCode;
  
  // 优先检查 HTTP 状态码（如果后端返回了结构化错误）
  if (status === 404) return ErrorType.NOT_FOUND;
  if (status >= 500) return ErrorType.SERVER_ERROR;
  
  // 回退到消息匹配（兼容当前后端）
  if (
    message.includes('does not exist') ||
    message.includes('not found') ||
    message.includes('no such file') ||
    message.includes('enoent')
  ) {
    return ErrorType.NOT_FOUND;
  }
  
  if (message.includes('500') || message.includes('internal server error')) {
    return ErrorType.SERVER_ERROR;
  }
  
  if (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connection')
  ) {
    return ErrorType.NETWORK_ERROR;
  }
  
  return ErrorType.UNKNOWN;
}

/**
 * 检查是否是"资源不存在"类型的错误
 * @param {Error|string|any} err - 错误对象
 * @returns {boolean}
 */
export function isNotFoundError(err) {
  const type = classifyError(err);
  // 500 错误通常也意味着资源访问失败（后端在访问不存在的资源时可能抛出 500）
  return type === ErrorType.NOT_FOUND || type === ErrorType.SERVER_ERROR;
}

/**
 * 检查是否是可恢复的临时错误（如网络问题）
 * @param {Error|string|any} err - 错误对象
 * @returns {boolean}
 */
export function isTransientError(err) {
  return classifyError(err) === ErrorType.NETWORK_ERROR;
}

