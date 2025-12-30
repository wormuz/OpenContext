function formatDate(iso, locale = 'zh') {
  try {
    const date = new Date(iso);
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch (err) {
    return '';
  }
}

module.exports = {
  formatDate,
};
