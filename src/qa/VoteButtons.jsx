import { cx } from '../cx.js';
import { Button } from '../Button.jsx';
import { ArrowUpIcon, ArrowDownIcon } from '../icons.jsx';

/**
 * Up / score / down. Clicking the vote you already gave takes it back.
 *   <VoteButtons score={3} value={1} onVote={(next) => save(next)} />
 * value is -1, 0 or 1; onVote gets the new value. With disabled the score still
 * shows; disabledReason becomes the buttons' tooltip ("Sign in to vote"). busy
 * ignores clicks while a vote is being saved, so a double click can't send it twice.
 */
export function VoteButtons({ score = 0, value = 0, onVote, disabled = false, disabledReason, busy = false, label = 'post', className = '' }) {
  const click = (dir) => { if (!busy) onVote?.(value === dir ? 0 : dir); };
  const btn = (dir, Icon, word) => (
    <Button
      variant="ghost"
      icon={Icon}
      label={`${word} this ${label}`}
      className={cx('mk-qa-vote-btn', value === dir && 'mk-qa-vote-on')}
      aria-pressed={value === dir}
      aria-disabled={busy || undefined}
      title={disabled ? disabledReason || undefined : `${word} this ${label}`}
      disabled={disabled}
      onClick={() => click(dir)}
    />
  );
  return (
    <div className={cx('mk-qa-vote', className)} role="group" aria-label={`Votes for this ${label}`}>
      {btn(1, ArrowUpIcon, 'Upvote')}
      <span className="mk-qa-vote-score" aria-live="polite"><span className="mk-sr-only">Score </span>{score}</span>
      {btn(-1, ArrowDownIcon, 'Downvote')}
    </div>
  );
}

export default VoteButtons;
