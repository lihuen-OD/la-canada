interface BrandProps {
  as?: 'h1' | 'span';
  size?: 'default' | 'hero';
}

/** Marca "La Cañada" en Fraunces, con "Cañada" destacada en itálica verde claro. */
export function Brand({ as: Tag = 'span', size = 'default' }: BrandProps) {
  return (
    <Tag className={size === 'hero' ? 'brand brand--hero' : 'brand'}>
      La <span className="brand__accent">Cañada</span>
    </Tag>
  );
}
