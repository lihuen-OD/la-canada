import { render, screen } from '../../test/render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Avatar } from './Avatar';
import { Badge } from './Badge';
import { Button } from './Button';
import { EmptyState, ErrorState, LoadingState } from './StateMessage';

describe('Button', () => {
  it('por defecto es type="button" (nunca envía un formulario por accidente)', () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveAttribute('type', 'button');
  });

  it('loading: deshabilitado, aria-busy, y conserva su nombre accesible', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Activar
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Activar' });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.setup().click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('los iconos son decorativos: no alteran el nombre accesible', () => {
    render(<Button icon={<svg data-testid="icono" />}>Cerrar sesión</Button>);
    expect(screen.getByRole('button')).toHaveAccessibleName('Cerrar sesión');
  });
});

describe('Badge', () => {
  it('siempre muestra texto — el color nunca es el único portador del significado', () => {
    render(
      <Badge tone="warning" dot>
        Suspendido
      </Badge>,
    );
    expect(screen.getByText('Suspendido')).toBeInTheDocument();
  });
});

describe('Avatar', () => {
  it('es decorativo (aria-hidden) y muestra la inicial en mayúscula', () => {
    const { container } = render(<Avatar name="coke" colorHex="#4a7c59" />);
    const avatar = container.firstElementChild as HTMLElement;
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
    expect(avatar).toHaveTextContent('C');
  });
});

describe('estados compartidos', () => {
  it('LoadingState: texto con contexto anunciado por aria-live, nunca un spinner aislado', () => {
    render(<LoadingState label="Cargando usuarios…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Cargando usuarios…');
  });

  it('ErrorState: alerta con reintento real', async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="No pudimos cargar." onRetry={onRetry} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar.');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('EmptyState: sin botones ni acciones falsas', () => {
    render(<EmptyState title="Todavía no hay nada." description="Explicación." />);
    expect(screen.getByRole('heading', { name: 'Todavía no hay nada.' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
