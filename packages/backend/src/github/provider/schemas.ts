import type { PrChangedFile } from '@code-review-app/shared';
import type { GhChangedFile, GraphQlResponse } from '../client/schemas.ts';

function toChangedFile(item: GhChangedFile): PrChangedFile {
  const filename = item.filename.trim();
  const previousFilename = item.previous_filename?.trim() || filename;

  if (item.status === 'added') {
    return {
      path: filename,
      oldPath: '',
      newPath: filename,
      changeType: 'new',
    };
  }

  if (item.status === 'removed') {
    return {
      path: filename,
      oldPath: filename,
      newPath: '',
      changeType: 'deleted',
    };
  }

  if (item.status === 'renamed') {
    return {
      path: filename,
      oldPath: previousFilename,
      newPath: filename,
      changeType: item.changes === 0 ? 'rename-pure' : 'rename-changed',
    };
  }

  return {
    path: filename,
    oldPath: filename,
    newPath: filename,
    changeType: 'change',
  };
}

function firstGraphQlErrorMessage(response: GraphQlResponse<unknown>) {
  return response.errors?.find((error) => error.message.trim())?.message.trim() ?? null;
}

export { firstGraphQlErrorMessage, toChangedFile };
