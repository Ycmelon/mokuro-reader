import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true, // tables, strikethrough, autolinks — matches what models are trained to emit
  breaks: true // single newlines become <br>, since models don't reliably blank-line paragraphs
});

// Links in explanations often point out to references — open them in a new
// tab rather than navigating away from the reader. Done as a DOMPurify hook
// (not a marked renderer override) so it doesn't depend on marked's
// renderer API shape across versions.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Renders assistant markdown to sanitized HTML for `{@html}`. Model output
 * is untrusted, so this always goes through DOMPurify before reaching the DOM. */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text) as string;
  return DOMPurify.sanitize(html);
}
