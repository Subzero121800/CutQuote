import { useState, useMemo } from "react";

// ------------------------------------------------------------------
// CUTQUOTE — field pricing for lawn work
// Operator mode: full cost-up engine. Homeowner mode: fair-price check.
// Routing: Nominatim geocoding + OSRM public routing (no API keys).
// ------------------------------------------------------------------

const MOWERS = {
  push21: { label: '21" push mower', acHr: 0.22, galHr: 0.3 },
  walk30: { label: '30" walk-behind', acHr: 0.35, galHr: 0.4 },
  rider42: { label: '42" lawn tractor', acHr: 0.8, galHr: 0.9 },
  ztr48: { label: '48" zero-turn', acHr: 1.4, galHr: 1.2 },
  ztr60: { label: '60" zero-turn', acHr: 2.0, galHr: 1.5 },
};
const TERRAIN = { flat: { label: "Flat", f: 1.0 }, rolling: { label: "Rolling", f: 0.8 }, steep: { label: "Steep / banks", f: 0.6 } };
const OBSTACLES = { open: { label: "Wide open", f: 1.0 }, some: { label: "Some trees & beds", f: 0.85 }, tight: { label: "Tight / fenced / many obstacles", f: 0.7 } };
const FREQ = { weekly: { label: "Weekly", f: 1.0, cuts: 26 }, biweekly: { label: "Every 2 weeks", f: 1.15, cuts: 13 }, once: { label: "One-time / overgrown", f: 1.5, cuts: 1 } };

const fmt = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmt2 = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function geocode(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("geocode failed");
  const j = await r.json();
  if (!j.length) throw new Error(`Address not found: "${q}"`);
  return { lat: +j[0].lat, lon: +j[0].lon, name: j[0].display_name };
}
async function route(a, b) {
  const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
  if (!r.ok) throw new Error("routing failed");
  const j = await r.json();
  if (!j.routes || !j.routes.length) throw new Error("No drivable route found");
  return { miles: j.routes[0].distance / 1609.34, minutes: j.routes[0].duration / 60 };
}

export default function CutQuote() {
  const [mode, setMode] = useState("homeowner");

  // Addresses & route
  const [baseAddr, setBaseAddr] = useState("");
  const [jobAddr, setJobAddr] = useState("");
  const [routeInfo, setRouteInfo] = useState(null); // {miles, minutes, from, to}
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeErr, setRouteErr] = useState("");
  const [manualMiles, setManualMiles] = useState(8);
  const [manualMins, setManualMins] = useState(15);
  const [useManual, setUseManual] = useState(false);

  // Property
  const [acres, setAcres] = useState(1.0);
  const [mowablePct, setMowablePct] = useState(85);
  const [terrain, setTerrain] = useState("flat");
  const [obstacles, setObstacles] = useState("some");
  const [freq, setFreq] = useState("weekly");

  // Time settings
  const [trimMins, setTrimMins] = useState(20);
  const [loadMins, setLoadMins] = useState(10);

  // Operator economics
  const [mower, setMower] = useState("ztr48");
  const [crew, setCrew] = useState(1);
  const [laborRate, setLaborRate] = useState(50);
  const [drivePct, setDrivePct] = useState(60);
  const [mpg, setMpg] = useState(12);
  const [fuel, setFuel] = useState(3.45);
  const [margin, setMargin] = useState(20);
  const [minCharge, setMinCharge] = useState(55);

  const eff = useManual || !routeInfo ? { miles: +manualMiles || 0, minutes: +manualMins || 0 } : routeInfo;

  const q = useMemo(() => {
    const mowAcres = acres * (mowablePct / 100);
    const rate = MOWERS[mower].acHr * TERRAIN[terrain].f * OBSTACLES[obstacles].f;
    const mowHrs = (mowAcres / Math.max(rate, 0.01)) * FREQ[freq].f;
    const siteHrs = mowHrs + (trimMins + loadMins) / 60;
    const laborCost = siteHrs * laborRate * crew;
    const driveHrs = (eff.minutes * 2) / 60;
    const driveCost = driveHrs * laborRate * crew * (drivePct / 100);
    const vehFuel = ((eff.miles * 2) / Math.max(mpg, 1)) * fuel;
    const mowFuel = mowHrs * MOWERS[mower].galHr * fuel;
    const cost = laborCost + driveCost + vehFuel + mowFuel;
    const priced = cost * (1 + margin / 100);
    const perCut = Math.max(priced, minCharge);
    return {
      mowAcres, mowHrs, siteHrs, laborCost, driveHrs, driveCost, vehFuel, mowFuel, cost, perCut,
      season: perCut * FREQ[freq].cuts,
      lo: Math.max(perCut * 0.85, minCharge), hi: perCut * 1.2,
    };
  }, [acres, mowablePct, terrain, obstacles, freq, trimMins, loadMins, mower, crew, laborRate, drivePct, mpg, fuel, margin, minCharge, eff.miles, eff.minutes]);

  const calcRoute = async () => {
    setRouteErr(""); setRouteBusy(true); setRouteInfo(null);
    try {
      if (!jobAddr.trim()) throw new Error("Enter the job address first.");
      if (!baseAddr.trim()) throw new Error(mode === "operator" ? "Enter your shop or home base address." : "Enter the contractor's town or address (or use manual miles below).");
      const [a, b] = [await geocode(baseAddr), await geocode(jobAddr)];
      const r = await route(a, b);
      setRouteInfo({ ...r, from: a.name.split(",").slice(0, 3).join(","), to: b.name.split(",").slice(0, 3).join(",") });
      setUseManual(false);
    } catch (e) {
      setRouteErr(e.message + " — you can enter miles and minutes manually below.");
      setUseManual(true);
    } finally { setRouteBusy(false); }
  };

  const op = mode === "operator";
  const C = op ? "#E8641C" : "#3E7A3A"; // safety orange vs cut-grass green

  const Label = ({ children }) => (
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: ".12em", fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#5A6258" }} className="mb-1">{children}</div>
  );
  const Num = ({ v, set, step = 1, min = 0, w = "w-24", suffix }) => (
    <div className="flex items-center gap-1">
      <input type="number" value={v} step={step} min={min} onChange={(e) => set(+e.target.value)} className={`${w} rounded border border-stone-300 bg-white px-2 py-1.5 text-sm`} style={{ fontFamily: "'IBM Plex Mono',monospace" }} />
      {suffix && <span className="text-xs text-stone-500">{suffix}</span>}
    </div>
  );
  const Seg = ({ opts, val, set }) => (
    <div className="flex flex-wrap gap-1">
      {Object.entries(opts).map(([k, o]) => (
        <button key={k} onClick={() => set(k)} className="rounded px-2.5 py-1.5 text-xs font-medium transition-colors" style={val === k ? { background: "#1E241C", color: "#F2F0E6" } : { background: "#E9E6DA", color: "#4A4F45" }}>{o.label}</button>
      ))}
    </div>
  );
  const Line = ({ l, r, sub, bold }) => (
    <div className={`flex items-baseline justify-between py-1 ${bold ? "" : "border-b border-dashed border-stone-300"}`}>
      <div><span className={`text-sm ${bold ? "font-semibold" : ""}`}>{l}</span>{sub && <span className="ml-2 text-xs text-stone-500">{sub}</span>}</div>
      <span className={bold ? "text-base font-semibold" : "text-sm"} style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{r}</span>
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: "#DEDBCE", color: "#22281F" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@400;600&family=Inter:wght@400;500;600&display=swap');
        body{font-family:'Inter',sans-serif}
        .ticket{filter:drop-shadow(0 6px 14px rgba(30,36,28,.18))}
        .perf{--r:7px;-webkit-mask:radial-gradient(circle at 50% 0,transparent var(--r),#000 calc(var(--r) + .5px)) 50% 0/ 24px 100% repeat-x}
        input:focus,button:focus-visible,select:focus{outline:2px solid ${C};outline-offset:1px}
        @media (prefers-reduced-motion: reduce){*{transition:none!important}}`}</style>

      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Masthead */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, fontSize: 40, lineHeight: 1, letterSpacing: ".01em" }}>
              CUT<span style={{ color: C }}>QUOTE</span>
            </div>
            <div className="mt-1 text-sm text-stone-600">Address-to-address lawn pricing with the math showing.</div>
          </div>
          {/* Equipment-style mode switch */}
          <div className="flex items-center rounded-lg p-1" style={{ background: "#1E241C" }} role="tablist" aria-label="Mode">
            {[["homeowner", "HOMEOWNER"], ["operator", "OWNER / OPERATOR"]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className="rounded-md px-4 py-2 text-xs font-bold tracking-widest transition-colors"
                style={{ fontFamily: "'Barlow Condensed',sans-serif", background: mode === k ? (k === "operator" ? "#E8641C" : "#3E7A3A") : "transparent", color: mode === k ? "#fff" : "#8B9284" }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          {/* ------- LEFT: INPUTS ------- */}
          <div className="space-y-5">
            {/* Route */}
            <section className="rounded-lg border border-stone-300 bg-[#F2F0E6] p-4">
              <Label>{op ? "Route: shop to job" : "Route: how far is the crew coming?"}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={baseAddr} onChange={(e) => setBaseAddr(e.target.value)} placeholder={op ? "Your shop / home base address" : "Contractor town or address (optional)"} className="rounded border border-stone-300 bg-white px-3 py-2 text-sm" />
                <input value={jobAddr} onChange={(e) => setJobAddr(e.target.value)} placeholder="Job address (e.g. 612 Cemetery Rd, Perryopolis, PA)" className="rounded border border-stone-300 bg-white px-3 py-2 text-sm" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button onClick={calcRoute} disabled={routeBusy} className="rounded px-4 py-2 text-xs font-bold tracking-widest text-white disabled:opacity-50" style={{ fontFamily: "'Barlow Condensed',sans-serif", background: "#1E241C" }}>
                  {routeBusy ? "ROUTING..." : "CALCULATE ROUTE"}
                </button>
                {routeInfo && !useManual && (
                  <span className="text-sm" style={{ fontFamily: "'IBM Plex Mono',monospace" }}>
                    {routeInfo.miles.toFixed(1)} mi · {Math.round(routeInfo.minutes)} min each way
                  </span>
                )}
                <label className="ml-auto flex items-center gap-2 text-xs text-stone-600">
                  <input type="checkbox" checked={useManual} onChange={(e) => setUseManual(e.target.checked)} /> enter manually
                </label>
              </div>
              {routeErr && <div className="mt-2 rounded bg-amber-100 px-3 py-2 text-xs text-amber-900">{routeErr}</div>}
              {(useManual || !routeInfo) && (
                <div className="mt-3 flex flex-wrap items-end gap-4">
                  <div><Label>One-way miles</Label><Num v={manualMiles} set={setManualMiles} step={0.5} /></div>
                  <div><Label>One-way drive minutes</Label><Num v={manualMins} set={setManualMins} /></div>
                </div>
              )}
            </section>

            {/* Property */}
            <section className="rounded-lg border border-stone-300 bg-[#F2F0E6] p-4">
              <Label>The lawn</Label>
              <div className="flex flex-wrap items-end gap-5">
                <div>
                  <Label>Lot size (acres)</Label>
                  <div className="flex items-center gap-3">
                    <input type="range" min="0.1" max="5" step="0.05" value={acres} onChange={(e) => setAcres(+e.target.value)} className="w-40" style={{ accentColor: C }} aria-label="Lot size in acres" />
                    <Num v={acres} set={setAcres} step={0.05} w="w-20" />
                  </div>
                </div>
                <div><Label>% actually mowable</Label><Num v={mowablePct} set={setMowablePct} suffix="%" w="w-20" /></div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div><Label>Terrain</Label><Seg opts={TERRAIN} val={terrain} set={setTerrain} /></div>
                <div><Label>Obstacles</Label><Seg opts={OBSTACLES} val={obstacles} set={setObstacles} /></div>
              </div>
              <div className="mt-3"><Label>Cut frequency</Label><Seg opts={FREQ} val={freq} set={setFreq} /></div>
            </section>

            {/* Time settings */}
            <section className="rounded-lg border border-stone-300 bg-[#F2F0E6] p-4">
              <Label>Time settings</Label>
              <div className="flex flex-wrap items-end gap-5">
                <div><Label>Trim + edge + blow (min)</Label><Num v={trimMins} set={setTrimMins} /></div>
                <div><Label>Load / unload (min)</Label><Num v={loadMins} set={setLoadMins} /></div>
                <div><Label>Equipment</Label>
                  <select value={mower} onChange={(e) => setMower(e.target.value)} className="rounded border border-stone-300 bg-white px-2 py-1.5 text-sm">
                    {Object.entries(MOWERS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                  </select>
                </div>
              </div>
            </section>

            {/* Fuel & mileage — both modes per spec */}
            <section className="rounded-lg border border-stone-300 bg-[#F2F0E6] p-4">
              <Label>Fuel & mileage settings</Label>
              <div className="flex flex-wrap items-end gap-5">
                <div><Label>Fuel price</Label><Num v={fuel} set={setFuel} step={0.05} suffix="$/gal" w="w-20" /></div>
                <div><Label>Truck MPG</Label><Num v={mpg} set={setMpg} w="w-20" /></div>
                {op && <div><Label>Drive time billed at</Label><Num v={drivePct} set={setDrivePct} suffix="% of labor rate" w="w-20" /></div>}
              </div>
            </section>

            {/* Operator economics */}
            {op && (
              <section className="rounded-lg border-2 p-4" style={{ borderColor: C, background: "#F2F0E6" }}>
                <Label>Operator economics</Label>
                <div className="flex flex-wrap items-end gap-5">
                  <div><Label>Crew size</Label><Num v={crew} set={setCrew} min={1} w="w-16" /></div>
                  <div><Label>Labor rate / person</Label><Num v={laborRate} set={setLaborRate} suffix="$/hr" w="w-20" /></div>
                  <div><Label>Overhead + margin</Label><Num v={margin} set={setMargin} suffix="%" w="w-20" /></div>
                  <div><Label>Minimum charge</Label><Num v={minCharge} set={setMinCharge} suffix="$" w="w-20" /></div>
                </div>
              </section>
            )}
          </div>

          {/* ------- RIGHT: THE ROUTE TICKET ------- */}
          <div className="ticket sticky top-6 self-start">
            <div className="perf rounded-b-lg bg-white px-5 pb-5 pt-6">
              <div className="mb-1 flex items-baseline justify-between">
                <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 700, letterSpacing: ".14em", fontSize: 13 }}>{op ? "WORK TICKET" : "FAIR PRICE CHECK"}</span>
                <span className="text-[10px] tracking-widest text-stone-400" style={{ fontFamily: "'IBM Plex Mono',monospace" }}>NO. {String(Math.round(acres * 100 + eff.miles)).padStart(4, "0")}</span>
              </div>
              {routeInfo && !useManual && <div className="mb-2 truncate text-[11px] text-stone-500">{routeInfo.to}</div>}
              <div className="mb-3 border-t-2 border-stone-800" />

              <Line l="Mowable area" r={`${q.mowAcres.toFixed(2)} ac`} sub={`${acres} ac × ${mowablePct}%`} />
              <Line l="Deck time" r={`${(q.mowHrs * 60).toFixed(0)} min`} sub={MOWERS[mower].label} />
              <Line l="Trim / edge / load" r={`${trimMins + loadMins} min`} />
              <Line l="Drive (round trip)" r={`${(eff.minutes * 2).toFixed(0)} min · ${(eff.miles * 2).toFixed(1)} mi`} />

              {op ? (
                <>
                  <div className="mt-3 mb-1 text-[10px] tracking-widest text-stone-400" style={{ fontFamily: "'Barlow Condensed',sans-serif" }}>COST BUILD-UP</div>
                  <Line l="On-site labor" r={fmt2(q.laborCost)} sub={`${q.siteHrs.toFixed(2)} hr × ${crew} × $${laborRate}`} />
                  <Line l="Windshield time" r={fmt2(q.driveCost)} sub={`${drivePct}% of rate`} />
                  <Line l="Truck fuel" r={fmt2(q.vehFuel)} />
                  <Line l="Mower fuel" r={fmt2(q.mowFuel)} />
                  <Line l={`Margin ${margin}%`} r={fmt2(q.perCut - q.cost > 0 ? q.cost * (margin / 100) : 0)} />
                  <div className="mt-3 rounded-md px-3 py-3 text-white" style={{ background: "#1E241C" }}>
                    <div className="flex items-baseline justify-between">
                      <span style={{ fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: ".12em", fontSize: 12 }}>QUOTE PER CUT</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 26, fontWeight: 600, color: "#FFB27A" }}>{fmt(q.perCut)}</span>
                    </div>
                    {q.perCut === minCharge && <div className="mt-1 text-[11px] text-stone-300">Held at your ${minCharge} minimum.</div>}
                  </div>
                </>
              ) : (
                <div className="mt-4">
                  <div className="rounded-md px-3 py-3 text-white" style={{ background: "#1E241C" }}>
                    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: ".12em", fontSize: 12 }}>FAIR RANGE PER CUT</div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 26, fontWeight: 600, color: "#9FD98A" }}>{fmt(q.lo)}</span>
                      <span className="text-stone-400">to</span>
                      <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 26, fontWeight: 600, color: "#9FD98A" }}>{fmt(q.hi)}</span>
                    </div>
                  </div>
                  <div className="mt-2 text-[12px] leading-relaxed text-stone-600">
                    Quotes under <b>{fmt(q.lo * 0.85)}</b> usually mean corners cut or a crew that won't last the season. Quotes over <b>{fmt(q.hi * 1.15)}</b> are city pricing on this lawn.
                  </div>
                </div>
              )}

              <div className="mt-3 flex items-baseline justify-between border-t border-stone-300 pt-2">
                <span className="text-xs text-stone-500">{FREQ[freq].label} · {FREQ[freq].cuts} cut{FREQ[freq].cuts > 1 ? "s" : ""}/season</span>
                <span className="text-sm font-semibold" style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{fmt(op ? q.season : ((q.lo + q.hi) / 2) * FREQ[freq].cuts)} / season</span>
              </div>
              <div className="mt-3 text-[10px] leading-relaxed text-stone-400">Estimates only. Routing © OpenStreetMap contributors via OSRM. Verify lot size against the county parcel record.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
