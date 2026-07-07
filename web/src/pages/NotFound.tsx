import { Link } from 'react-router-dom';
import { useSettings } from '../lib/settings';

export function NotFound() {
  const { t } = useSettings();
  return (
    <div className="fade-in flex flex-col items-center justify-center py-24 text-center">
      <div className="grad-text text-6xl font-extrabold">404</div>
      <p className="mt-3 text-muted">{t('not_found')}</p>
      <Link to="/" className="mt-6"><button>Voltar ao explorador</button></Link>
    </div>
  );
}
