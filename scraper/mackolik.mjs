// Mackolik Arşiv Toplayıcı 7.0 — GitHub Actions sürümü (Node 20+, ek paket yok)
// Oranı açılan bütün futbol maçları · maç önü İddaa oranları + MBS + maç sonu istatistikleri
//
// MOD=guncel : son günleri günceller (her saat)
// MOD=gecmis : 5 yıllık geçmişin kendi parçasını tarar (PARCA / PARCA_SAYI, paralel işler)
// MOD=test   : birkaç günü dener, debug/ klasörüne teşhis dosyaları yazar, veriye dokunmaz
// MOD=csv    : CSV dosyalarını üretir (cikti/)

import fs from 'node:fs/promises';
import path from 'node:path';

const KOK = process.cwd();
const VERI = path.join(KOK, 'data');
const CIKTI = path.join(KOK, 'cikti');
const DEBUG = path.join(KOK, 'debug');
const BASE = 'https://arsiv.mackolik.com';

let MOD = (process.env.MOD || 'guncel').trim();
if (MOD === 'normal') MOD = 'guncel';
const BUTCE_DK = +process.env.BUTCE_DK || 45;     // bir çalışmada en fazla kaç dakika
const YIL = +process.env.YIL || 5;                 // geriye kaç yıl
const PARALEL = +process.env.PARALEL || 6;         // aynı anda kaç maç sayfası
const BEKLE = +process.env.BEKLE || 100;           // istekler arası bekleme (ms)
const SON_GUN = +process.env.SON_GUN || 3;         // son kaç gün her saat yeniden kontrol edilir
const ANKRAJ = process.env.ANKRAJ || '2026-09-07'; // geçmiş tarama bu günden geriye, güncel bundan ileriye
const PARCA = +process.env.PARCA || 0;
const PARCA_SAYI = +process.env.PARCA_SAYI || 1;
const MBS_ALAN = process.env.MBS_ALAN === undefined || process.env.MBS_ALAN === '' ? null : +process.env.MBS_ALAN;
const BITIS = Date.now() + BUTCE_DK * 60000;
const zamanBitti = () => Date.now() > BITIS;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ==================================================================
   0) Ligler — 5.3 ile aynı
   ================================================================== */
const sade = s => (s || '')
  .replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()
  .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
  .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
  .replace(/\s+/g, ' ').trim();

const YASAK = /kadin|women|bayan|u\s?1[4-9]\b|u\s?2[0-3]\b|genc|youth|junior|reserv|akademi|amator|dostluk|hazirlik|basket|voleybol|hentbol|futsal|plaj|e-?spor|kupa|\bcup\b|\bcopa\b|coupe|pokal|trophy|shield|rfef|federacion|challenger|next pro|northern|southern|isthmian|\bii\b/;
// Takım adına göre de ele: U21, "II", "B" takımları, kadın takımları
const TAKIM_YASAK = /\bu\s?(1[4-9]|2[0-3])\b|\sii$|\siii$|\sb$|\(k\)|\(w\)|kadin|women|reserves?$|akademi/;

const LIGLER = [
  { ad: 'İngiltere - Premier Lig',   u: ['ingiltere'],                 t: l => /premier/.test(l) && !/division|\b2\b|u2\d|international|national/.test(l) },
  { ad: 'İngiltere - Championship',  u: ['ingiltere'],                 t: l => /championship/.test(l) },
  { ad: 'İngiltere - League One',    u: ['ingiltere'],                 t: l => /league one|lig 1|1\.\s*lig/.test(l) && !/premier|national/.test(l) },
  { ad: 'İngiltere - League Two',    u: ['ingiltere'],                 t: l => /league two|lig 2|2\.\s*lig/.test(l) && !/premier|national/.test(l) },
  { ad: 'İspanya - LaLiga 2',        u: ['ispanya'],                   t: l => /la\s?liga\s*2|hypermotion|smartbank|segunda|\b2\.?\s*lig\b|\blig\s*2\b/.test(l) },
  { ad: 'İspanya - LaLiga',          u: ['ispanya'],                   t: l => /la\s?liga|primera|ea sports/.test(l) && !/\b2\b|femenin|division 2/.test(l) },
  { ad: 'Almanya - 2. Bundesliga',   u: ['almanya'],                   t: l => /2\.?\s*bundesliga|bundesliga\s*2/.test(l) },
  { ad: 'Almanya - Bundesliga',      u: ['almanya'],                   t: l => /bundesliga/.test(l) },
  { ad: 'İtalya - Serie B',          u: ['italya'],                    t: l => /serie\s*b/.test(l) },
  { ad: 'İtalya - Serie A',          u: ['italya'],                    t: l => /serie\s*a/.test(l) },
  { ad: 'Fransa - Ligue 2',          u: ['fransa'],                    t: l => /ligue\s*2/.test(l) },
  { ad: 'Fransa - Ligue 1',          u: ['fransa'],                    t: l => /ligue\s*1|mcdonald/.test(l) },
  { ad: 'Türkiye - Süper Lig',       u: ['turkiye'],                   t: l => /super lig/.test(l) },
  { ad: 'Türkiye - 1. Lig',          u: ['turkiye'],                   t: l => /(tff\s*)?1\.?\s*lig/.test(l) && !/super/.test(l) },
  { ad: 'Hollanda - Eredivisie',     u: ['hollanda'],                  t: l => /eredivisie/.test(l) && !/eerste/.test(l) },
  { ad: 'Portekiz - Liga Portugal',  u: ['portekiz'],                  t: l => /(liga portugal|primeira|premier|betclic)/.test(l) && !/\b2\b|sabseg|meu super/.test(l) },
  { ad: 'Belçika - Pro League',      u: ['belcika'],                   t: l => /pro\s*lig|pro\s*league|jupiler|birinci lig/.test(l) },
  { ad: 'İskoçya - Premiership',     u: ['iskocya'],                   t: l => /premiership|premier/.test(l) },
  { ad: 'Rusya - Premier Lig',       u: ['rusya'],                     t: l => /premier/.test(l) },
  { ad: 'İsveç - Allsvenskan',       u: ['isvec'],                     t: l => /allsvenskan/.test(l) && !/super/.test(l) },
  { ad: 'ABD - MLS',                 u: ['abd', 'amerika', 'usa'],     t: l => /mls|major league/.test(l) },
  { ad: 'Avustralya - A-League',     u: ['avustralya'],                t: l => /a.?league/.test(l) },
  { ad: 'Avusturya - Bundesliga',    u: ['avusturya'],                 t: l => /bundesliga/.test(l) && !/\b2\b/.test(l) },
  { ad: 'İsviçre - Super League',    u: ['isvicre'],                   t: l => /super\s*lig|super\s*league/.test(l) && !/challenge/.test(l) },
  { ad: 'Danimarka - Superliga',     u: ['danimarka'],                 t: l => /superlig|super\s*lig/.test(l) && !/\b1\.|\b2\b/.test(l) },
  { ad: 'Norveç - Eliteserien',      u: ['norvec'],                    t: l => /eliteserien|elite/.test(l) },
  { ad: 'Polonya - Ekstraklasa',     u: ['polonya'],                   t: l => /ekstraklasa/.test(l) },
  { ad: 'Çekya - 1. Lig',            u: ['cekya', 'cek cumhuriyeti'],  t: l => /1\.?\s*lig|fortuna|chance liga/.test(l) },
  { ad: 'Yunanistan - Super League', u: ['yunanistan'],                t: l => /super\s*lig|super\s*league/.test(l) && !/\b2\b/.test(l) },
  { ad: 'Romanya - Liga 1',          u: ['romanya'],                   t: l => /liga\s*1|liga\s*i\b|superlig/.test(l) && !/\b2\b/.test(l) },
  { ad: 'Sırbistan - SuperLiga',     u: ['sirbistan'],                 t: l => /superlig|super\s*lig/.test(l) && !/\b2\b/.test(l) },
  { ad: 'Hırvatistan - HNL',         u: ['hirvatistan'],               t: l => /hnl|prva|1\.?\s*lig/.test(l) && !/\b2\.|druga/.test(l) },
  { ad: 'Güney Kore - K League 1',   u: ['guney kore', 'kore'],        t: l => /k.?leag|k.?lig/.test(l) && !/\b2\b/.test(l) },
  { ad: 'Japonya - J1 League',       u: ['japonya'],                   t: l => /j1|j.?league\s*1|j.?lig\s*1/.test(l) && !/j2|j3/.test(l) },
  { ad: 'Kanada - Premier League',   u: ['kanada'],                    t: l => /premier/.test(l) }
];

// LIGLER = 'hepsi' → oranı açılan bütün maçlar (varsayılan)
// Sadece bazı ligler istenirse virgülle yazılır. Örn: 'Premier Lig, Süper Lig'
const LIG_FILTRE = (process.env.LIGLER || 'hepsi').trim();
const HEPSI = !LIG_FILTRE || sade(LIG_FILTRE) === 'hepsi';
const SECILI = (() => {
  const s = HEPSI ? [] : LIG_FILTRE.split(',').map(sade).filter(Boolean);
  const hepsi = LIGLER.map(x => x.ad);
  return new Set(s.length ? hepsi.filter(ad => s.some(x => sade(ad).includes(x))) : hepsi);
})();

const ligOnbellek = new Map();
function ligCoz(baslik) {
  if (ligOnbellek.has(baslik)) return ligOnbellek.get(baslik);
  const s = sade(baslik);
  let bulunan = null;
  if (!YASAK.test(s)) {
    const par = s.split(/\s[-–]\s/);
    const u = par[0];
    const l = par.length > 1 ? par.slice(1).join(' - ') : s;
    for (const L of LIGLER) if (L.u.some(x => u.includes(x)) && L.t(l)) { bulunan = L.ad; break; }
  }
  ligOnbellek.set(baslik, bulunan);
  return bulunan;
}

/* ==================================================================
   1) Marketler — 5.3 ile aynı (CSV sütun sırası)
   ================================================================== */
const M = [
  { k: 'MS',        sec: ['1', 'X', '2'],       tur: 'ms',   test: a => a === 'Maç Sonucu' },
  { k: 'ÇŞ',        sec: ['1-X', '1-2', 'X-2'], tur: 'cs',   test: a => a === 'Çifte Şans' },
  { k: 'KG',        sec: ['Var', 'Yok'],        tur: 'kg',   test: a => /^Karşılıklı Gol/.test(a) },
  { k: 'HND 1:0',   sec: ['1', 'X', '2'],       tur: 'hnd',  hd: [1, 0], test: a => /^Handikapl. Maç Sonucu \(\s*1\s*[:.\-]\s*0\s*\)$/.test(a) },
  { k: 'HND 0:1',   sec: ['1', 'X', '2'],       tur: 'hnd',  hd: [0, 1], test: a => /^Handikapl. Maç Sonucu \(\s*0\s*[:.\-]\s*1\s*\)$/.test(a) },
  { k: 'HND 2:0',   sec: ['1', 'X', '2'],       tur: 'hnd',  hd: [2, 0], test: a => /^Handikapl. Maç Sonucu \(\s*2\s*[:.\-]\s*0\s*\)$/.test(a) },
  { k: 'HND 0:2',   sec: ['1', 'X', '2'],       tur: 'hnd',  hd: [0, 2], test: a => /^Handikapl. Maç Sonucu \(\s*0\s*[:.\-]\s*2\s*\)$/.test(a) },
  { k: 'AÜ 0,5',    sec: ['Alt', 'Üst'],        tur: 'au',   e: 0.5, test: a => /^0[.,]5 Alt\/Üst$/.test(a) },
  { k: 'AÜ 1,5',    sec: ['Alt', 'Üst'],        tur: 'au',   e: 1.5, test: a => /^1[.,]5 Alt\/Üst$/.test(a) },
  { k: 'AÜ 2,5',    sec: ['Alt', 'Üst'],        tur: 'au',   e: 2.5, test: a => /^2[.,]5 Alt\/Üst$/.test(a) },
  { k: 'AÜ 3,5',    sec: ['Alt', 'Üst'],        tur: 'au',   e: 3.5, test: a => /^3[.,]5 Alt\/Üst$/.test(a) },
  { k: 'AÜ 4,5',    sec: ['Alt', 'Üst'],        tur: 'au',   e: 4.5, test: a => /^4[.,]5 Alt\/Üst$/.test(a) },
  { k: 'İY MS',     sec: ['1', 'X', '2'],       tur: 'iyms', test: a => /^(1\. Yar[ıi]|İlk Yar[ıi]) Sonucu$/.test(a) },
  { k: 'İY AÜ 0,5', sec: ['Alt', 'Üst'],        tur: 'iyau', e: 0.5, test: a => /^(1\. Yar[ıi]|İlk Yar[ıi]) 0[.,]5 Alt\/Üst$/.test(a) },
  { k: 'İY AÜ 1,5', sec: ['Alt', 'Üst'],        tur: 'iyau', e: 1.5, test: a => /^(1\. Yar[ıi]|İlk Yar[ıi]) 1[.,]5 Alt\/Üst$/.test(a) },
  { k: 'Tek/Çift',  sec: ['Tek', 'Çift'],       tur: 'tc',   test: a => a === 'Tek/Çift' }
];
const specBul = ad => M.find(s => s.test(ad));
const normEt = (tur, et) => tur === 'cs' ? et.replace(/[\/\s]/g, '-') : et.trim();

/* ==================================================================
   2) Maç sonu istatistikleri
   ================================================================== */
const IST = [
  ['Topla Oynama',   /^(topla oynama|topa sahip olma|top hakimiyeti|topla oynama orani|possession|ball possession)( \(%\))?$/],
  ['Toplam Şut',     /^(toplam sut|sut|sutlar|toplam sutlar|total shots|shots)$/],
  ['İsabetli Şut',   /^(isabetli sut|kaleyi bulan sut|shots on (target|goal))$/],
  ['İsabetsiz Şut',  /^(isabetsiz sut|shots off (target|goal))$/],
  ['Engellenen Şut', /^(engellenen sut|blocked shots)$/],
  ['Direkten Dönen', /^(direkten donen|direkten donen top|direk)$/],
  ['Korner',         /^(korner|kornerler|korner sayisi|kose vurusu|corners?)$/],
  ['Faul',           /^(faul|fauller|faul sayisi|fouls?)$/],
  ['Ofsayt',         /^(ofsayt|ofsaytlar|offsides?)$/],
  ['Sarı Kart',      /^(sari kart|sari kartlar|yellow cards?)$/],
  ['Kırmızı Kart',   /^(kirmizi kart|kirmizi kartlar|red cards?)$/],
  ['Kurtarış',       /^(kurtaris|kurtarislar|kaleci kurtarisi|saves?)$/],
  ['Pas',            /^(pas|paslar|toplam pas|passes)$/],
  ['İsabetli Pas',   /^(isabetli pas|basarili pas|dogru pas)$/],
  ['Pas İsabeti',    /^(pas isabeti|pas basarisi|pas yuzdesi|pass accuracy)( \(%\))?$/],
  ['Atak',           /^(atak|ataklar|attacks)$/],
  ['Tehlikeli Atak', /^(tehlikeli atak|tehlikeli ataklar|dangerous attacks)$/],
  ['Serbest Vuruş',  /^(serbest vurus|serbest vuruslar|free kicks?)$/],
  ['Taç',            /^(tac|tac atisi|throw.?ins?)$/],
  ['Gol Beklentisi', /^(gol beklentisi|beklenen gol|xg)$/]
];
const SAYI = /^%?\s*\d{1,3}(?:[.,]\d{1,2})?\s*%?$/;
const sayi = s => +String(s).replace(/%/g, '').replace(',', '.').trim();

const entity = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));

function tokenlar(html) {
  return entity(html
    .replace(/<script[\s\S]*?<\/script>/gi, '|')
    .replace(/<style[\s\S]*?<\/style>/gi, '|')
    .replace(/<[^>]+>/g, '|'))
    .split('|').map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s && s !== '%');
}

function istatistik(html) {
  const t = tokenlar(html);
  const bul = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i].length > 40) continue;
    const s = sade(t[i]).replace(/:/g, '').trim();
    const def = IST.find(([, re]) => re.test(s));
    if (!def) continue;
    const orta = SAYI.test(t[i - 1] || '') && SAYI.test(t[i + 1] || '');   // 58 Topla Oynama 42
    const sonra = SAYI.test(t[i + 1] || '') && SAYI.test(t[i + 2] || '');  // Topla Oynama 58 42
    if (orta || sonra) bul.push({ i, ad: def[0], orta, sonra });
  }
  // Sayfanın düzenini çoğunluğa göre belirle (ikisine de uyan satırlar belirsizdir)
  const oy = bul.reduce((o, b) => { if (b.orta && !b.sonra) o.orta++; if (b.sonra && !b.orta) o.sonra++; return o; }, { orta: 0, sonra: 0 });
  const duzen = oy.sonra > oy.orta ? 'sonra' : 'orta';
  const out = {};
  for (const b of bul) {
    if (out[b.ad]) continue;
    const kip = b.orta && b.sonra ? duzen : (b.orta ? 'orta' : 'sonra');
    out[b.ad] = kip === 'orta' ? [sayi(t[b.i - 1]), sayi(t[b.i + 1])] : [sayi(t[b.i + 1]), sayi(t[b.i + 2])];
  }
  const to = out['Topla Oynama'];
  if (to && Math.abs(to[0] + to[1] - 100) > 2) delete out['Topla Oynama'];
  return out;
}

/* ==================================================================
   3) HTTP — hata/yoğunlukta kendiliğinden yavaşlar
   ================================================================== */
const HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.7',
  'Referer': BASE + '/Canli-Sonuclar'
};
class KaliciHata extends Error {}

function metinCoz(buf, ct) {
  let cs = ((ct || '').match(/charset=([\w-]+)/i) || [])[1];
  if (!cs) cs = (buf.subarray(0, 4000).toString('latin1').match(/charset=["']?([\w-]+)/i) || [])[1];
  cs = (cs || 'utf-8').toLowerCase();
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

let ardHata = 0, engel = false, ekBekle = 0, istekSay = 0;
async function getir(url, deneme = 3) {
  let son = null;
  for (let i = 1; i <= deneme; i++) {
    try {
      istekSay++;
      const r = await fetch(url, { headers: HDR, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (r.status === 200) {
        const buf = Buffer.from(await r.arrayBuffer());
        ardHata = 0;
        ekBekle = Math.max(0, ekBekle * 0.9 - 20);
        return metinCoz(buf, r.headers.get('content-type'));
      }
      if (r.status === 404 || r.status === 410) throw new KaliciHata('HTTP ' + r.status);
      son = new Error('HTTP ' + r.status);
      if (r.status === 429 || r.status >= 500) ekBekle = Math.min(ekBekle + 2000, 20000);
      if (i < deneme) await sleep(r.status === 429 || r.status === 503 ? 10000 * i : 1500 * i);
    } catch (e) {
      if (e instanceof KaliciHata) throw e;
      son = e;
      ekBekle = Math.min(ekBekle + 500, 20000);
      if (i < deneme) await sleep(1500 * i);
    }
  }
  if (++ardHata >= 30) engel = true;
  throw son || new Error('istek başarısız');
}

/* ==================================================================
   4) Günün maç listesi (livedata)
   ================================================================== */
const LISTE_URL = [
  d => `https://vd.mackolik.com/livedata?date=${d}`,
  d => `https://goapi.mackolik.com/livedata?date=${d}`,
  d => `http://goapi.mackolik.com/livedata?date=${d}`
];
const SKOR_RE = /^\d{1,2}\s*-\s*\d{1,2}$/;

function satirLig(r) {
  const diziler = [r[36], ...r.filter(Array.isArray)];
  for (const d of diziler) {
    if (!Array.isArray(d)) continue;
    const s = d.filter(v => typeof v === 'string' && v.length < 70 && /[a-zçğıöşü]/i.test(v));
    for (const a of s) { const x = ligCoz(a); if (x) return x; }
    for (let i = 0; i < s.length; i++)
      for (let j = 0; j < s.length; j++)
        if (i !== j) { const x = ligCoz(s[i] + ' - ' + s[j]); if (x) return x; }
  }
  return null;
}
const hamLig = r => Array.isArray(r[36]) ? r[36].filter(v => typeof v === 'string').join(' | ') : '';
// Ham lig adından okunur ad: sezon ("2025/2026") ve kısa kodlar ("İNP") atılır
const okunurLig = r => {
  if (!Array.isArray(r[36])) return '';
  const s = r[36].filter(v => typeof v === 'string' && v.trim() && !/^\d{4}\s*[\/-]\s*\d{2,4}$/.test(v.trim()) && (!/^[A-ZÇĞİÖŞÜ0-9.]{1,4}$/.test(v.trim()) || /^(ABD|BAE|KKTC)$/.test(v.trim())));
  return [...new Set(s.map(x => x.trim()))].join(' - ');
};
const mbsSatir = r => {
  if (MBS_ALAN === null) return '';
  const v = r[MBS_ALAN];
  return /^[1-4]$/.test(String(v)) ? String(v) : '';
};

async function gunListesi(tarih, durum, rapor) {
  const d = mk(tarih);
  const sira = [durum.listeUrl || 0, 0, 1, 2].filter((v, i, a) => a.indexOf(v) === i);
  let json = null, hata = '';
  for (const k of sira) {
    try {
      const txt = await getir(LISTE_URL[k](d), 3);
      const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
      json = JSON.parse(txt.slice(a, b + 1));
      durum.listeUrl = k;
      if (rapor) rapor.listeUrl = LISTE_URL[k](d);
      break;
    } catch (e) { hata = e.message; }
  }
  if (!json) throw new Error('maç listesi alınamadı: ' + hata);

  const rows = (Array.isArray(json.m) ? json.m : []).filter(Array.isArray);
  const pay = f => rows.length ? rows.filter(f).length / rows.length : 0;
  const futbolAlan = pay(r => r[23] === 1) > 0.1;
  const kodPay = pay(r => typeof r[14] === 'number' && r[14] > 0);
  const kodFiltre = rows.length > 20 && kodPay > 0.02 && kodPay < 0.98;

  const out = [];
  let futbol = 0, kodlu = 0;
  for (const r of rows) {
    const id = String(r[0]);
    if (!/^\d+$/.test(id)) continue;
    if (futbolAlan && r[23] !== 1) continue;
    futbol++;
    if (kodFiltre && !(typeof r[14] === 'number' && r[14] > 0)) continue;   // İddaa'da olmayan maç: oranı yok
    kodlu++;
    const genc = TAKIM_YASAK.test(sade(String(r[2] || ''))) || TAKIM_YASAK.test(sade(String(r[4] || '')));
    const kanon = genc ? null : satirLig(r);
    if (!HEPSI && !(kanon && SECILI.has(kanon))) continue;
    const lig = kanon || okunurLig(r) || hamLig(r) || '?';
    if (rapor) {
      const k = hamLig(r);
      const e = rapor.harita[k] || (rapor.harita[k] = { lig, adet: 0, ornek: `${r[2]} - ${r[4]}` });
      e.adet++;
    }
    const h = String(r[29] ?? ''), a = String(r[30] ?? '');
    out.push({
      id, lig, ligHam: hamLig(r), mbs: mbsSatir(r),
      ev: typeof r[2] === 'string' ? r[2] : '',
      dep: typeof r[4] === 'string' ? r[4] : '',
      saat: typeof r[16] === 'string' && /^\d{1,2}:\d{2}$/.test(r[16]) ? r[16] : '',
      kod: typeof r[14] === 'number' && r[14] > 0 ? String(r[14]) : '',
      ms: /^\d+$/.test(h) && /^\d+$/.test(a) ? h + '-' + a : '',
      iy: typeof r[7] === 'string' && SKOR_RE.test(r[7]) ? r[7].replace(/\s/g, '') : '',
      ...(rapor ? { _ham: r } : {})
    });
  }
  if (rapor) {
    rapor.gunler = rapor.gunler || [];
    rapor.gunler.push({ tarih, satir: rows.length, futbol, iddaaKodlu: kodlu, alinan: out.length, futbolAlan, kodFiltre });
    rapor.ornekSatirlar = rapor.ornekSatirlar || rows.slice(0, 2);
  }
  return out;
}

/* ==================================================================
   MBS (minimum bahis sayısı) — maç sayfasından
   ================================================================== */
const MBS_DESEN = [
  /data-mbs=["']?([1-4])/i,
  /["']?mbs["']?\s*[:=]\s*["']?([1-4])\b/i,
  /mbs[_\-]?([1-4])\.(?:png|gif|jpe?g|svg|webp)/i,
  /class=["'][^"']*\bmbs[_\-]?([1-4])\b/i,
  /\bMBS\b\s*(?:<[^>]*>\s*){0,4}[:=]?\s*(?:<[^>]*>\s*){0,4}([1-4])\b/i
];
function mbsBul(html) {
  for (const p of MBS_DESEN) { const m = html.match(p); if (m) return m[1]; }
  return '';
}

/* ==================================================================
   5) Maç sayfası → oranlar + skor + MBS
   ================================================================== */
const ODDS_RE = /openOddsDialog\(\s*'[^']*'\s*,\s*'([^']*)'\s*,\s*\[([^\]]*)\]\s*,\s*\[([^\]]*)\]\s*,\s*'([^']*)'/g;
const arr = s => s.split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);

function macAyristir(html, aday) {
  const duz = entity(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const r = { ev: aday.ev, dep: aday.dep, saat: aday.saat, ms: aday.ms, iy: aday.iy, kod: aday.kod, mbs: aday.mbs || mbsBul(html), sayfaTarih: '', oran: {} };

  const bas = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (bas) {
    const t = entity(bas[1]).replace(/\s+/g, ' ').match(/^(.+?)\s-\s(.+?)\s\((\d{2}\.\d{2}\.\d{4})\)\s*Maç Detayı/);
    if (t) { r.ev = r.ev || t[1].trim(); r.dep = r.dep || t[2].trim(); r.sayfaTarih = t[3]; }
  }
  const d = duz.match(/Tarih\s*:\s*(\d{2}\.\d{2}\.\d{4})\s*(\d{2}:\d{2})/);
  if (d) { r.sayfaTarih = r.sayfaTarih || d[1]; r.saat = r.saat || d[2]; }

  if (!r.ms) {
    const og = html.match(/property="og:title"\s+content="([^"]*)"/i);
    if (og) { const s = og[1].match(/\s(\d{1,2})\s*-\s*(\d{1,2})\s/); if (s) r.ms = s[1] + '-' + s[2]; }
  }
  if (!r.iy) {
    const p1 = duz.match(/(?:İlk\s*Yarı|İY)\D{0,12}(\d{1,2})\s*[-–]\s*(\d{1,2})/);
    const p2 = duz.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*\(\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\s*\)/);
    if (p1) r.iy = p1[1] + '-' + p1[2];
    else if (p2) r.iy = p2[3] + '-' + p2[4];
  }

  ODDS_RE.lastIndex = 0;
  let m;
  while ((m = ODDS_RE.exec(html)) !== null) {
    const ad = m[1].trim();
    if (!r.kod) r.kod = m[4];
    const sp = specBul(ad);
    if (!sp) continue;
    const et = arr(m[2]), or = arr(m[3]);
    const h = r.oran[sp.k] || (r.oran[sp.k] = {});
    et.forEach((e, i) => { if (or[i]) h[normEt(sp.tur, e)] = or[i]; });
  }
  return r;
}

/* ==================================================================
   6) Depolama: data/maclar/YYYY/MM/YYYY-MM-DD.json  (id → maç kaydı)
   Günlük dosya: paralel işler aynı dosyaya hiç dokunmaz, çakışma olmaz.
   ================================================================== */
const gun = d => d.toISOString().slice(0, 10);
const trBugun = () => gun(new Date(Date.now() + 3 * 3600e3));
const gunEkle = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return gun(d); };
const mk = s => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const gunFark = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

const gunDosya = t => path.join(VERI, 'maclar', t.slice(0, 4), t.slice(5, 7), t + '.json');
const gunler = new Map(), kirli = new Set();

async function gunYukle(t) {
  if (gunler.has(t)) return gunler.get(t);
  let o = {};
  try { o = JSON.parse(await fs.readFile(gunDosya(t), 'utf8')); } catch { }
  gunler.set(t, o);
  return o;
}
function jsonSatir(o) {
  const ks = Object.keys(o).sort((a, b) => ((o[a].saat || '') + a).localeCompare((o[b].saat || '') + b));
  return '{\n' + ks.map(k => JSON.stringify(k) + ':' + JSON.stringify(o[k])).join(',\n') + '\n}\n';
}
async function kirliYaz() {
  for (const t of kirli) {
    const f = gunDosya(t);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, jsonSatir(gunler.get(t)));
  }
  kirli.clear();
}

const durumDosya = () => path.join(VERI, 'durum', MOD === 'gecmis' ? `gecmis-${PARCA}.json` : 'guncel.json');
async function durumYukle() { try { return JSON.parse(await fs.readFile(durumDosya(), 'utf8')); } catch { return {}; } }
async function durumYaz(d) {
  await fs.mkdir(path.dirname(durumDosya()), { recursive: true });
  await fs.writeFile(durumDosya(), JSON.stringify(d, null, 2) + '\n');
}

// Eski düzenden (aylık dosyalar, sadece 35 lig) kalan veriyi temizle
async function eskiTemizle() {
  await fs.rm(path.join(VERI, 'durum.json'), { force: true });
  const kok = path.join(VERI, 'maclar');
  let silinen = 0;
  for (const y of await fs.readdir(kok).catch(() => []))
    for (const f of await fs.readdir(path.join(kok, y)).catch(() => []))
      if (/^\d{4}-\d{2}\.json$/.test(f)) { await fs.rm(path.join(kok, y, f)); silinen++; }
  if (silinen) console.log(`Eski düzenden ${silinen} aylık dosya silindi.`);
}

/* ==================================================================
   7) İşleme
   ================================================================== */
const say = { yeni: 0, guncellenen: 0, ayni: 0, istatistikli: 0, mbsli: 0, oransiz: 0, oynanmamis: 0, hata: 0 };
const istTamam = r => r && Object.keys(r.ist || {}).length >= 3;

async function havuz(isler, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: PARALEL }, async () => {
    while (i < isler.length && !zamanBitti() && !engel) {
      await fn(isler[i++]);
      const b = BEKLE + ekBekle;
      if (b) await sleep(b);
    }
  }));
}

const karsilastir = r => JSON.stringify({ ...r, guncel: 0 });

async function macIsle(aday, tarih) {
  let html;
  try { html = await getir(BASE + '/Match/Default.aspx?id=' + aday.id); }
  catch { say.hata++; return; }

  const r = macAyristir(html, aday);
  if (!r.ms) { say.oynanmamis++; return; }
  if (!Object.keys(r.oran).length) { say.oransiz++; return; }

  const ist = istatistik(html);
  const g = await gunYukle(tarih);
  const eski = g[aday.id];
  const yeni = {
    id: aday.id, mbs: r.mbs, tarih, saat: r.saat, lig: aday.lig, ligHam: aday.ligHam,
    ev: r.ev, dep: r.dep, iy: r.iy, ms: r.ms, kod: r.kod, oran: r.oran, ist,
    guncel: new Date().toISOString()
  };
  if (Object.keys(ist).length >= 3) say.istatistikli++;
  if (r.mbs) say.mbsli++;
  if (eski && karsilastir(eski) === karsilastir(yeni)) { say.ayni++; return; }
  g[aday.id] = yeni;
  kirli.add(tarih);
  if (eski) say.guncellenen++; else say.yeni++;
}

async function gunIsle(tarih, durum, sadeceEksik) {
  const liste = await gunListesi(tarih, durum);
  const g = await gunYukle(tarih);
  const taze = r => r && Date.now() - Date.parse(r.guncel || 0) < 12 * 3600e3;
  const isler = liste.filter(a => sadeceEksik ? !(istTamam(g[a.id]) || taze(g[a.id])) : !g[a.id]);
  const once = { ...say }, bas = Date.now();
  await havuz(isler, a => macIsle(a, tarih));
  await kirliYaz();
  const f = k => say[k] - once[k];
  const sn = (Date.now() - bas) / 1000;
  console.log(`${trTarih(tarih)} · listede ${liste.length} · işlenen ${isler.length} → +${f('yeni')} yeni, ${f('guncellenen')} güncel, ` +
    `${f('istatistikli')} ist., ${f('mbsli')} MBS, ${f('oransiz')} oransız, ${f('oynanmamis')} oynanmamış, ${f('hata')} hata` +
    (isler.length ? ` · ${(isler.length / Math.max(sn, 0.1)).toFixed(1)} maç/sn` : '') + (ekBekle > 500 ? ` · yavaşlatıldı (+${Math.round(ekBekle)} ms)` : ''));
  return !zamanBitti() && !engel;
}

async function ozetYaz(satirlar) {
  const metin = satirlar.filter(Boolean).join('\n');
  console.log(metin);
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, metin + '\n');
}
const sayOzet = () => `- Eklenen **${say.yeni}** · güncellenen ${say.guncellenen} · değişmeyen ${say.ayni} · istatistikli ${say.istatistikli} · MBS'li ${say.mbsli}\n` +
  `- Oransız ${say.oransiz} · oynanmamış ${say.oynanmamis} · hata ${say.hata} · istek ${istekSay}`;

/* ---------- güncel: ANKRAJ'dan sonraki günler, her saat ---------- */
async function guncelCalis() {
  await eskiTemizle();
  const durum = await durumYukle();
  const bugun = trBugun();
  let ilk = gunEkle(bugun, -SON_GUN);
  if (!durum.ileri) ilk = gunEkle(ANKRAJ, 1);
  else if (durum.ileri < ilk) ilk = gunEkle(durum.ileri, 1);
  if (ilk <= ANKRAJ) ilk = gunEkle(ANKRAJ, 1);
  const notlar = [];
  for (let t = ilk; t < bugun && !zamanBitti() && !engel; t = gunEkle(t, 1)) {
    try { if (await gunIsle(t, durum, true) && (!durum.ileri || t > durum.ileri)) durum.ileri = t; }
    catch (e) { notlar.push(`- ${t}: ${e.message}`); break; }
    await durumYaz(durum);
  }
  await kirliYaz(); await durumYaz(durum);
  await ozetYaz(['## Güncel (son günler)', sayOzet(), `- Son işlenen gün: ${durum.ileri || '-'}`, ...notlar]);
}

/* ---------- geçmiş: 5 yılı PARCA_SAYI parçaya böl, bu iş PARCA'yı tarar ---------- */
async function gecmisCalis() {
  const toplam = Math.round(YIL * 365.25);
  const k = Math.ceil(toplam / PARCA_SAYI);
  const ust = gunEkle(ANKRAJ, -PARCA * k);
  const alt = gunEkle(ANKRAJ, -Math.min((PARCA + 1) * k, toplam) + 1);
  const durum = await durumYukle();
  if (!durum.geri || durum.ust !== ust || durum.alt !== alt) Object.assign(durum, { ust, alt, geri: ust, bitti: false });
  console.log(`Parça ${PARCA + 1}/${PARCA_SAYI}: ${ust} → ${alt} · kaldığı yer ${durum.geri} · ${PARALEL} paralel · ${BUTCE_DK} dk`);
  const notlar = [];
  let listeHata = 0;
  while (!durum.bitti && !zamanBitti() && !engel) {
    if (durum.geri < alt) { durum.bitti = true; break; }
    try {
      if (await gunIsle(durum.geri, durum, false)) durum.geri = gunEkle(durum.geri, -1);
      listeHata = 0;
    } catch (e) {
      notlar.push(`- ${durum.geri}: ${e.message}`);
      console.log(`${durum.geri} HATA: ${e.message}`);
      if (++listeHata >= 3) break;
      await sleep(20000);
    }
    await durumYaz(durum);
  }
  if (durum.geri < alt) durum.bitti = true;
  await kirliYaz(); await durumYaz(durum);
  const yuzde = durum.bitti ? 100 : Math.round(gunFark(ust, durum.geri) / (gunFark(ust, alt) + 1) * 100);
  if (durum.bitti) await fs.writeFile(path.join(KOK, '.bitti'), '1');
  if (engel) await fs.writeFile(path.join(KOK, '.engel'), '1');
  await ozetYaz([`## Geçmiş parça ${PARCA + 1}/${PARCA_SAYI}`, sayOzet(),
    `- ${durum.bitti ? 'TAMAMLANDI' : durum.geri + ' tarihine indi'} (%${yuzde}) · aralık ${alt} … ${ust}`,
    engel ? '- ⚠️ Mackolik art arda hata verdi, bu parça bir sonraki turda devam edecek.' : '', ...notlar]);
}

/* ==================================================================
   8) CSV (MBS + 5.3 düzeni + istatistik sütunları)
   ================================================================== */
const msS = (h, a) => h > a ? '1' : h < a ? '2' : 'X';
const skorCoz = s => { const p = (s || '').split('-').map(Number); return (p.length === 2 && !p.some(isNaN)) ? p : null; };

function kazananlar(r) {
  const t = skorCoz(r.ms);
  if (!t) return {};
  const [h, a] = t, top = h + a;
  const iyp = skorCoz(r.iy);
  const [ih, ia] = iyp || [null, null];
  const out = {};
  for (const s of M) {
    if (!r.oran[s.k] || !Object.keys(r.oran[s.k]).length) continue;
    let w = '';
    switch (s.tur) {
      case 'ms':   w = msS(h, a); break;
      case 'cs': { const g = msS(h, a); w = s.sec.find(x => x.split('-').includes(g)) || ''; break; }
      case 'kg':   w = (h > 0 && a > 0) ? 'Var' : 'Yok'; break;
      case 'hnd':  w = msS(h + s.hd[0], a + s.hd[1]); break;
      case 'au':   w = top > s.e ? 'Üst' : 'Alt'; break;
      case 'tc':   w = top % 2 ? 'Tek' : 'Çift'; break;
      case 'iyms': w = iyp ? msS(ih, ia) : ''; break;
      case 'iyau': w = iyp ? ((ih + ia) > s.e ? 'Üst' : 'Alt') : ''; break;
    }
    if (w) out[s.k] = w;
  }
  return out;
}

const csvD = (v, sayiMi) => {
  let s = v == null ? '' : String(v);
  if (sayiMi && /^\d+([.,]\d+)?$/.test(s)) s = s.replace('.', ',');
  return '"' + s.replace(/"/g, '""') + '"';
};
const trTarih = s => { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}`; };


function csvBaslik() {
  const bas = ['MBS', 'Tarih', 'Saat', 'Lig', 'Ev Sahibi', 'Deplasman', 'İY Skor', 'MS Skor', 'Sonuç', 'İY Sonuç', 'Toplam Gol', 'KG?', 'İddaa Kodu'];
  for (const s of M) { s.sec.forEach(e => bas.push(s.k + ' ' + e)); bas.push(s.k + ' ✓'); }
  for (const [ad] of IST) { bas.push(ad + ' Ev'); bas.push(ad + ' Dep'); }
  return '\uFEFFsep=;\r\n' + bas.map(b => csvD(b)).join(';') + '\r\n';
}
function csvSatir(r) {
  const kaz = kazananlar(r), t = skorCoz(r.ms), iyp = skorCoz(r.iy);
  const h = [r.mbs || '', trTarih(r.tarih), r.saat, r.lig, r.ev, r.dep, r.iy, r.ms,
    t ? msS(t[0], t[1]) : '', iyp ? msS(iyp[0], iyp[1]) : '',
    t ? String(t[0] + t[1]) : '', t ? ((t[0] > 0 && t[1] > 0) ? 'Var' : 'Yok') : '', r.kod
  ].map(v => csvD(v));
  for (const s of M) {
    const sec = r.oran[s.k] || {};
    s.sec.forEach(e => h.push(csvD(sec[e] || '', true)));
    h.push(csvD(Object.keys(sec).length ? (kaz[s.k] || '') : ''));
  }
  for (const [ad] of IST) {
    const v = (r.ist || {})[ad];
    h.push(csvD(v ? v[0] : '', true)); h.push(csvD(v ? v[1] : '', true));
  }
  return h.join(';') + '\r\n';
}

// Dosyalar gün gün eklenerek yazılır (yüz binlerce satır belleği şişirmez)
async function csvHepsi() {
  const kok = path.join(VERI, 'maclar');
  await fs.rm(CIKTI, { recursive: true, force: true });
  await fs.mkdir(CIKTI, { recursive: true });
  const tumF = path.join(CIKTI, 'mackolik_tum.csv');
  await fs.writeFile(tumF, csvBaslik());
  let toplam = 0;
  for (const y of (await fs.readdir(kok).catch(() => [])).filter(x => /^\d{4}$/.test(x)).sort()) {
    const yF = path.join(CIKTI, `mackolik_${y}.csv`);
    await fs.writeFile(yF, csvBaslik());
    for (const m of (await fs.readdir(path.join(kok, y))).filter(x => /^\d{2}$/.test(x)).sort())
      for (const f of (await fs.readdir(path.join(kok, y, m))).filter(x => x.endsWith('.json')).sort()) {
        const o = JSON.parse(await fs.readFile(path.join(kok, y, m, f), 'utf8'));
        const parca = Object.values(o).map(csvSatir).join('');
        await fs.appendFile(yF, parca); await fs.appendFile(tumF, parca);
        toplam += Object.keys(o).length;
      }
  }
  console.log(`CSV: ${toplam} maç`);
  await ozetYaz([`## CSV`, `- ${toplam} maç yazıldı`]);
}

/* ==================================================================
   9) Test modu — teşhis dosyaları (veriye dokunmaz)
   ================================================================== */
async function testCalis() {
  let cmt = gunEkle(trBugun(), -1);
  while (new Date(cmt + 'T12:00:00Z').getUTCDay() !== 6) cmt = gunEkle(cmt, -1);
  const tarihler = process.env.TEST_TARIH ? process.env.TEST_TARIH.split(',').map(x => x.trim())
    : [cmt, gunEkle(cmt, -182), gunEkle(cmt, -7 * 200)];
  const durum = {}, rapor = { tarihler, harita: {} };
  await fs.mkdir(DEBUG, { recursive: true });
  try {
    const listeler = [];
    for (const t of tarihler) { listeler.push(await gunListesi(t, durum, rapor)); await sleep(800); }
    rapor.maclar = [];
    // Her günden 4 maç, listenin farklı yerlerinden (farklı ligler)
    const ornek = listeler.flatMap(l => [0, 0.3, 0.6, 0.9].map(p => l[Math.floor(p * l.length)]).filter(Boolean));
    for (const a of ornek) {
      const html = await getir(BASE + '/Match/Default.aspx?id=' + a.id);
      const r = macAyristir(html, a);
      const iz = [];
      const re = /mbs/gi; let m;
      while ((m = re.exec(html)) && iz.length < 6) iz.push(html.slice(Math.max(0, m.index - 120), m.index + 160).replace(/\s+/g, ' '));
      const ilkOran = (html.match(/openOddsDialog\([^)]{0,400}\)/) || [''])[0];
      const { _ham, ...aday } = a;
      rapor.maclar.push({
        aday, hamSatir: _ham, skor: { ms: r.ms, iy: r.iy }, mbs: r.mbs, marketSayisi: Object.keys(r.oran).length,
        ist: istatistik(html), ilkOranCagrisi: ilkOran, mbsIzleri: iz
      });
      await sleep(400);
    }
  } catch (e) { rapor.hata = e.message; }
  const h = Object.entries(rapor.harita).sort((x, y) => y[1].adet - x[1].adet);
  delete rapor.harita;
  await fs.writeFile(path.join(DEBUG, 'test-raporu.json'), JSON.stringify(rapor, null, 2));
  await fs.writeFile(path.join(DEBUG, 'lig-haritasi.txt'),
    h.map(([k, v]) => `${String(v.adet).padStart(3)}  ${v.lig.padEnd(34)}  ${k}   (${v.ornek})`).join('\n') + '\n');
  console.log(JSON.stringify(rapor.gunler, null, 1));
  console.log(`MBS bulunan örnek: ${(rapor.maclar || []).filter(x => x.mbs).length}/${(rapor.maclar || []).length}${rapor.hata ? ' · HATA: ' + rapor.hata : ''}`);
}

/* ==================================================================
   10) Başlat
   ================================================================== */
if (MOD === 'test') await testCalis();
else if (MOD === 'csv') await csvHepsi();
else if (MOD === 'gecmis') await gecmisCalis();
else await guncelCalis();
