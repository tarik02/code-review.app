"use no memo";

import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useFloating,
  type VirtualElement,
} from "@floating-ui/react";
import {
  activeEditor$,
  cancelLinkEdit$,
  editorRootElementRef$,
  linkDialogState$,
  onWindowChange$,
  removeLink$,
  switchFromPreviewToLinkEdit$,
  updateLink$,
} from "@mdxeditor/editor";
import { useCellValues, usePublisher } from "@mdxeditor/gurx";
import { Check, Copy, Link2Off } from "lucide-react";
import { $createTextNode, $getNodeByKey, type LexicalNode } from "lexical";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
} from "react";
import { Button } from "../button";
import { Input } from "../input";

type LinkLikeNode = LexicalNode & {
  setTitle: (title: string) => void;
  setURL: (url: string) => void;
};

function isLinkLikeNode(node: LexicalNode | null | undefined): node is LinkLikeNode {
  return (
    Boolean(node) &&
    typeof (node as Partial<LinkLikeNode>).setURL === "function" &&
    typeof (node as Partial<LinkLikeNode>).setTitle === "function"
  );
}

function ReviewCommentLinkDialog() {
  const [editorRootElementRef, activeEditor, linkDialogState] = useCellValues(
    editorRootElementRef$,
    activeEditor$,
    linkDialogState$,
  );
  const publishWindowChange = usePublisher(onWindowChange$);
  const publishLinkDialogState = usePublisher(linkDialogState$);
  const updateLink = usePublisher(updateLink$);
  const removeLink = usePublisher(removeLink$);
  const cancelLinkEdit = usePublisher(cancelLinkEdit$);
  const switchFromPreviewToLinkEdit = usePublisher(switchFromPreviewToLinkEdit$);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const inputId = useId();
  const formRef = useRef<HTMLFormElement | null>(null);
  const blurCommitFrameRef = useRef<number | null>(null);
  const previousStateKeyRef = useRef("");
  const middleware = useMemo(() => [offset(6), flip({ padding: 12 }), shift({ padding: 12 })], []);
  const { floatingStyles, refs, update } = useFloating({
    middleware,
    placement: "bottom-start",
    strategy: "absolute",
    whileElementsMounted: autoUpdate,
  });

  const stateKey =
    linkDialogState.type === "inactive"
      ? "inactive"
      : `${linkDialogState.type}:${linkDialogState.linkNodeKey}:${linkDialogState.url}`;

  useEffect(() => {
    if (linkDialogState.type === "inactive") {
      return;
    }

    const { height, left, top, width } = linkDialogState.rectangle;
    const virtualReference: VirtualElement = {
      contextElement: editorRootElementRef?.current ?? undefined,
      getBoundingClientRect: () => ({
        bottom: top + height,
        height,
        left,
        right: left + width,
        top,
        width,
        x: left,
        y: top,
      }),
    };

    refs.setReference(virtualReference);
    void update();
  }, [editorRootElementRef, linkDialogState, refs, update]);

  useEffect(() => {
    if (linkDialogState.type === "inactive") {
      previousStateKeyRef.current = stateKey;
      return;
    }

    if (previousStateKeyRef.current !== stateKey) {
      setUrl(linkDialogState.url);
      setCopied(false);
      previousStateKeyRef.current = stateKey;
    }
  }, [linkDialogState, stateKey]);

  useEffect(() => {
    const updatePosition = () => {
      activeEditor?.getEditorState().read(() => {
        publishWindowChange(true);
      });
    };

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [activeEditor, publishWindowChange]);

  useEffect(() => {
    return () => {
      if (blurCommitFrameRef.current !== null) {
        window.cancelAnimationFrame(blurCommitFrameRef.current);
      }
    };
  }, []);

  if (linkDialogState.type === "inactive") {
    return <></>;
  }

  const title = linkDialogState.title ?? "";
  const canCopy = url.trim().length > 0;
  const canUnlink = (linkDialogState.linkNodeKey ?? "").length > 0;
  const popoverStyle = {
    ...floatingStyles,
    pointerEvents: "auto",
    zIndex: 2147483647,
  } satisfies CSSProperties;

  function refreshLinkDialogPosition() {
    window.setTimeout(() => {
      activeEditor?.getEditorState().read(() => {
        publishWindowChange(true);
      });
    });
  }

  function clearScheduledBlurCommit() {
    if (blurCommitFrameRef.current === null) {
      return;
    }

    window.cancelAnimationFrame(blurCommitFrameRef.current);
    blurCommitFrameRef.current = null;
  }

  function closeLinkDialog() {
    publishLinkDialogState({ type: "inactive" });
  }

  function commitUrl(nextUrl = url, options: { closeDialog?: boolean } = {}) {
    const trimmedUrl = nextUrl.trim();

    if (!trimmedUrl && linkDialogState.type === "edit") {
      cancelLinkEdit();
      return;
    }

    if (!trimmedUrl) {
      return;
    }

    if (linkDialogState.linkNodeKey) {
      activeEditor?.update(
        () => {
          const node = $getNodeByKey(linkDialogState.linkNodeKey);

          if (isLinkLikeNode(node)) {
            node.setURL(trimmedUrl);
            node.setTitle(title);
          }
        },
        { discrete: true },
      );
      if (options.closeDialog) {
        closeLinkDialog();
      } else {
        refreshLinkDialogPosition();
      }
      return;
    }

    updateLink({
      text: undefined,
      title,
      url: trimmedUrl,
    });

    if (options.closeDialog) {
      closeLinkDialog();
    }
  }

  function scheduleBlurCommit(event: FocusEvent<HTMLInputElement>) {
    const nextFocusedElement = event.relatedTarget;

    if (nextFocusedElement instanceof Node && formRef.current?.contains(nextFocusedElement)) {
      return;
    }

    const nextUrl = event.currentTarget.value;

    clearScheduledBlurCommit();
    blurCommitFrameRef.current = window.requestAnimationFrame(() => {
      blurCommitFrameRef.current = null;
      commitUrl(nextUrl, { closeDialog: true });
    });
  }

  function handleCopy() {
    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      return;
    }

    void window.navigator.clipboard.writeText(trimmedUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    });
  }

  function handleUnlink() {
    if (!canUnlink) {
      return;
    }

    let unlinked = false;

    activeEditor?.update(
      () => {
        const node = $getNodeByKey(linkDialogState.linkNodeKey ?? "");

        if (node) {
          node.replace($createTextNode(node.getTextContent()));
          unlinked = true;
        }
      },
      { discrete: true },
    );

    if (unlinked) {
      refreshLinkDialogPosition();
      return;
    }

    removeLink();
  }

  return (
    <FloatingPortal>
      <form
        ref={(node) => {
          formRef.current = node;
          refs.setFloating(node);
        }}
        className="rudu-comment-editor-link-popover"
        style={popoverStyle}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          clearScheduledBlurCommit();
          commitUrl();
        }}
        onReset={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (linkDialogState.type === "edit") {
            cancelLinkEdit();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && linkDialogState.type === "edit") {
            event.stopPropagation();
            cancelLinkEdit();
          }
        }}
      >
        <label className="sr-only" htmlFor={inputId}>
          Link target
        </label>
        <Input
          id={inputId}
          className="h-7 flex-1 rounded-md bg-canvas text-[0.8125rem]"
          value={url}
          placeholder="Paste link target"
          onBlur={scheduleBlurCommit}
          onChange={(event) => setUrl(event.target.value)}
          onFocus={() => {
            if (linkDialogState.type === "preview") {
              switchFromPreviewToLinkEdit();
            }
          }}
        />
        <Button
          aria-label={copied ? "Copied link target" : "Copy link target"}
          disabled={!canCopy}
          size="icon-sm"
          title={copied ? "Copied" : "Copy link target"}
          type="button"
          variant="ghost"
          onClick={handleCopy}
          onMouseDown={(event) => event.preventDefault()}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <Button
          aria-label="Unlink"
          disabled={!canUnlink}
          size="icon-sm"
          title="Unlink"
          type="button"
          variant="ghost"
          onClick={handleUnlink}
          onMouseDown={(event) => event.preventDefault()}
        >
          <Link2Off className="size-4" />
        </Button>
      </form>
    </FloatingPortal>
  );
}

export { ReviewCommentLinkDialog };
