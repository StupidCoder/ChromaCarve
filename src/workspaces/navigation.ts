import { useSyncExternalStore } from 'react';

const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
};
const snapshot = () => window.location.pathname + window.location.search;

export function useWorkspaceLocation() {
  return useSyncExternalStore(subscribe, snapshot);
}

export function navigateWorkspace(url: string, replace = false) {
  window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
