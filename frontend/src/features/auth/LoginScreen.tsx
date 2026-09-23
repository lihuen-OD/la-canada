import { useState } from 'react';
import type { LoginOption } from '../../api/types';
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
    <main className="login-screen">
      <div className="login-screen__brand">
        <h1 className="login-screen__title">La Cañada</h1>
        <p className="login-screen__subtitle">
          {selectedOption ? 'Ingresá tu PIN para continuar.' : 'Elegí tu identidad para ingresar.'}
        </p>
      </div>

      {selectedOption ? (
        <PinEntryScreen option={selectedOption} onBack={() => setSelectedOption(null)} />
      ) : (
        <IdentitySelector onSelect={setSelectedOption} />
      )}
    </main>
  );
}
