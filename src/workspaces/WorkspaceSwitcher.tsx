import { navigateWorkspace } from './navigation';

export function WorkspaceSwitcher({ active }: { active: 'reliefs' | 'slices' }) {
  return (
    <nav className="workspace-switcher" aria-label="Workspace">
      {(['reliefs', 'slices'] as const).map((workspace) => (
        <a key={workspace} href={workspace === 'slices' ? '/slices/' : '/'}
          aria-current={active === workspace ? 'page' : undefined}
          onClick={(event) => {
            if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (workspace !== active) navigateWorkspace(event.currentTarget.getAttribute('href')!);
          }}>
          {workspace === 'slices' ? 'Slices' : 'Reliefs'}
        </a>
      ))}
    </nav>
  );
}
