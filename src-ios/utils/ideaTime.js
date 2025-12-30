function formatDateKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(dateKey, t) {
  if (!dateKey) return t('time.today', 'Today');
  const today = formatDateKey(new Date());
  const yesterday = formatDateKey(new Date(Date.now() - 86400000));
  if (dateKey === today) return t('time.today', 'Today');
  if (dateKey === yesterday) return t('time.yesterday', 'Yesterday');
  try {
    const date = new Date(dateKey);
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  } catch (err) {
    return dateKey;
  }
}

function formatRelativeTime(dateStr, t) {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  if (!date) return '';
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  if (diffMins < 1) return t('time.justNow', 'Just now');
  if (diffMins < 60) return t('time.minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('time.hoursAgo', { count: diffHours });
  return formatDateDisplay(formatDateKey(dateStr), t);
}

module.exports = {
  formatDateKey,
  formatDateDisplay,
  formatRelativeTime,
};
