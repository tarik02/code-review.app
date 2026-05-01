function getCommentPreviewText(body: string) {
  const previewText = body
    .replace(/\r\n?/g, '\n')
    .replace(/^```[^\n`]*\n?/gm, '')
    .replace(/^~~~[^\n~]*\n?/gm, '')
    .replace(/```|~~~/g, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, '$1')
    .replace(/<\/?[^>\s]+(?:\s+[^>]*)?>/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/~~([^~]*)~~/g, '$1')
    .replace(/(^|[\s([{])([*_]{1,3})(?=\S)(.+?\S)\2(?=[\s)\]}.,!?;:]|$)/g, '$1$3')
    .replace(/\s+/g, ' ')
    .trim();

  if (previewText.length === 0) {
    return previewText;
  }

  if (typeof document === 'undefined') {
    return previewText
      .replace(/&#x20;|&#32;|&nbsp;/gi, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  const textarea = document.createElement('textarea');
  textarea.innerHTML = previewText;
  return textarea.value;
}

export { getCommentPreviewText };
