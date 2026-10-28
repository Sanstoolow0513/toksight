import { cx } from './cx';
import Badge from './Badge';

// A plate: hairline frame with registration ticks and an optional head
// (icon, title, an inline `sub` beside the title, a `note` under it, count
// badge, actions). Subs and notes are for information the reader needs, not
// decoration.
export default function Panel({ as: Tag = 'section', icon, title, sub, note, count, actions, level = 3, titleProps, headClassName, className, children, ...rest }) {
  const Heading = `h${level}`;
  return <Tag className={cx('plate', className)} {...rest}>
    {title != null ? <header className={cx('plate-head', headClassName)}>
      <div className="plate-heading">
        {sub ? <div className="plate-title-line"><Heading className="plate-title" {...titleProps}>{icon}{title}</Heading><span className="plate-sub">{sub}</span></div>
          : <Heading className="plate-title" {...titleProps}>{icon}{title}</Heading>}
        {note ? <p className="plate-note">{note}</p> : null}
      </div>
      {count != null || actions ? <div className="plate-tools">{count != null ? <Badge>{count}</Badge> : null}{actions}</div> : null}
    </header> : null}
    {children}
  </Tag>;
}
