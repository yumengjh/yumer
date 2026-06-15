import type { IconProps } from "./IconProps";

export default function UnderlineIcon({ className, style }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" className={className} style={style}>
      <path d="M0 0h24v24H0z" fill="none" />
      <g transform="translate(2 2) scale(0.625)">
        <path fill="currentColor" d="M29.565 28.696h-27.13c-0.191 0-0.348 0.148-0.348 0.33v2.643c0 0.183 0.156 0.33 0.348 0.33h27.13c0.191 0 0.348-0.148 0.348-0.33v-2.643c0-0.183-0.157-0.33-0.348-0.33zM16 25.391c3.017 0 5.852-1.178 7.991-3.313s3.313-4.974 3.313-7.991v-13.565c0-0.287-0.235-0.522-0.522-0.522h-2.609c-0.287 0-0.522 0.235-0.522 0.522v13.565c0 4.217-3.435 7.652-7.652 7.652s-7.652-3.435-7.652-7.652v-13.565c0-0.287-0.235-0.522-0.522-0.522h-2.609c-0.287 0-0.522 0.235-0.522 0.522v13.565c0 3.017 1.178 5.852 3.313 7.991s4.974 3.313 7.991 3.313z" />
      </g>
    </svg>
  );
}
