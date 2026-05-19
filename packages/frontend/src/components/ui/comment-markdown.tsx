import { memo, useEffect, useState, type ComponentProps } from 'react';
import Markdown, { RuleType } from 'markdown-to-jsx';
import { codeToHtml, type BundledLanguage } from 'shiki';
import type { ThemeRegistrationResolved } from '@shikijs/types';
import pierreDarkTheme from '@pierre/theme/pierre-dark';
import pierreLightTheme from '@pierre/theme/pierre-light';
import { useDocumentDarkMode } from '../../hooks/use-document-dark-mode';
import { ScrollArea } from './scroll-area';
import { getLanguageFromPath } from './review-comment-editor/language';
import './comment-markdown.css';

const CODE_THEME = {
  dark: { id: 'pierre-dark', theme: toShikiTheme(pierreDarkTheme) },
  light: { id: 'pierre-light', theme: toShikiTheme(pierreLightTheme) },
} as const;

const codeHtmlCache = new Map<string, Promise<string>>();

function toShikiTheme(theme: typeof pierreDarkTheme): ThemeRegistrationResolved {
  const semanticTokenColors = Object.fromEntries(
    Object.entries(theme.semanticTokenColors).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

  return {
    ...theme,
    settings: theme.tokenColors.map((token) => ({
      ...token,
      settings: { ...token.settings },
    })),
    tokenColors: theme.tokenColors.map((token) => ({
      ...token,
      settings: { ...token.settings },
    })),
    semanticTokenColors,
    fg: theme.colors['editor.foreground'] ?? theme.colors.foreground ?? '#000000',
    bg: theme.colors['editor.background'] ?? '#ffffff',
  };
}

function normalizeLanguage(language: string | undefined) {
  if (!language) return 'text';

  switch (language.toLowerCase()) {
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'sh':
    case 'shell':
      return 'bash';
    default:
      return language.toLowerCase();
  }
}

function getCodeBlockLanguage(language: string | undefined, filePath?: string) {
  if (language?.toLowerCase().startsWith('suggestion')) {
    return getLanguageFromPath(filePath) || 'text';
  }

  return language;
}

function getThemeEntry(isDark: boolean) {
  return isDark ? CODE_THEME.dark : CODE_THEME.light;
}

function InlineCode({ children, ...props }: ComponentProps<'code'>) {
  return (
    <code {...props} className="rounded bg-canvas px-1 py-0.5 font-mono text-[0.92em] text-ink-900">
      {children}
    </code>
  );
}

function MarkdownCodeBlock({
  filePath,
  lang,
  text,
}: {
  filePath?: string;
  lang?: string;
  text: string;
}) {
  const [resolvedHtml, setResolvedHtml] = useState<{ cacheKey: string; html: string } | null>(null);
  const isDark = useDocumentDarkMode();
  const normalizedLanguage = normalizeLanguage(getCodeBlockLanguage(lang, filePath));
  const themeEntry = getThemeEntry(isDark);
  const cacheKey = `${themeEntry.id}:${normalizedLanguage}:${text}`;

  useEffect(() => {
    let cancelled = false;

    let promise = codeHtmlCache.get(cacheKey);
    if (!promise) {
      promise = codeToHtml(text, {
        lang: normalizedLanguage as BundledLanguage,
        theme: themeEntry.theme,
      });
      codeHtmlCache.set(cacheKey, promise);
    }

    void promise
      .then((result) => {
        if (!cancelled) {
          setResolvedHtml({ cacheKey, html: result });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedHtml(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, normalizedLanguage, text, themeEntry.theme]);

  if (resolvedHtml?.cacheKey !== cacheKey) {
    return (
      <ScrollArea
        className="overflow-hidden rounded-lg border border-ink-200 bg-canvas"
        orientation="both"
        viewportClassName="max-h-80 bg-canvas"
      >
        <pre className="m-0 p-3 text-sm leading-6 text-ink-800">
          <code>{text}</code>
        </pre>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea
      className="overflow-hidden rounded-lg border border-ink-200 bg-canvas text-sm"
      orientation="both"
      viewportClassName="max-h-80 bg-canvas"
      contentClassName="[&_.shiki]:m-0 [&_.shiki]:bg-transparent! [&_.shiki]:p-3"
    >
      <div dangerouslySetInnerHTML={{ __html: resolvedHtml.html }} />
    </ScrollArea>
  );
}

const CommentMarkdown = memo(function CommentMarkdown({
  body,
  filePath,
}: {
  body: string;
  filePath?: string;
}) {
  return (
    <div className="comment-markdown font-sans whitespace-normal break-words">
      <Markdown
        options={{
          disableParsingRawHTML: true,
          renderRule(next, node) {
            if (node.type === RuleType.codeBlock) {
              return (
                <MarkdownCodeBlock
                  filePath={filePath}
                  lang={node.lang}
                  text={String(node.text ?? '')}
                />
              );
            }

            return next();
          },
          overrides: {
            a: {
              component: ({ children, ...props }) => (
                <a {...props} rel="noreferrer" target="_blank">
                  {children}
                </a>
              ),
            },
            code: { component: InlineCode },
            pre: {
              component: ({ children, ...props }) => (
                <div {...props} className="my-3">
                  {children}
                </div>
              ),
            },
          },
        }}
      >
        {body}
      </Markdown>
    </div>
  );
});

export { CommentMarkdown };
