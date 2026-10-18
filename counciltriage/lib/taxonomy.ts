/**
 * Report taxonomy.
 *
 * Category ids and service names mirror the tags in the scraped FixMyStreet
 * dataset (reports.jsonl) so that resident-submitted reports and imported
 * reports share one vocabulary for the triage models.
 *
 * Each category declares its own follow-up questions. The resident form,
 * server-side validation and the triage engine all read from this file, so a
 * new problem type is added by adding one entry here.
 */

export type CategoryId =
  | "pothole"
  | "road_pavement_damage"
  | "fly_tipping"
  | "litter"
  | "vandalism"
  | "street_light"
  | "bus_shelter"
  | "other";

/** `tbc` is not selectable by residents: it is the triage holding category for uncertain reports. */
export type EffectiveCategoryId = CategoryId | "tbc";

export type HazardLevel = "low" | "medium" | "high";

export type QuestionOption = { value: string; label: string; hint?: string };

export type Question = {
  id: string;
  label: string;
  hint?: string;
  type: "radio" | "checkbox-group" | "text" | "confirm";
  options?: QuestionOption[];
  required?: boolean;
  /** Only ask this question when another answer matches. */
  showIf?: { question: string; equals: string };
  maxLength?: number;
};

export type CategoryDefinition = {
  id: CategoryId;
  label: string;
  description: string;
  /** FixMyStreet service names that map onto this category. */
  services: string[];
  questions: Question[];
  /** Base urgency before any report-specific factors (0-100 scale). */
  basePriority: number;
  /** Minutes a two-person crew typically spends on site, used by the route planner. */
  typicalJobMinutes: number;
};

export const POTHOLE_STATEMENT =
  "I confirm the information given about the depth of the pothole is, to the best of my knowledge, a true and accurate statement. This helps the council prioritise limited resources.";

export const CATEGORIES: CategoryDefinition[] = [
  {
    id: "pothole",
    label: "Pothole",
    description: "A hole or sunken patch in a road or pavement surface.",
    services: ["Potholes"],
    basePriority: 40,
    typicalJobMinutes: 40,
    questions: [
      {
        id: "pothole_where",
        label: "Where is the pothole?",
        type: "radio",
        required: true,
        options: [
          { value: "CARRIAGEWAY", label: "Road" },
          { value: "FOOTWAY", label: "Pavement" },
        ],
      },
      {
        id: "pothole_depth_road",
        label: "How deep is the pothole?",
        type: "radio",
        required: true,
        showIf: { question: "pothole_where", equals: "CARRIAGEWAY" },
        options: [
          { value: "MONITOR", label: "Less than 4cm", hint: "About the size of a golf ball" },
          { value: "STANDARD", label: "Between 4cm and 7.5cm", hint: "About the size of a tennis ball" },
          { value: "URGENT", label: "More than 7.5cm" },
        ],
      },
      {
        id: "pothole_depth_pavement",
        label: "How deep is the pothole?",
        type: "radio",
        required: true,
        showIf: { question: "pothole_where", equals: "FOOTWAY" },
        options: [
          { value: "MONITOR", label: "Less than 2cm" },
          { value: "STANDARD", label: "Between 2cm and 4cm" },
          { value: "URGENT", label: "More than 4cm" },
        ],
      },
      {
        id: "pothole_width",
        label: "Roughly how wide is it?",
        type: "radio",
        options: [
          { value: "small", label: "Smaller than a dinner plate" },
          { value: "medium", label: "Up to the size of a dustbin lid" },
          { value: "large", label: "Larger than a dustbin lid" },
        ],
      },
      {
        id: "pothole_statement",
        label: POTHOLE_STATEMENT,
        type: "confirm",
        required: true,
      },
    ],
  },
  {
    id: "road_pavement_damage",
    label: "Road or pavement damage",
    description: "Broken slabs, damaged kerbs or covers, road surface defects and markings.",
    services: ["Roads/highways", "Pavements/footpaths"],
    basePriority: 35,
    typicalJobMinutes: 45,
    questions: [
      {
        id: "damage_surface",
        label: "Where is the damage?",
        type: "radio",
        required: true,
        options: [
          { value: "road", label: "Road" },
          { value: "pavement", label: "Pavement or footpath" },
          { value: "cycle_path", label: "Cycle path" },
        ],
      },
      {
        id: "damage_type",
        label: "What best describes the problem?",
        type: "radio",
        required: true,
        options: [
          { value: "slab", label: "Cracked, loose or uneven paving slab" },
          { value: "kerb", label: "Damaged or raised kerb" },
          { value: "cover", label: "Damaged, loose or missing drain or utility cover" },
          { value: "surface", label: "Sunken, cracked or crumbling road surface" },
          { value: "markings", label: "Faded or missing road markings" },
          { value: "debris", label: "Debris, spillage or loose gravel" },
          { value: "other", label: "Something else" },
        ],
      },
      {
        id: "trip_hazard",
        label: "Could someone trip, fall or come off a bike because of it?",
        type: "radio",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
          { value: "unsure", label: "Not sure" },
        ],
      },
    ],
  },
  {
    id: "fly_tipping",
    label: "Fly-tipping",
    description: "Rubbish, furniture or waste dumped illegally.",
    services: ["Flytipping"],
    basePriority: 30,
    typicalJobMinutes: 35,
    questions: [
      {
        id: "waste_types",
        label: "What has been dumped?",
        hint: "Select all that apply.",
        type: "checkbox-group",
        required: true,
        options: [
          { value: "bags", label: "Black bags or household rubbish" },
          { value: "furniture", label: "Furniture or mattresses" },
          { value: "white_goods", label: "Fridges, freezers or other appliances" },
          { value: "building", label: "Building rubble or DIY waste" },
          { value: "garden", label: "Garden waste" },
          { value: "tyres", label: "Tyres" },
          { value: "hazardous", label: "Hazardous waste (asbestos, chemicals, needles, gas bottles)" },
          { value: "other", label: "Something else" },
        ],
      },
      {
        id: "waste_amount",
        label: "Roughly how much is there?",
        type: "radio",
        required: true,
        options: [
          { value: "single", label: "A single item or bag" },
          { value: "car_boot", label: "About a car boot load" },
          { value: "van", label: "About a small van load" },
          { value: "lorry", label: "A lorry load or more" },
        ],
      },
      {
        id: "waste_obstruction",
        label: "Is it blocking a pavement, road or entrance?",
        type: "radio",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
      {
        id: "waste_land",
        label: "Is it on public land?",
        type: "radio",
        options: [
          { value: "public", label: "Yes, a street, park or other public space" },
          { value: "private", label: "No, private land" },
          { value: "unsure", label: "Not sure" },
        ],
      },
    ],
  },
  {
    id: "litter",
    label: "Litter or street cleaning",
    description: "Litter, overflowing litter bins, broken glass or a dirty street.",
    services: ["Litter in the street", "Street cleaning"],
    basePriority: 18,
    typicalJobMinutes: 25,
    questions: [
      {
        id: "litter_type",
        label: "What is the problem?",
        type: "checkbox-group",
        required: true,
        options: [
          { value: "general", label: "General litter" },
          { value: "bin", label: "Overflowing litter bin" },
          { value: "glass", label: "Broken glass" },
          { value: "spilled_refuse", label: "Spilled bin bags or refuse" },
          { value: "detritus", label: "Mud, leaves or detritus" },
        ],
      },
      {
        id: "litter_extent",
        label: "How large an area is affected?",
        type: "radio",
        options: [
          { value: "spot", label: "One spot" },
          { value: "street", label: "Most of the street" },
          { value: "wide", label: "Several streets or a whole area" },
        ],
      },
    ],
  },
  {
    id: "vandalism",
    label: "Graffiti or vandalism",
    description: "Graffiti, fly-posting or deliberately damaged street furniture.",
    services: ["Graffiti", "Flyposting"],
    basePriority: 15,
    typicalJobMinutes: 50,
    questions: [
      {
        id: "vandalism_type",
        label: "What best describes it?",
        type: "radio",
        required: true,
        options: [
          { value: "graffiti", label: "Graffiti" },
          { value: "flyposting", label: "Fly-posting (illegal posters or stickers)" },
          { value: "damage", label: "Damaged benches, signs or other street furniture" },
        ],
      },
      {
        id: "vandalism_offensive",
        label: "Is it offensive, racist or obscene?",
        type: "radio",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
      {
        id: "vandalism_size",
        label: "How big is it?",
        type: "radio",
        options: [
          { value: "small", label: "Small (under 1 square metre)" },
          { value: "medium", label: "Medium (1 to 5 square metres)" },
          { value: "large", label: "Large (over 5 square metres)" },
        ],
      },
    ],
  },
  {
    id: "street_light",
    label: "Street light",
    description: "A street light that is out, flickering, on in the day or damaged.",
    services: ["Street lighting"],
    basePriority: 28,
    typicalJobMinutes: 45,
    questions: [
      {
        id: "light_fault",
        label: "What is wrong with the light?",
        type: "radio",
        required: true,
        options: [
          { value: "out", label: "Not working" },
          { value: "flickering", label: "Flickering" },
          { value: "day_burning", label: "On during the day" },
          { value: "damaged", label: "Damaged, leaning or knocked down" },
          { value: "exposed", label: "Exposed wires or open access door" },
        ],
      },
      {
        id: "light_count",
        label: "How many lights are affected?",
        type: "radio",
        options: [
          { value: "one", label: "Just one" },
          { value: "several", label: "Several in a row" },
        ],
      },
      {
        id: "light_number",
        label: "Light number (optional)",
        hint: "Usually printed on a sticker or plate on the post.",
        type: "text",
        maxLength: 20,
      },
    ],
  },
  {
    id: "bus_shelter",
    label: "Bus stop or shelter",
    description: "Damage to a bus shelter, seating, timetable or bus stop.",
    services: ["Bus stop damage", "Bus stops"],
    basePriority: 25,
    typicalJobMinutes: 40,
    questions: [
      {
        id: "shelter_damage",
        label: "What is damaged?",
        type: "checkbox-group",
        required: true,
        options: [
          { value: "glass", label: "Broken glass panel" },
          { value: "seating", label: "Seating" },
          { value: "timetable", label: "Timetable or information display" },
          { value: "structure", label: "Roof or structure" },
          { value: "graffiti", label: "Graffiti" },
        ],
      },
      {
        id: "shelter_glass_on_ground",
        label: "Is there broken glass on the ground?",
        type: "radio",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      },
      {
        id: "stop_name",
        label: "Bus stop name or number (optional)",
        type: "text",
        maxLength: 60,
      },
    ],
  },
  {
    id: "other",
    label: "Something else",
    description: "Parking, vegetation, signs, traffic lights, dog fouling and other street problems.",
    services: [
      "Illegal parking",
      "Overhanging vegetation",
      "Dog fouling",
      "Traffic lights",
      "Road traffic signs",
      "Shopping trolleys",
      "Grass verges",
      "Street nameplates",
      "Rubbish accumulation on private property",
      "Noise nuisance",
      "Leaves",
      "Bollards",
      "Abandoned vehicles",
      "Rats",
      "Rubbish (refuse and recycling)",
      "To let signs",
      "Car parking",
      "Dead animals",
      "Parks/landscapes",
      "Trees",
      "Other",
    ],
    basePriority: 15,
    typicalJobMinutes: 30,
    questions: [],
  },
];

export const CATEGORY_BY_ID: Record<CategoryId, CategoryDefinition> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryDefinition>;

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && (CATEGORY_IDS as string[]).includes(value);
}

export function isEffectiveCategoryId(value: unknown): value is EffectiveCategoryId {
  return value === "tbc" || isCategoryId(value);
}

export function categoryLabel(id: string | null | undefined): string {
  if (id === "tbc") return "TBC (needs review)";
  return (id && CATEGORY_BY_ID[id as CategoryId]?.label) || "Unknown";
}

const SERVICE_TO_CATEGORY = new Map<string, CategoryId>(
  CATEGORIES.flatMap((c) => c.services.map((s) => [s, c.id] as const)),
);

/** Category for a FixMyStreet service name, matching the tags in the scraped dataset. */
export function categoryForService(serviceName: string): CategoryId {
  return SERVICE_TO_CATEGORY.get(serviceName) ?? "other";
}

export const HAZARD_LEVELS: { value: HazardLevel; label: string; hint: string }[] = [
  { value: "low", label: "Unsightly or an inconvenience", hint: "Not a danger to anyone." },
  { value: "medium", label: "Could cause injury or damage", hint: "If it is not dealt with soon." },
  { value: "high", label: "Immediate danger", hint: "To people, cyclists or vehicles right now." },
];

export type Answers = Record<string, string | string[]>;

/** Questions that apply to a category given the answers so far. */
export function visibleQuestions(category: CategoryId, answers: Answers): Question[] {
  return CATEGORY_BY_ID[category].questions.filter(
    (q) => !q.showIf || answers[q.showIf.question] === q.showIf.equals,
  );
}

/** Council pothole intervention class from the depth answers, if this is a pothole report. */
export function potholeClass(answers: Answers): "MONITOR" | "STANDARD" | "URGENT" | null {
  const where = answers.pothole_where;
  const depth = where === "FOOTWAY" ? answers.pothole_depth_pavement : answers.pothole_depth_road;
  return depth === "MONITOR" || depth === "STANDARD" || depth === "URGENT" ? depth : null;
}

/** Human-readable answer summary, used on report pages and in the FixMyStreet-shaped export. */
export function describeAnswers(category: CategoryId, answers: Answers): { question: string; answer: string }[] {
  return visibleQuestions(category, answers)
    .filter((q) => q.type !== "confirm")
    .map((q) => {
      const raw = answers[q.id];
      if (raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0)) return null;
      const values = Array.isArray(raw) ? raw : [raw];
      const text = q.options
        ? values.map((v) => q.options!.find((o) => o.value === v)?.label ?? v).join(", ")
        : values.join(", ");
      return { question: q.label, answer: text };
    })
    .filter((x): x is { question: string; answer: string } => x !== null);
}
