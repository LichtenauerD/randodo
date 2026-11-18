// « Idéal… » : pour qui convient un lieu ou une boucle. Règles simples, lues dans la distance, la montée et le type de lieu.
export const AUDIENCES = [
  { id: 'potes', label: 'Entre potes', sub: 'une boucle qui se mérite' },
  { id: 'famille', label: 'En famille', sub: 'variée, sans excès' },
  { id: 'petits', label: 'Avec des petits', sub: 'court, peu de montée' },
  { id: 'couple', label: 'En couple', sub: 'un très beau coin' },
  { id: 'solo', label: 'En solo', sub: 'calme et nature' },
];
const FUN = new Set(['lac', 'cascade', 'chateau', 'grotte', 'rocher', 'gorge', 'refuge']); // de quoi occuper des enfants
const SCENIC = new Set(['vue', 'lac', 'cascade', 'chateau', 'tourbiere']);
const BIG = new Set(['sommet', 'vue', 'rocher', 'refuge', 'chateau', 'gorge', 'lac']);
const QUIET = new Set(['tourbiere', 'gorge', 'rocher', 'vue', 'sommet']);

// Une boucle : { km, up } ; type : type du lieu.
export function idealHike(h, type) {
  const km = h.km != null ? h.km : (h.meters || 0) / 1000, up = h.up || 0;
  const out = [];
  if (BIG.has(type) && ((km >= 11 && up >= 500) || up >= 750)) out.push('potes');
  if (FUN.has(type) && km <= 9 && up <= 400) out.push('famille');
  if (type !== 'sommet' && km <= 5.5 && up <= 200) out.push('petits');
  if (SCENIC.has(type) && km >= 5 && km <= 12 && up <= 600) out.push('couple');
  if (QUIET.has(type) && km >= 10) out.push('solo');
  return out;
}

// Un lieu : réunion de ses boucles ; sans boucle connue, d'après le type seul.
export function idealPlace(p, hikes) {
  const s = new Set();
  if (hikes && hikes.length) for (const h of hikes) for (const a of idealHike(h, p.type)) s.add(a);
  else {
    if (['sommet', 'refuge'].includes(p.type)) s.add('potes');
    if (FUN.has(p.type)) s.add('famille');
    if (SCENIC.has(p.type)) s.add('couple');
    if (QUIET.has(p.type)) s.add('solo');
  }
  return s;
}

export const idealLabel = (ids) => {
  const l = AUDIENCES.filter((a) => ids.includes(a.id)).map((a) => a.label.toLowerCase());
  return l.length ? 'Idéal ' + (l.length > 1 ? l.slice(0, -1).join(', ') + ' ou ' + l[l.length - 1] : l[0]) : '';
};
