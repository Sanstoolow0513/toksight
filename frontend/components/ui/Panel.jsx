import { cx } from './cx';
import Badge from './Badge';

// A plate: hairline frame with registration ticks and an optional head
// (index, icon, title, note, count badge, actions).
export default function Panel({ as: Tag = 'section', index, icon, title, note, count, actions, level = 3, titleProps, headClassName, className, children, ...rest }) {
  const Heading = `h${level}`;
  return <Tag className={cx('plate', className)} {...rest}>
    {title != null ? <header className={cx('plate-head', headClassName)}>
      <div className="plate-heading">
        {index ? <span className="plate-index" aria-hidden="true"><b>§</b> {index}</span> : null}
        <Heading className="plate-title" {...titleProps}>{icon}{title}</Heading>
        {note ? <p className="plate-note">{note}</p> : null}
      </div>
      {count != null || actions ? <div className="plate-tools">{count != null ? <Badge>{count}</Badge> : null}{actions}</div> : null}
    </header> : null}
    {children}
  </Tag>;
}
