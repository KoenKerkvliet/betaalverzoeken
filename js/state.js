// Houdt het geselecteerde schooljaar bij. De keuze wordt per browser bewaard
// in localStorage; het volledige schooljaar-object leeft in het geheugen.

const OPSLAG_SLEUTEL = 'tso_schooljaar_id';

let huidig = null; // { id, naam, tso_dagprijs }

export function setHuidigSchooljaar(sj) {
  huidig = sj;
  if (sj?.id) localStorage.setItem(OPSLAG_SLEUTEL, sj.id);
}

export function getHuidigSchooljaar() {
  return huidig;
}

export function getOpgeslagenSchooljaarId() {
  return localStorage.getItem(OPSLAG_SLEUTEL);
}
