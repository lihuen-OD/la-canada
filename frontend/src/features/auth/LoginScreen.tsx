import { useState } from 'react';
import type { LoginOption } from '../../api/types';
import { Brand } from '../../components/ui/Brand';
import { IdentitySelector } from './IdentitySelector';
import { PinEntryScreen } from './PinEntryScreen';

/**
 * La identidad elegida acá es únicamente estado de UI local — nunca se
 * guarda en el contexto de auth ni se trata como si la persona ya
 * estuviera autenticada (eso solo lo decide `AuthContext`, contra la
 * respuesta real de `POST /auth/login`).
 */
export function LoginScreen() {
  const [selectedOption, setSelectedOption] = useState<LoginOption | null>(null);

  return (
    <main className="login-screen theme-inverse">
      <div className="login-screen__inner">
        <div className="login-screen__brand">
          <Brand as="h1" size="hero" />
          <p className="login-screen__tagline">Sistema de gestión</p>
        </div>

        <section className="login-card" aria-label="Ingreso">
          {selectedOption ? (
            <PinEntryScreen option={selectedOption} onBack={() => setSelectedOption(null)} />
          ) : (
            <>
              <p className="login-card__instruction">Elegí tu identidad para ingresar.</p>
              <IdentitySelector onSelect={setSelectedOption} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
