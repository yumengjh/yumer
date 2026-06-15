import type { IconProps } from "./IconProps";

export default function DividerIcon({ className, style }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 20 20" className={className} style={style}>
      <path d="M0 0h20v20H0z" fill="none" />
      <path fill="currentColor" fillRule="evenodd" d="M1 10a1 1 0 0 1 1-1h16a1 1 0 1 1 0 2H2a1 1 0 0 1-1-1" clipRule="evenodd" />
    </svg>
  );
}
