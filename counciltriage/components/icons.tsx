/**
 * Font Awesome icons (the icon set southampton.gov.uk uses), rendered as plain
 * inline SVG so they work in Server Components with no client JavaScript.
 */
import type { IconDefinition } from "@fortawesome/fontawesome-common-types";
import {
  faBus,
  faCircleQuestion,
  faDumpster,
  faEllipsis,
  faLightbulb,
  faRoad,
  faRoadCircleExclamation,
  faSprayCan,
  faTrashCan,
} from "@fortawesome/free-solid-svg-icons";

export type { IconDefinition };

export function Icon({ icon, className, title }: { icon: IconDefinition; className?: string; title?: string }) {
  const [width, height, , , path] = icon.icon;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block h-[1em] w-auto shrink-0 fill-current ${className ?? ""}`}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {Array.isArray(path) ? path.map((d, i) => <path key={i} d={d} />) : <path d={path} />}
    </svg>
  );
}

export const CATEGORY_ICON: Record<string, IconDefinition> = {
  pothole: faRoadCircleExclamation,
  road_pavement_damage: faRoad,
  fly_tipping: faDumpster,
  litter: faTrashCan,
  vandalism: faSprayCan,
  street_light: faLightbulb,
  bus_shelter: faBus,
  other: faEllipsis,
  tbc: faCircleQuestion,
};

/**
 * Category icons repeat on every list row, so they are drawn once in a hidden
 * sprite (rendered by the root layout) and referenced with <use>.
 */
export function CategoryIconSprite() {
  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
      {Object.entries(CATEGORY_ICON).map(([id, icon]) => {
        const [width, height, , , path] = icon.icon;
        return (
          <symbol key={id} id={`cat-${id}`} viewBox={`0 0 ${width} ${height}`}>
            {Array.isArray(path) ? path.map((d, i) => <path key={i} d={d} />) : <path d={path} />}
          </symbol>
        );
      })}
    </svg>
  );
}

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const icon = CATEGORY_ICON[category] ?? faEllipsis;
  const [width, height] = icon.icon;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`inline-block h-[1em] w-auto shrink-0 fill-current ${className ?? ""}`} aria-hidden focusable="false">
      <use href={`#cat-${CATEGORY_ICON[category] ? category : "other"}`} />
    </svg>
  );
}
