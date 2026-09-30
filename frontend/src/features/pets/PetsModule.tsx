import { useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PetDetailScreen } from './PetDetailScreen';
import { PetDueScreen } from './PetDueScreen';
import { PetsListScreen } from './PetsListScreen';
import { PetsModuleContext } from './petsModuleState';

/** 🐾 Mascotas: listado `/pets`, 📅 Vencimientos `/pets/due` y ficha `/pets/:petId` (SPA). */
export function PetsModule() {
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const state = useMemo(() => ({ typeFilter, setTypeFilter }), [typeFilter]);
  return (
    <PetsModuleContext.Provider value={state}>
      <Routes>
        <Route index element={<PetsListScreen />} />
        <Route path="due" element={<PetDueScreen />} />
        <Route path=":petId" element={<PetDetailScreen />} />
        <Route path="*" element={<Navigate to="/pets" replace />} />
      </Routes>
    </PetsModuleContext.Provider>
  );
}
