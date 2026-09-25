import { Link } from 'react-router-dom';
import { buttonClassName } from '../../components/ui/buttonStyles';
import { ArrowLeftIcon } from '../../components/ui/icons';

/** "← Volver" del prototipo (`ir('mas')` / `ir('config')`), como navegación SPA. */
export function MoreBackLink({ to = '/more', label = 'Volver' }: { to?: string; label?: string }) {
  return (
    <Link to={to} className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
      <ArrowLeftIcon size="sm" /> {label}
    </Link>
  );
}
