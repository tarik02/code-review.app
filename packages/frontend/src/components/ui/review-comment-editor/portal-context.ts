import { createContext, useContext } from 'react';

const ReviewCommentEditorPortalContext = createContext<HTMLElement | null>(null);

function useReviewCommentEditorPortalContainer() {
  return useContext(ReviewCommentEditorPortalContext);
}

export { ReviewCommentEditorPortalContext, useReviewCommentEditorPortalContainer };
