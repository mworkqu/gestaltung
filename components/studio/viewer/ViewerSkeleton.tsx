// Placeholder in the shape of the 3D view (soft floor ellipse + a product block on
// the studio gradient), shown while the viewer chunk loads or the parts are picked.
// No three.js, no hooks: safe in any bundle.

export function ViewerSkeleton({ plate = false }: { plate?: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="relative h-full min-h-[240px] w-full overflow-hidden"
      style={{ background: "linear-gradient(180deg, #f4f7fb 0%, #e6ebf2 100%)" }}
    >
      <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full motion-safe:animate-pulse">
        <ellipse cx="200" cy="215" rx={plate ? 150 : 110} ry={plate ? 46 : 22} fill="#dde4ee" />
        {plate ? (
          <>
            <rect x="120" y="150" width="70" height="44" rx="8" fill="#d3dbe6" />
            <rect x="205" y="160" width="52" height="34" rx="8" fill="#d3dbe6" />
            <rect x="160" y="195" width="40" height="22" rx="6" fill="#d3dbe6" />
            <rect x="225" y="200" width="46" height="20" rx="6" fill="#d3dbe6" />
          </>
        ) : (
          <rect x="130" y="110" width="140" height="100" rx="26" fill="#d3dbe6" />
        )}
      </svg>
    </div>
  );
}
