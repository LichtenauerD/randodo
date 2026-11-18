/**
 * @OnlyCurrentDoc
 * Accès limité à cette seule feuille : le script ne peut ni lire ni modifier tes autres fichiers.
 */
/**
 * Randodo : carnet commun des randonnées du groupe.
 * À coller dans Extensions > Apps Script d'une feuille Google, puis à déployer en application web
 * (Exécuter en tant que : moi ; Accès : tout le monde). L'adresse obtenue, qui finit par /exec,
 * est « l'adresse du groupe » à saisir dans Randodo.
 */
const ONGLET = 'Randos';
const COLONNES = ['id', 'who', 'date', 'placeName', 'lat', 'lon', 'title', 'km', 'up', 'minutes', 'level', 'rating', 'note', 'owner', 'savedAt'];
const PUBLIQUES = COLONNES.filter(function (c) { return c !== 'owner' && c !== 'savedAt'; });

function feuille_() {
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  let f = classeur.getSheetByName(ONGLET);
  if (!f) {
    f = classeur.insertSheet(ONGLET);
    f.appendRow(COLONNES);
    f.setFrozenRows(1);
    f.getRange('A:D').setNumberFormat('@'); // identifiant, pseudo, date et lieu restent du texte
    f.getRange('G:G').setNumberFormat('@');
    f.getRange('M:N').setNumberFormat('@');
  }
  return f;
}

function classeur_() { return SpreadsheetApp.getActiveSpreadsheet(); }

// Idées repérées sur le web : onglet « Suggestions », une ligne par idée, rempli par la veille hebdomadaire ou à la main.
const SUGG = ['week', 'title', 'place', 'lat', 'lon', 'type', 'level', 'km', 'why', 'source', 'url'];
function suggestions_(classeur) {
  let f = classeur.getSheetByName('Suggestions');
  if (!f) {
    f = classeur.insertSheet('Suggestions');
    f.appendRow(SUGG);
    f.setFrozenRows(1);
    f.getRange('A:C').setNumberFormat('@');
    return [];
  }
  const lignes = f.getDataRange().getValues();
  const fuseau = Session.getScriptTimeZone();
  const out = [];
  for (let i = Math.max(1, lignes.length - 40); i < lignes.length; i++) {
    const e = {};
    SUGG.forEach(function (c, k) {
      let v = lignes[i][k];
      if (v instanceof Date) v = Utilities.formatDate(v, fuseau, 'yyyy-MM-dd');
      e[c] = v === '' ? null : v;
    });
    if (e.title) out.push(e);
  }
  return out;
}

// Membres : une ligne par téléphone, créée au premier lancement de l'appli (prénom demandé à l'ouverture).
function membres_(classeur) {
  let f = classeur.getSheetByName('Membres');
  if (!f) {
    f = classeur.insertSheet('Membres');
    f.appendRow(['who', 'owner', 'since', 'seen', 'grade', 'lieux', 'faits']);
    f.setFrozenRows(1);
    f.getRange('A:G').setNumberFormat('@');
  } else if (f.getLastColumn() < 7) {
    // Feuille d'avant la 1.6 : on ajoute les colonnes de progression.
    f.getRange(1, 5, 1, 3).setValues([['grade', 'lieux', 'faits']]);
  }
  const lignes = f.getDataRange().getValues();
  const liste = [];
  for (let i = 1; i < lignes.length; i++) if (lignes[i][0]) liste.push({ pid: pid_(String(lignes[i][1])), who: String(lignes[i][0]), since: String(lignes[i][2]).slice(0, 10), grade: String(lignes[i][4] || ''), lieux: Number(lignes[i][5]) || 0, faits: String(lignes[i][6] || '') });
  return { feuille: f, lignes: lignes, liste: liste };
}
function inscrire_(classeur, owner, who) {
  const m = membres_(classeur);
  const maintenant = new Date().toISOString();
  for (let i = 1; i < m.lignes.length; i++) {
    if (String(m.lignes[i][1]) === owner) {
      m.feuille.getRange(i + 1, 1).setValue(who);
      m.feuille.getRange(i + 1, 4).setValue(maintenant);
      return;
    }
  }
  m.feuille.appendRow([who, owner, maintenant, maintenant]);
}

// Identifiant public d'un membre : une empreinte de son identifiant d'appareil, qui ne permet pas d'agir à sa place.
function pid_(owner) {
  if (!owner) return null;
  const h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'randodo:' + owner);
  return h.slice(0, 6).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

// Compteur anonyme d'utilisateurs : un identifiant tiré au hasard (sans lien avec le prénom ni l'appareil),
// et le fait d'être ou non dans la communauté. Les lignes non revues depuis 6 mois sont effacées.
function utilisateurs_(classeur) {
  let f = classeur.getSheetByName('Utilisateurs');
  if (!f) { f = classeur.insertSheet('Utilisateurs'); f.appendRow(['anon', 'solo', 'seen']); f.setFrozenRows(1); f.getRange('A:C').setNumberFormat('@'); }
  return f;
}
function soloCount_(classeur) {
  const f = utilisateurs_(classeur), lignes = f.getDataRange().getValues();
  const limite = new Date(Date.now() - 183 * 864e5).toISOString();
  let n = 0;
  for (let i = 1; i < lignes.length; i++) if (String(lignes[i][1]) === 'oui' && String(lignes[i][2]) >= limite) n++;
  return n;
}

function reponse_(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet)).setMimeType(ContentService.MimeType.JSON);
}

// Texte sûr : longueur bornée, et jamais interprété comme une formule par la feuille.
function texte_(v, max) {
  let s = String(v === null || v === undefined ? '' : v).slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function nombre_(v) {
  const n = Number(v);
  return isFinite(n) ? n : '';
}

function doGet() {
  try {
    const f = feuille_();
    const lignes = f.getDataRange().getValues();
    const fuseau = Session.getScriptTimeZone();
    const entries = [];
    for (let i = 1; i < lignes.length; i++) {
      const e = {};
      PUBLIQUES.forEach(function (c) {
        let v = lignes[i][COLONNES.indexOf(c)];
        if (v instanceof Date) v = Utilities.formatDate(v, fuseau, 'yyyy-MM-dd');
        if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
        e[c] = v === '' ? null : v;
      });
      e.pid = pid_(String(lignes[i][COLONNES.indexOf('owner')]));
      if (e.id) entries.push(e);
    }
    return reponse_({ ok: true, entries: entries, suggestions: suggestions_(classeur_()), members: membres_(classeur_()).liste, solo: soloCount_(classeur_()) });
  } catch (err) {
    return reponse_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const verrou = LockService.getScriptLock();
  try {
    verrou.waitLock(15000);
    const d = JSON.parse(e.postData.contents);
    const f = feuille_();
    const lignes = f.getDataRange().getValues();
    const colId = COLONNES.indexOf('id'), colOwner = COLONNES.indexOf('owner');
    if (d.action === 'ping') {
      const anon = texte_(d.anon, 40);
      if (!anon) return reponse_({ ok: false, error: 'compteur vide' });
      const u = utilisateurs_(classeur_()), lu = u.getDataRange().getValues();
      const maintenant = new Date().toISOString(), limite = new Date(Date.now() - 183 * 864e5).toISOString();
      const val = [anon, d.solo ? 'oui' : 'non', maintenant];
      let vu = false;
      for (let i = lu.length - 1; i >= 1; i--) {
        if (String(lu[i][0]) === anon) { u.getRange(i + 1, 1, 1, 3).setValues([val]); vu = true; }
        else if (String(lu[i][2]) < limite) u.deleteRow(i + 1);
      }
      if (!vu) u.appendRow(val);
      return reponse_({ ok: true });
    }
    const owner = texte_(d.owner, 60);
    if (!owner) return reponse_({ ok: false, error: 'appareil non identifié' });
    if (d.action === 'progress') {
      // Progression d'un membre : grade, nombre de lieux faits, liste des lieux (identifiants courts).
      const m = membres_(classeur_());
      for (let i = 1; i < m.lignes.length; i++) {
        if (String(m.lignes[i][1]) === owner) {
          m.feuille.getRange(i + 1, 4, 1, 4).setValues([[new Date().toISOString(), texte_(d.grade, 40), String(nombre_(d.lieux) || 0), texte_(d.faits, 45000)]]);
          return reponse_({ ok: true });
        }
      }
      return reponse_({ ok: false, error: 'membre inconnu : rouvre l\'appli pour t\'inscrire' });
    }
    if (d.action === 'feedback') {
      // Retours de la phase de test : onglet « Retours », une ligne par message.
      const c = classeur_();
      let r = c.getSheetByName('Retours');
      if (!r) { r = c.insertSheet('Retours'); r.appendRow(['date', 'who', 'version', 'ecran', 'message', 'appareil']); r.setFrozenRows(1); r.getRange('A:F').setNumberFormat('@'); }
      const msg = texte_(d.message, 2000);
      if (!msg) return reponse_({ ok: false, error: 'message vide' });
      r.appendRow([new Date().toISOString(), texte_(d.who, 24), texte_(d.version, 12), texte_(d.screen, 80), msg, texte_(d.device, 200)]);
      return reponse_({ ok: true });
    }
    if (d.action === 'leave') {
      // Départ de la communauté : on retire ses randos partagées et sa ligne de membre.
      for (let i = lignes.length - 1; i >= 1; i--) if (String(lignes[i][colOwner]) === owner) f.deleteRow(i + 1);
      const m = membres_(classeur_());
      for (let i = m.lignes.length - 1; i >= 1; i--) if (String(m.lignes[i][1]) === owner) m.feuille.deleteRow(i + 1);
      return reponse_({ ok: true });
    }
    if (d.action === 'join') {
      const prenom = texte_(d.who, 24);
      if (!prenom) return reponse_({ ok: false, error: 'prénom manquant' });
      inscrire_(classeur_(), owner, prenom);
      return reponse_({ ok: true });
    }
    const id = texte_(d.action === 'add' ? d.entry && d.entry.id : d.id, 40);
    if (!id) return reponse_({ ok: false, error: 'identifiant manquant' });
    let ligne = -1;
    for (let i = 1; i < lignes.length; i++) if (String(lignes[i][colId]) === id) { ligne = i + 1; break; }
    // Seul l'appareil qui a partagé une rando peut la modifier ou la retirer.
    if (ligne > 0 && String(lignes[ligne - 1][colOwner]) !== owner) return reponse_({ ok: false, error: 'cette rando appartient à quelqu\'un d\'autre' });

    if (d.action === 'delete') {
      if (ligne > 0) f.deleteRow(ligne);
      return reponse_({ ok: true });
    }
    if (d.action === 'add') {
      const x = d.entry || {};
      const valeurs = [id, texte_(x.who, 24), texte_(x.date, 10), texte_(x.placeName, 80), nombre_(x.lat), nombre_(x.lon), texte_(x.title, 120),
        nombre_(x.km), nombre_(x.up), nombre_(x.minutes), texte_(x.level, 12), nombre_(x.rating), texte_(x.note, 600), owner, new Date().toISOString()];
      if (ligne > 0) f.getRange(ligne, 1, 1, valeurs.length).setValues([valeurs]);
      else f.appendRow(valeurs);
      return reponse_({ ok: true });
    }
    return reponse_({ ok: false, error: 'action inconnue' });
  } catch (err) {
    return reponse_({ ok: false, error: String(err) });
  } finally {
    try { verrou.releaseLock(); } catch (err2) { /* rien */ }
  }
}
