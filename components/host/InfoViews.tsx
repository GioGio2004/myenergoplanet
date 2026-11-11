"use client";

import { GAME_NAME } from "@/lib/brand";
import { useSettings, type Quality } from "@/lib/settings";

function ViewTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-serif text-[clamp(2.5rem,5vh,3.75rem)] leading-tight font-medium text-rice-paper">
      {children}
    </h1>
  );
}

const STEPS = [
  { n: "一", title: "Open a room", body: "Press Create Room on this screen." },
  {
    n: "二",
    title: "Scan with your phone",
    body: "2 to 4 players. Your phone becomes your controller, no app needed.",
  },
  {
    n: "三",
    title: "Push them off",
    body: "Joystick to move, Dash to lunge, hold Brace to stand firm. First to 5 knockouts wins.",
  },
];

export function HowToPlayView() {
  return (
    <div className="w-full max-w-2xl">
      <ViewTitle>How to Play</ViewTitle>
      <ol className="mt-10 flex flex-col">
        {STEPS.map((s) => (
          <li
            key={s.n}
            className="flex gap-7 border-t border-stone-blue/20 py-7 last:border-b"
          >
            <span className="w-10 shrink-0 font-serif text-4xl leading-none text-scarlet">
              {s.n}
            </span>
            <div>
              <h2 className="font-serif text-2xl text-rice-paper">{s.title}</h2>
              <p className="mt-1.5 text-base leading-relaxed text-stone-blue">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const QUALITIES: { id: Quality; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

export function SettingsView() {
  const [settings, update] = useSettings();
  return (
    <div className="w-full max-w-2xl">
      <ViewTitle>Settings</ViewTitle>
      <div className="mt-10 flex flex-col">
        <Row label="Sound" hint="Taiko hits, clacks and splashes">
          <Switch
            checked={settings.sound}
            onChange={(sound) => update({ sound })}
            label="Sound"
          />
        </Row>
        <Row label="Graphics quality" hint="Lower it on older laptops and TVs">
          <div
            role="radiogroup"
            aria-label="Graphics quality"
            className="flex rounded-full border border-stone-blue/35 p-1"
          >
            {QUALITIES.map((q) => {
              const on = settings.quality === q.id;
              return (
                <button
                  key={q.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => update({ quality: q.id })}
                  className={`rounded-full px-4 py-1.5 text-sm transition-colors duration-300 ease-ink outline-none focus-visible:ring-1 focus-visible:ring-rice-paper ${
                    on ? "bg-scarlet text-rice-paper" : "text-stone-blue hover:text-rice-paper"
                  }`}
                >
                  {q.label}
                </button>
              );
            })}
          </div>
        </Row>
        <Row label="Reduce motion" hint="Turns off camera shake and slow motion">
          <Switch
            checked={settings.reduceMotion}
            onChange={(reduceMotion) => update({ reduceMotion })}
            label="Reduce motion"
          />
        </Row>
      </div>
    </div>
  );
}

export function AboutView() {
  return (
    <div className="w-full max-w-2xl">
      <ViewTitle>About</ViewTitle>
      <p className="mt-8 font-serif text-2xl leading-relaxed text-rice-paper/90">
        {GAME_NAME} is a small party game for the living room. Glossy liquid wrestlers, one
        floating island, and whoever is still standing.
      </p>
      <p className="mt-6 text-base leading-relaxed text-stone-blue">
        The big screen runs the game. Everyone else plays with the phone in their pocket.
      </p>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-t border-stone-blue/20 py-6 last:border-b">
      <div>
        <div className="font-serif text-2xl text-rice-paper">{label}</div>
        <div className="mt-0.5 text-sm text-stone-blue">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full border transition-colors duration-300 ease-ink outline-none focus-visible:ring-1 focus-visible:ring-rice-paper ${
        checked ? "border-scarlet bg-scarlet" : "border-stone-blue/40 bg-transparent"
      }`}
    >
      <span
        className={`absolute top-1 left-1 size-[22px] rounded-full transition-transform duration-300 ease-ink ${
          checked ? "translate-x-6 bg-rice-paper" : "translate-x-0 bg-stone-blue"
        }`}
      />
    </button>
  );
}
