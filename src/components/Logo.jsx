import React from "react";

// The StoreLens icon, inlined so the dark theme can change it (an <img> can't
// follow the theme). The bag outline is a fixed dark grey, which vanishes on a
// dark header, so in the dark theme a light ring is drawn around it and the
// bag is filled light; both use the text colour. The light theme is exactly
// public/StoreLens-icon.svg, which stays as it is for the favicon.
const HANDLE = "M1074.656,692.308l0,-323.077c0,-147.696 -123.97,-269.231 -274.624,-269.231c-150.654,-0 -274.624,121.535 -274.624,269.231l0,323.077";
const BODY = "M1357.043,549.221l92.493,861.538c5.126,47.744 -32.955,89.241 -81.948,89.241l-1135.113,0c-0.029,0 -0.059,0 -0.088,0c-45.196,0 -82.387,-36.461 -82.387,-80.769c0,-2.83 0.152,-5.658 0.454,-8.472l92.567,-861.538c4.4,-40.9 39.997,-72.305 81.948,-72.297l950.127,0c42.182,0 77.554,31.231 81.948,72.297Z";
const BOLT = "M869.949,665.247c8.033,5.571 12.014,17.345 9.603,28.4l-53.284,243.43l194.413,0c11.005,0.001 20.061,11.286 20.061,25c0,6.334 -1.932,12.438 -5.402,17.066l-280.866,374.995c-3.793,5.075 -9.115,7.962 -14.681,7.962c-11.006,0 -20.062,-11.285 -20.062,-25c0,-2.24 0.241,-4.469 0.718,-6.628l53.284,-243.397l-194.413,0c-11.005,-0.001 -20.061,-11.286 -20.061,-25c0,-6.334 1.932,-12.438 5.402,-17.066l280.866,-374.995c6.274,-8.364 16.396,-10.34 24.422,-4.767Z";

const ROUND = { strokeLinecap: "round", strokeLinejoin: "round" };
const OUTLINE = { stroke: "#27272a", strokeWidth: 69.91 };

export default function Logo({ className }) {
  return (
    <svg
      viewBox="0 0 1600 1600"
      aria-hidden="true"
      focusable="false"
      className={`overflow-visible ${className ?? ""}`}
    >
      <g className="hidden dark:inline text-foreground">
        {/* Light ring outside the outline (the outline's 69.91 plus 60 each side). */}
        <path d={HANDLE} fill="none" stroke="currentColor" strokeWidth={69.91 + 120} {...ROUND} />
        <path d={BODY} fill="none" stroke="currentColor" strokeWidth={69.91 + 120} {...ROUND} />
        {/* Light fill inside the bag. */}
        <path d={BODY} fill="currentColor" stroke="none" />
      </g>
      <path d={HANDLE} fill="none" {...OUTLINE} {...ROUND} />
      <path d={BODY} fill="none" {...OUTLINE} {...ROUND} />
      <path d={BOLT} fill="#007bff" />
    </svg>
  );
}
