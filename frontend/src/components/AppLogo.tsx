interface NurseLogoProps {
  className?: string;
}

export function NurseLogo({ className = 'h-5 w-5' }: NurseLogoProps) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <path d="M12 5c2.941 0 6.685 1.537 9 3l-2 11h-14l-2 -11c2.394 -1.513 6.168 -3.005 9 -3" />
      <path d="M10 12h4" />
      <path d="M12 10v4" />
    </svg>
  );
}

interface AppBrandProps {
  className?: string;
  iconClassName?: string;
}

export function AppBrand({
  className = '',
  iconClassName = 'h-4 w-4',
}: AppBrandProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <NurseLogo className={iconClassName} />
      <span>MediBuddy</span>
    </span>
  );
}
