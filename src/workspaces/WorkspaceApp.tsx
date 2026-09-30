import { lazy, Suspense, useEffect } from 'react';
import { useWorkspaceLocation } from './navigation';

const ReliefApp = lazy(() => import('../App'));
const SlicesApp = lazy(() => import('../slices/SlicesApp'));

export default function WorkspaceApp() {
  const location = useWorkspaceLocation();
  const url = new URL(location, window.location.origin);
  const slices = /^\/slices(?:\/|$)/.test(url.pathname);
  useEffect(() => { document.title = slices ? 'ChromaCarve — Slices' : 'ChromaCarve'; }, [slices]);
  return <Suspense fallback={<div className="workspace-loading" role="status">Opening workspace…</div>}>
    {slices ? <SlicesApp handoff={url.searchParams.get('handoff')} /> : <ReliefApp />}
  </Suspense>;
}
