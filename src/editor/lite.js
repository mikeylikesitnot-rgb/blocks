/* @mn/kit/editor/lite: everything that works without loading Tiptap up front.
   RichText renders a stored value; RichTextField loads the editor as its own
   chunk the first time it renders. Use this from bundles customers download. */
export { RichText } from './RichText.jsx';
export { RichTextField } from './RichTextField.jsx';
export { isBlankHtml, sameHtml, htmlToText, toRichHtml } from './value.js';
