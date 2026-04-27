import { useRoutes } from 'react-router-dom';
import { routes } from '@/routes';
import { FeaturesProvider } from '@/stores/features.context';

export default function App() {
  const element = useRoutes(routes);
  // FeaturesProvider mounts at the root so any page can call useFeature('xxx').
  // It quietly no-ops for super-admin users (synthetic platform tenant has no
  // billing) and unauthenticated visitors.
  return <FeaturesProvider>{element}</FeaturesProvider>;
}
