import type { ReactNode, SVGProps } from 'react';

/**
 * Iconos SVG propios, trazo simple de 1.75px — sin dependencia externa para
 * un puñado de iconos. Siempre decorativos (`aria-hidden`): el nombre
 * accesible lo da el texto o el `aria-label` del control que los contiene,
 * nunca el icono en sí.
 */
type IconSize = 'sm' | 'md' | 'lg' | 'xl';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: IconSize;
}

function createIcon(paths: ReactNode) {
  return function Icon({ size = 'md', className, ...rest }: IconProps) {
    const classes = ['icon', size === 'md' ? null : `icon--${size}`, className]
      .filter(Boolean)
      .join(' ');
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={classes}
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const HomeIcon = createIcon(
  <>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
  </>,
);

export const UsersIcon = createIcon(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
    <path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
  </>,
);

export const LogOutIcon = createIcon(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </>,
);

export const ArrowLeftIcon = createIcon(
  <>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </>,
);

export const ChevronRightIcon = createIcon(<path d="m9 18 6-6-6-6" />);

export const BackspaceIcon = createIcon(
  <>
    <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
    <path d="m17.5 9.5-5 5" />
    <path d="m12.5 9.5 5 5" />
  </>,
);

export const ShieldIcon = createIcon(
  <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />,
);

export const LockIcon = createIcon(
  <>
    <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </>,
);

export const AlertIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5" />
    <path d="M12 16.25h.01" />
  </>,
);

export const CheckCircleIcon = createIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.75 2.75L16 10" />
  </>,
);

export const CloudOffIcon = createIcon(
  <>
    <path d="M3 3l18 18" />
    <path d="M7.5 7.6A5.5 5.5 0 0 0 7 18h10.5" />
    <path d="M11 6.1A5.5 5.5 0 0 1 17.4 10H18a3.5 3.5 0 0 1 2.4 6.1" />
  </>,
);

export const KeyIcon = createIcon(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="m10.8 12.2 8.7-8.7" />
    <path d="m16.5 6.5 2.5 2.5" />
  </>,
);

/** Brote — personalidad rural para estados vacíos, nunca como indicador semántico único. */
export const SproutIcon = createIcon(
  <>
    <path d="M12 21v-9" />
    <path d="M12 12c0-4 2.5-6.5 7-6.5 0 4.5-2.5 6.5-7 6.5Z" />
    <path d="M12 14.5C12 11 10 9 5.5 9c0 3.5 2 5.5 6.5 5.5Z" />
  </>,
);
