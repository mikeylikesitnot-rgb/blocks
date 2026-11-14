/* Toolbar icons, same 24px / 2px-stroke grid as src/icons.jsx (shapes follow lucide). */
const base = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
};
const make = (d) => function Icon({ className = '', ...p }) {
  return <svg {...base} className={`mk-icon ${className}`} {...p}>{d}</svg>;
};

export const UndoIcon = make(<path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />);
export const RedoIcon = make(<path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />);
export const BoldIcon = make(<path d="M6 12h9a4 4 0 0 1 0 8H6V4h8a4 4 0 0 1 0 8" />);
export const ItalicIcon = make(<path d="M19 4h-9M14 20H5M15 4 9 20" />);
export const UnderlineIcon = make(<path d="M6 4v6a6 6 0 0 0 12 0V4M4 20h16" />);
export const StrikeIcon = make(<path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16" />);
export const LinkIcon = make(<path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8" />);
export const BulletListIcon = make(<path d="M3 6h.01M3 12h.01M3 18h.01M8 6h13M8 12h13M8 18h13" />);
export const OrderedListIcon = make(<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />);
export const QuoteIcon = make(<path d="M10 7H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3v1a3 3 0 0 1-3 3M20 7h-4a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3v1a3 3 0 0 1-3 3" />);
export const CodeBlockIcon = make(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m10 9-3 3 3 3M14 15l3-3-3-3" /></>);
export const PencilIcon = make(<path d="M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8L2 21.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z" />);
