/* @mn/blocks/editor: the rich text editor. Kept out of src/index.js so apps that
   never edit rich text never load Tiptap. Needs @tiptap/react, @tiptap/pm and
   @tiptap/starter-kit installed by the app (optional peer dependencies). */
export { RichTextEditor, DEFAULT_TOOLBAR, LINK_PROTOCOLS, editorExtensions } from './RichTextEditor.jsx';
export { RichText } from './RichText.jsx';
export { RichTextField } from './RichTextField.jsx';
export { isBlankHtml, sameHtml, htmlToText, toRichHtml, looksLikeHtml, HTML_TAG } from './value.js';
