// État partagé : envie du jour, historique, liste d'envies, traces enregistrées.
import { kv, settings, dist, norm, uid, slugOf } from './util.js';

const listeners = {};
export const bus = {
  on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
  emit(ev, data) { (listeners[ev] || []).forEach((fn) => fn(data)); },
};

export const DEFAULT_WISH = { levels: [], maxKm: 25, maxUp: 1500, maxH: 9, types: [], hideDone: false };
export const want = { ...DEFAULT_WISH, ...settings.get('want', {}) };
export function saveWant() { settings.set('want', want); bus.emit('want'); }
export function wantActive() {
  return want.levels.length > 0 || want.maxKm < 25 || want.maxUp < 1500 || want.maxH < 9 || want.types.length > 0 || want.hideDone;
}
// Une rando correspond-elle à l'envie du jour ?
export function fits(h) {
  if (want.levels.length && !want.levels.includes(h.level)) return false;
  if (want.maxKm < 25 && h.meters / 1000 > want.maxKm) return false;
  if (want.maxUp < 1500 && (h.up || 0) > want.maxUp) return false;
  if (want.maxH < 9 && h.minutes / 60 > want.maxH) return false;
  return true;
}

export const store = {
  log: [], wish: [], hikes: [], visited: {}, ready: false,
  async load() {
    this.log = (await kv.get('log')) || [];
    this.wish = (await kv.get('wish')) || [];
    this.visited = (await kv.get('visited')) || {};
    const keys = await kv.keys('hike:');
    this.hikes = (await Promise.all(keys.map((k) => kv.get(k)))).filter(Boolean).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    this.ready = true;
  },
  doneEntry(place) {
    const n = norm(place.name);
    return this.log.find((e) => e.placeId === place.id || (e.lat != null && dist([e.lat, e.lon], [place.lat, place.lon]) < 350 && norm(e.placeName) === n));
  },
  // Un lieu est fait s'il est coché (« j'y suis allé ») ou s'il a une sortie dans l'historique.
  isVisited(place) { return !!this.visited[slugOf(place.name)]; },
  isDone(place) { return this.isVisited(place) || !!this.doneEntry(place); },
  async setVisited(place, on, date) {
    const k = slugOf(place.name);
    if (on) this.visited[k] = date || new Date().toISOString().slice(0, 10); else delete this.visited[k];
    await kv.set('visited', this.visited);
    bus.emit('log');
  },
  isWished(place) { return this.wish.some((w) => w.id === place.id); },
  async toggleWish(place) {
    if (this.isWished(place)) this.wish = this.wish.filter((w) => w.id !== place.id);
    else this.wish.unshift({ id: place.id, name: place.name, type: place.type, lat: place.lat, lon: place.lon, t: Date.now() });
    await kv.set('wish', this.wish);
    bus.emit('wish');
  },
  async addLog(entry) {
    const e = { id: uid(), date: new Date().toISOString().slice(0, 10), ...entry };
    this.log = this.log.filter((x) => x.id !== e.id);
    this.log.unshift(e);
    this.log.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    await kv.set('log', this.log);
    // Une rando faite sort de la liste d'envies.
    if (e.placeId && this.wish.some((w) => w.id === e.placeId)) { this.wish = this.wish.filter((w) => w.id !== e.placeId); await kv.set('wish', this.wish); }
    bus.emit('log');
    return e;
  },
  async removeLog(id) {
    this.log = this.log.filter((x) => x.id !== id);
    await kv.set('log', this.log);
    bus.emit('log');
  },
  async saveHike(h) {
    h.savedAt = Date.now();
    await kv.set('hike:' + h.id, h);
    this.hikes = [h, ...this.hikes.filter((x) => x.id !== h.id)];
    bus.emit('hikes');
  },
  async removeHike(id) {
    await kv.del('hike:' + id);
    this.hikes = this.hikes.filter((x) => x.id !== id);
    bus.emit('hikes');
  },
  isSaved(id) { return this.hikes.some((x) => x.id === id); },
  // Sauvegarde complète, pour changer de téléphone ou garder une copie.
  async exportAll() {
    return JSON.stringify({ app: 'randodo', version: 1, date: new Date().toISOString(), log: this.log, wish: this.wish, visited: this.visited, hikes: this.hikes, want, pseudo: settings.get('pseudo', ''), deviceKey: settings.get('deviceKey', ''), community: settings.get('community', ''), lastGrade: settings.get('lastGrade', null) });
  },
  async importAll(text) {
    const d = JSON.parse(text);
    if (!d || (d.app !== 'randodo' && d.app !== 'cairn')) throw new Error('Ce fichier n\'est pas une sauvegarde Randodo.');
    const ids = new Set(this.log.map((e) => e.id));
    for (const e of d.log || []) if (!ids.has(e.id)) this.log.push(e);
    this.log.sort((a, b) => (a.date < b.date ? 1 : -1));
    const w = new Set(this.wish.map((x) => x.id));
    for (const x of d.wish || []) if (!w.has(x.id)) this.wish.push(x);
    this.visited = { ...(d.visited || {}), ...this.visited };
    await kv.set('log', this.log); await kv.set('wish', this.wish); await kv.set('visited', this.visited);
    for (const h of d.hikes || []) if (!this.isSaved(h.id)) await this.saveHike(h);
    // Même identité dans le groupe qu'avant (utile après avoir réinstallé l'appli).
    if (d.pseudo && !settings.get('pseudo', '')) settings.set('pseudo', d.pseudo);
    if (d.deviceKey) { settings.set('deviceKey', d.deviceKey); settings.set('joined', ''); settings.set('progressSent', ''); }
    if (d.community) settings.set('community', d.community);
    if (d.lastGrade != null) settings.set('lastGrade', d.lastGrade);
    bus.emit('log'); bus.emit('wish');
    return { log: (d.log || []).length, hikes: (d.hikes || []).length };
  },
};
