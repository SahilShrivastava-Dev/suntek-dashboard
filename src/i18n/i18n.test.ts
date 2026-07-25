import { describe, it, expect } from 'vitest';
import en from './locales/en';
import hi from './locales/hi';

/**
 * Guards for the Hindi TRANSLITERATION policy: English terminology is written
 * phonetically in Devanagari (मेंटेनेंस, रिपेयर, फाइनेंशियल ईयर…), never
 * semantically translated (मरम्मत, वित्तीय वर्ष…). Acronyms (FAR, QC, FY, GST,
 * QR, CP, OCR…) stay Latin; interpolation variables must survive untouched.
 */

type Node = Record<string, unknown>;

function walk(node: Node, path: string, out: Map<string, string>) {
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k;
    if (typeof v === 'string') out.set(p, v);
    else if (v && typeof v === 'object') walk(v as Node, p, out);
  }
}

const enLeaves = new Map<string, string>();
const hiLeaves = new Map<string, string>();
walk(en as unknown as Node, '', enLeaves);
walk(hi as unknown as Node, '', hiLeaves);

const varsOf = (s: string) => new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]));

describe('en/hi locale parity', () => {
  it('hi has exactly the same keys as en', () => {
    const missing = [...enLeaves.keys()].filter(k => !hiLeaves.has(k));
    const extra = [...hiLeaves.keys()].filter(k => !enLeaves.has(k));
    expect(missing, `keys missing from hi: ${missing.slice(0, 10).join(', ')}`).toEqual([]);
    expect(extra, `keys extra in hi: ${extra.slice(0, 10).join(', ')}`).toEqual([]);
  });

  it('every hi string keeps the same {{interpolation}} variables as en', () => {
    const broken: string[] = [];
    for (const [k, enVal] of enLeaves) {
      const hiVal = hiLeaves.get(k);
      if (hiVal == null) continue;
      const a = varsOf(enVal), b = varsOf(hiVal);
      if (a.size !== b.size || [...a].some(v => !b.has(v))) broken.push(k);
    }
    expect(broken, `interpolation drift in: ${broken.slice(0, 10).join(', ')}`).toEqual([]);
  });
});

describe('hi uses transliteration, not semantic Hindi', () => {
  // Semantic Hindi words that must NEVER appear — each has an approved
  // transliteration (the glossary): मरम्मत→रिपेयर, वित्तीय वर्ष→फाइनेंशियल ईयर,
  // गतिविधि→एक्टिविटी, अनुरक्षण/रखरखाव→मेंटेनेंस, स्थायी संपत्ति→फिक्स्ड एसेट,
  // कार्यशील पूंजी→वर्किंग कैपिटल, त्वरित खोज→क्विक सर्च, उपकरण→इक्विपमेंट,
  // उपयोगकर्ता→यूज़र, ग्राहक→कस्टमर, बीमा→इंश्योरेंस, खरीद→परचेज़,
  // भंडार→स्टोर, सूची→लिस्ट, प्रतीक्षा→वेटिंग, लंबित→पेंडिंग.
  const BANNED = [
    'मरम्मत', 'वित्तीय वर्ष', 'गतिविधि', 'अनुरक्षण', 'रखरखाव', 'स्थायी संपत्ति',
    'संपत्ति', 'कार्यशील पूंजी', 'त्वरित खोज', 'उपयोगकर्ता', 'उपकरण', 'ग्राहक',
    'बीमा', 'भंडार', 'लंबित', 'प्रतीक्षा', 'खरीद', 'बिक्री', 'सूचना', 'चेतावनी',
    'त्रुटि', 'विफल', 'सहेज', 'खोज', 'प्रविष्टि', 'अनुसूची', 'रिपोर्ट नहीं',
  ];

  it('no banned semantic Hindi word appears in any hi string', () => {
    const offenders: string[] = [];
    for (const [k, v] of hiLeaves) {
      for (const w of BANNED) {
        if (v.includes(w)) { offenders.push(`${k} ⇒ "${v.slice(0, 60)}" (contains "${w}")`); break; }
      }
    }
    expect(offenders, offenders.slice(0, 15).join('\n')).toEqual([]);
  });

  it('canonical glossary terms render as expected', () => {
    expect(hiLeaves.get('nav.maintenance')).toContain('मेंटेनेंस');
    expect(hiLeaves.get('far.maintRepairsTitle')).toContain('मेंटेनेंस एंड रिपेयर');
    expect(hiLeaves.get('far.maintRepairsTitle')).toContain('फाइनेंशियल ईयर');
    expect(hiLeaves.get('far.repairCost')).toContain('रिपेयर');
    expect(hiLeaves.get('nav.activityLog')).toContain('एक्टिविटी');
    expect(hiLeaves.get('nav.fixedAssets')).toContain('एसेट');
  });

  it('acronyms stay Latin (FAR / QR / GST examples)', () => {
    expect(hiLeaves.get('nav.far')).toBe('FAR');
    expect(hiLeaves.get('nav.qrCode')).toContain('QR');
  });
});
