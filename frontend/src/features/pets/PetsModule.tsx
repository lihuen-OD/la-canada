import { useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PetDetailScreen } from './PetDetailScreen';
import { PetsListScreen } from './PetsListScreen';
import { PetsModuleContext } from './petsModuleState';

/** 🐾 Mascotas: listado `/pets` y ficha `/pets/:petId` como rutas descendientes (SPA). */
export function PetsModule() {
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const state = useMemo(() => ({ typeFilter, setTypeFilter }), [typeFilter]);
  return (
    <PetsModuleContext.Provider value={state}>
      <Routes>
        <Route index element={<PetsListScreen />} />
        <Route path=":petId" element={<PetDetailScreen />} />
        <Route path="*" element={<Navigate to="/pets" replace />} />
      </Routes>
    </PetsModuleContext.Provider>
  );
}
