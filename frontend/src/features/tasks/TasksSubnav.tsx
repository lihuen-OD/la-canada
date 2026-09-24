export function TasksSubnav({ active }: { active: 'tasks' | 'performance' }) {
  return (
    <nav className="tasks-subnav" aria-label="Secciones de Tareas">
      <a
        href="/tasks"
        className={active === 'tasks' ? 'active' : undefined}
        aria-current={active === 'tasks' ? 'page' : undefined}
      >
        ✅ Tareas
      </a>
      <a
        href="/tasks/performance"
        className={active === 'performance' ? 'active' : undefined}
        aria-current={active === 'performance' ? 'page' : undefined}
      >
        📊 Desempeño
      </a>
    </nav>
  );
}
