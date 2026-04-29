const filenameLanguageOverrides: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

function getLanguageFromPath(path: string | null | undefined) {
  const filename = path?.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (!filename) {
    return '';
  }

  const override = filenameLanguageOverrides[filename];
  if (override) {
    return override;
  }

  const extension = filename.includes('.') ? filename.split('.').pop() : '';
  return extension ?? '';
}

export { getLanguageFromPath };
