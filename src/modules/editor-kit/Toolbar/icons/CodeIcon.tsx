import type { IconProps } from "./IconProps";

export default function CodeIcon({ className, style }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className={className} style={style}>
      <path d="M0 0h24v24H0z" fill="none" />
      <g transform="translate(2 2) scale(0.625)">
        <path fill="currentColor" d="M31.862 16.604c0.27-0.583 0.144-1.297-0.358-1.749l-6.422-5.782c-0.617-0.555-1.567-0.506-2.122 0.111v0 0c-0.555 0.617-0.506 1.567 0.111 2.122l5.206 4.688-5.237 4.716c-0.617 0.555-0.667 1.506-0.111 2.122s1.506 0.667 2.122 0.111l6.422-5.782c0.177-0.159 0.307-0.351 0.39-0.557zM3.725 15.981l5.206-4.688c0.617-0.555 0.667-1.506 0.111-2.122v0 0c-0.555-0.617-1.506-0.667-2.122-0.111v0l-6.422 5.782c-0.502 0.452-0.629 1.166-0.358 1.749 0.083 0.207 0.213 0.398 0.39 0.557l6.422 5.782c0.617 0.555 1.567 0.506 2.122-0.111s0.506-1.567-0.111-2.122l-5.237-4.716z" />
      </g>
    </svg>
  );
}
