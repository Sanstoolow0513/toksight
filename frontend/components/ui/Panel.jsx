import { cx } from './cx';
import Badge from './Badge';

// A plate: hairline frame with registration ticks and an optional head
// (icon, title, optional note, count badge, actions). Notes are for
// information the reader needs, not decoration.
export default function Panel({ as: Tag = 'section', icon, title, note, count, actions, level = 3, titleProps, headClassName, className, children, ...rest }) {
  const Heading = `h${level}`;
  return <Tag className={cx('plate', className)} {...rest}>
    {title != null ? <header className={cx('plate-head', headClassName)}>
      <div className="plate-heading">
        <Heading className="plate-title" {...titleProps}>{icon}{title}</Heading>
        {note ? <p className="plate-note">{note}</p> : null}
      </div>
      {count != null || actions ? <div className="plate-tools">{count != null ? <Badge>{count}</Badge> : null}{actions}</div> : null}
    </header> : null}
    {children}
  </Tag>;
}
