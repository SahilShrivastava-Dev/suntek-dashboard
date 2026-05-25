// ── All mock data extracted exactly from index.html ──

export const FAR = [
  { sl:1,  id:'GR-EXTR-001',  model:'GE-1240', cap:'2 x 600 mm', origin:'India', year:2018, val:'₹ 18,40,000', inv:'STK/IN/22-001', dt:'14.05.2018', acc:'Plant & Machinery', pic:true },
  { sl:2,  id:'GR-EXTR-002',  model:'GE-1240', cap:'2 x 600 mm', origin:'India', year:2018, val:'₹ 18,40,000', inv:'STK/IN/22-002', dt:'14.05.2018', acc:'Plant & Machinery', pic:true },
  { sl:3,  id:'CRSH-IN-101',  model:'IC-501',  cap:'5 x 400 mm', origin:'India', year:2019, val:'₹ 6,20,000',  inv:'STK/IN/22-014', dt:'08.07.2019', acc:'Plant & Machinery', pic:true },
  { sl:4,  id:'BL-001',       model:'BL-100',  cap:'500 kg/hr',  origin:'India', year:2020, val:'₹ 4,30,000',  inv:'STK/IN/22-018', dt:'02.02.2020', acc:'Plant & Machinery', pic:false },
  { sl:5,  id:'COND-04',      model:'NC-440',  cap:'200 kVA',    origin:'India', year:2018, val:'₹ 2,80,000',  inv:'STK/IN/22-021', dt:'15.04.2018', acc:'Plant & Machinery', pic:true },
  { sl:6,  id:'PMP-MS-12',    model:'KS-50',   cap:'50 m³/hr',   origin:'India', year:2019, val:'₹ 1,20,000',  inv:'STK/IN/22-029', dt:'22.11.2019', acc:'Plant & Machinery', pic:true },
  { sl:7,  id:'TANK-NPS-50',  model:'CYL-50',  cap:'50 MT',      origin:'India', year:2017, val:'₹ 8,00,000',  inv:'STK/IN/21-014', dt:'30.09.2017', acc:'Plant & Machinery', pic:true },
  { sl:8,  id:'TANK-NPQ-500', model:'CYL-500', cap:'500 MT',     origin:'India', year:2017, val:'₹ 28,00,000', inv:'STK/IN/21-018', dt:'30.09.2017', acc:'Plant & Machinery', pic:true },
  { sl:9,  id:'BR-MAIN-01',   model:'GE-280',  cap:'250 kVA',    origin:'India', year:2018, val:'₹ 1,40,000',  inv:'STK/IN/22-040', dt:'14.05.2018', acc:'Plant & Machinery', pic:false },
  { sl:10, id:'WB-100T',      model:'WB-100',  cap:'100 T',      origin:'India', year:2020, val:'₹ 3,80,000',  inv:'STK/IN/23-001', dt:'18.01.2020', acc:'Plant & Machinery', pic:true }
];

export const MAINT = [
  { date:'28.04.2026', plant:'Rehla',  eq:'Reactor R-1',          issue:'valve leakage',                 act:'2" ball valve changed',                        type:'repair',  by:'Anooj',    pic:true  },
  { date:'28.04.2026', plant:'Rehla',  eq:'Cooling tower CT-1',   issue:'leakage from MS shell',         act:'70mm blank changed',                           type:'repair',  by:'Devkumar', pic:true  },
  { date:'27.04.2026', plant:'Ganjam', eq:'Drive belt unit DB-2',  issue:'serving required',              act:'serving done at 7-bar of black valve oil ch.', type:'regular', by:'Shyam',    pic:true  },
  { date:'27.04.2026', plant:'SHD',    eq:'Degasser D-1',          issue:'pressure required',             act:'installed done',                               type:'regular', by:'Shubham',  pic:false },
  { date:'26.04.2026', plant:'Rehla',  eq:'Hydration plant H-2',  issue:'leakage from mechanical side',  act:'changed',                                      type:'repair',  by:'Anooj',    pic:true  },
  { date:'26.04.2026', plant:'Ganjam', eq:'NaCl mounting',         issue:'noise',                         act:'pump replaced',                                type:'repair',  by:'Devlal',   pic:true  },
  { date:'25.04.2026', plant:'Rehla',  eq:'Compressor CP-3',       issue:'oil seal damage',               act:'mech seal cleaning + 2 piece replacement',     type:'regular', by:'Shubham',  pic:true  },
  { date:'25.04.2026', plant:'SHD',    eq:'Cooler tower CT-3',     issue:'noise',                         act:'mechanical seal changed (2 piece)',             type:'repair',  by:'Anooj',    pic:true  },
  { date:'24.04.2026', plant:'Rehla',  eq:'Tunnel kiln TK-1',      issue:'water installation work',       act:'cleaning done',                                type:'regular', by:'Devkumar', pic:false },
  { date:'24.04.2026', plant:'Ganjam', eq:'NaOH 16-A',             issue:'graphite plug failure',         act:'graphite plug + 1, 2, 3 changed',              type:'repair',  by:'Shyam',    pic:true  },
  { date:'23.04.2026', plant:'Rehla',  eq:'Alloy 7-A',             issue:'flange diaphragm valve change', act:'5" pre-fab diaphragm valve replaced',          type:'repair',  by:'Anooj',    pic:true  },
  { date:'23.04.2026', plant:'SHD',    eq:'Reactor R-2',           issue:'paraffin leak',                 act:'paraffin lid + plate added',                   type:'regular', by:'Shubham',  pic:true  },
  { date:'22.04.2026', plant:'Rehla',  eq:'Pump P-7',              issue:'broken impeller',               act:'impeller replaced',                            type:'scrap',   by:'Devkumar', pic:true  },
  { date:'22.04.2026', plant:'Ganjam', eq:'Heat exch. HX-2',       issue:'tube failure',                  act:'unit retired, parts cannibalised',             type:'scrap',   by:'Shyam',    pic:true  }
];

export const ACTIVITY = [
  { eq:'Graphite Cooling Line', type:'inspection',        date:'28.04.2026', by:'Anooj',    ver:'Vijay Ji',  plant:'Rehla',    pic:true  },
  { eq:'Compressor CP-1',       type:'maintenance audit', date:'27.04.2026', by:'Devkumar', ver:'Sagar',     plant:'Rehla',    pic:true  },
  { eq:'Reactor R-1',           type:'photo log',         date:'27.04.2026', by:'Shubham',  ver:'Vijay Ji',  plant:'Ganjam',   pic:true  },
  { eq:'Wb 100T',               type:'calibration',       date:'26.04.2026', by:'Anooj',    ver:'Vijay Ji',  plant:'SHD',      pic:true  },
  { eq:'NPG tank',              type:'physical count',    date:'26.04.2026', by:'Devlal',   ver:'Sagar',     plant:'Port',     pic:true  },
  { eq:'Drum plant',            type:'painting',          date:'25.04.2026', by:'Shyam',    ver:'-',         plant:'Drum Pl.', pic:false }
];

export const STORE_REQ = [
  { id:'SR-441', item:'PP Ball',           plant:'SHD',    qty:'48 nos', stage:'authorisation', wait:'Vijay Ji',  decision:'pending', pic:true  },
  { id:'SR-440', item:'NC Thinner',        plant:'SHD',    qty:'80 L',   stage:'unit-head',     wait:'unit head', decision:'review',  pic:true  },
  { id:'SR-439', item:'Cooling tower mtg', plant:'Rehla',  qty:'2 nos',  stage:'in-stock',      wait:'-',         decision:'supply',  pic:true  },
  { id:'SR-438', item:'Brightener',        plant:'Rehla',  qty:'25 kg',  stage:'authorisation', wait:'Vijay Ji',  decision:'pending', pic:false },
  { id:'SR-437', item:'Coupling 95/100',   plant:'Rehla',  qty:'12 nos', stage:'purchase',      wait:'supplier',  decision:'PO sent', pic:true  },
  { id:'SR-436', item:'O-ring kit',        plant:'SHD',    qty:'5 sets', stage:'in-stock',      wait:'-',         decision:'supply',  pic:true  },
  { id:'SR-435', item:'HS Powder',         plant:'Ganjam', qty:'10 kg',  stage:'authorisation', wait:'Vijay Ji',  decision:'pending', pic:true  }
];

export const REQUIREMENTS = [
  { id:'REQ-2941', mat:'Paraffin (NP)',      kind:'small',    sup:'Krishna Tradelinks', dest:'Rehla',  qty:'52 MT',    val:'₹ 18,50,000', status:'approved',   pic:true  },
  { id:'REQ-2940', mat:'Cl₂ pipeline',      kind:'small',    sup:'Indo Gulf',          dest:'SHD',    qty:'pipeline', val:'₹ 12,80,000', status:'received',   pic:true  },
  { id:'REQ-2939', mat:'C18 olefin',        kind:'PO',       sup:'Sea View Oils',      dest:'Rehla',  qty:'200 MT',   val:'₹ 86,00,000', status:'dispatched', pic:true  },
  { id:'REQ-2938', mat:'Drum filling line', kind:'PO (FAR)', sup:'PolyBarrel',         dest:'Bawana', qty:'1 unit',   val:'₹ 14,40,000', status:'approved',   pic:true  },
  { id:'REQ-2937', mat:'NPG',              kind:'PO',       sup:'Indus Petrochem',    dest:'Port',   qty:'500 MT',   val:'₹ 1.92 Cr',   status:'dispatched', pic:true  },
  { id:'REQ-2936', mat:'NC Thinner',       kind:'small',    sup:'BlueChem',           dest:'SHD',    qty:'80 L',     val:'₹ 24,000',    status:'approved',   pic:false },
  { id:'REQ-2935', mat:'Reactor R-3 (FAR)',kind:'PO (FAR)', sup:'Sigma Engg.',        dest:'Ganjam', qty:'1 unit',   val:'₹ 18,80,000', status:'received',   pic:true  },
  { id:'REQ-2934', mat:'Cooling tower mtg',kind:'small',    sup:'Sigma Engg.',        dest:'Ganjam', qty:'2 nos',    val:'₹ 1,40,000',  status:'dispatched', pic:false },
  { id:'REQ-2933', mat:'Coupling 95/100',  kind:'small',    sup:'Patel Couplings',    dest:'Rehla',  qty:'12 nos',   val:'₹ 36,000',    status:'approved',   pic:true  },
  { id:'REQ-2932', mat:'PP Ball',          kind:'small',    sup:'Patel Couplings',    dest:'SHD',    qty:'48 nos',   val:'₹ 14,400',    status:'dispatched', pic:true  },
  { id:'REQ-2931', mat:'Brightener',       kind:'small',    sup:'BlueChem',           dest:'Rehla',  qty:'25 kg',    val:'₹ 62,500',    status:'received',   pic:true  },
  { id:'REQ-2930', mat:'Benzeen',          kind:'small',    sup:'BlueChem',           dest:'Bawana', qty:'30 L',     val:'₹ 9,000',     status:'dispatched', pic:false }
];

export const MARINE_LEDGER = [
  { date:'28.04', t:'deduct', ref:'REQ-2939 dispatch',  amt:-50,  bal:9.50 },
  { date:'27.04', t:'deduct', ref:'REQ-2937 dispatch',  amt:-65,  bal:9.55 },
  { date:'25.04', t:'deduct', ref:'REQ-2935 dispatch',  amt:-32,  bal:9.62 },
  { date:'22.04', t:'deduct', ref:'REQ-2932 dispatch',  amt:-12,  bal:9.65 },
  { date:'18.04', t:'top-up', ref:'Underwriter top-up', amt:+150, bal:9.66 },
  { date:'15.04', t:'deduct', ref:'REQ-2925 dispatch',  amt:-48,  bal:8.16 },
  { date:'12.04', t:'deduct', ref:'REQ-2922 dispatch',  amt:-58,  bal:8.64 }
];

export const LABOUR_PLANTS = [
  { plant:'SHD',    pq:'24 MT', sq:'30 MT', batches:2, cost:'₹ 62,400',   perMT:'₹ 1 467', target:0  },
  { plant:'Rehla',  pq:'52 MT', sq:'48 MT', batches:3, cost:'₹ 1,02,800', perMT:'₹ 1 489', target:1  },
  { plant:'Ganjam', pq:'45 MT', sq:'40 MT', batches:2, cost:'₹ 88,200',   perMT:'₹ 1 519', target:1  },
  { plant:'Bawana', pq:'12 MT', sq:'18 MT', batches:0, cost:'₹ 31,100',   perMT:'₹ 1 408', target:-1 }
];

export const CONTRACTS = [
  { cust:'Samarth Polymers',    d:1400, lock:85, booked:30, dispatched:24, status:'on track' },
  { cust:'Jains International', d:1400, lock:84, booked:50, dispatched:42, status:'on track' },
  { cust:'Gabsons',             d:1400, lock:86, booked:30, dispatched:30, status:'closed'   },
  { cust:'Jain Poly',           d:1400, lock:85, booked:25, dispatched:11, status:'on track' },
  { cust:'Omgee',               d:1400, lock:87, booked:20, dispatched:12, status:'overdue'  },
  { cust:'Shivani Industries',  d:1400, lock:85, booked:40, dispatched:18, status:'on track' },
  { cust:'PolyChem East',       d:1450, lock:91, booked:18, dispatched:6,  status:'on track' },
  { cust:'Bharat Plastomers',   d:1300, lock:78, booked:35, dispatched:35, status:'closed'   }
];

export const TANKS = [
  { name:'NP9 (Port)',           loc:'Kandla', level:78, cap:500,  unit:'MT',            alert:false },
  { name:'C18 olefin (Port)',    loc:'Mundra', level:62, cap:2000, unit:'MT',            alert:false },
  { name:'NPG (Port)',           loc:'Kandla', level:24, cap:600,  unit:'MT',            alert:true  },
  { name:'NPS (Factory)',        loc:'Rehla',  level:54, cap:50,   unit:'MT',            alert:false },
  { name:'C18 olefin (Factory)', loc:'Rehla',  level:71, cap:200,  unit:'MT',            alert:false },
  { name:'NPQ (Factory)',        loc:'Rehla',  level:88, cap:500,  unit:'MT',            alert:false }
];

export const CP_LOCATIONS = ['Bawana','Kolkata','Rehla','Ganjam','SHD'];
export const CP_DENSITIES = [1300, 1400, 1450, 1500];
export const CP_MATRIX: Record<string, number[]> = {
  Bawana:  [245, 380, 130, 90],
  Kolkata: [180, 210, 90,  40],
  Rehla:   [115, 125, 70,  35],
  Ganjam:  [80,  95,  40,  20],
  SHD:     [42,  60,  25,  10]
};

export const STORE_ITEMS = [
  { item:'NC Thinner',        loc:'SHD',    op:8,   inn:0,  out:5,  cl:3,  th:5,  unit:'L'    },
  { item:'Cooling tower mtg', loc:'Rehla',  op:4,   inn:1,  out:0,  cl:5,  th:3,  unit:'nos'  },
  { item:'Coupling 95/100',   loc:'Rehla',  op:24,  inn:0,  out:8,  cl:16, th:10, unit:'nos'  },
  { item:'Benzeen',           loc:'Bawana', op:18,  inn:0,  out:6,  cl:12, th:5,  unit:'L'    },
  { item:'PP Ball',           loc:'SHD',    op:120, inn:48, out:30, cl:138,th:50, unit:'nos'  },
  { item:'Brightener',        loc:'Rehla',  op:15,  inn:25, out:8,  cl:32, th:10, unit:'kg'   },
  { item:'HS Powder',         loc:'Ganjam', op:32,  inn:0,  out:12, cl:20, th:15, unit:'kg'   },
  { item:'O-ring kit',        loc:'SHD',    op:7,   inn:0,  out:5,  cl:2,  th:5,  unit:'sets' }
];

export const ACTIVE_BATCHES = [
  { num:1228, plant:'Rehla',  recipe:'456', target:1390, current:1340, drums:24, elapsed:'42h', op:'Anooj',    qc:'pending'  },
  { num:1230, plant:'Ganjam', recipe:'123', target:1450, current:1280, drums:18, elapsed:'18h', op:'Devkumar', qc:'awaiting' },
  { num:1231, plant:'Rehla',  recipe:'789', target:1300, current:1180, drums:8,  elapsed:'12h', op:'Shyam',    qc:'awaiting' },
  { num:1232, plant:'SHD',    recipe:'456', target:1400, current:1350, drums:21, elapsed:'30h', op:'Amit',     qc:'pending'  },
  { num:1233, plant:'Ganjam', recipe:'456', target:1390, current:1100, drums:5,  elapsed:'8h',  op:'Devlal',   qc:'awaiting' },
  { num:1234, plant:'Rehla',  recipe:'123', target:1500, current:1420, drums:14, elapsed:'24h', op:'Sherbham', qc:'pending'  },
  { num:1235, plant:'SHD',    recipe:'789', target:1300, current:1180, drums:6,  elapsed:'9h',  op:'Devkumar', qc:'awaiting' }
];

export const CUSTOMERS = [
  { name:'Samarth Polymers',    place:'Faridabad',     density:'1400',      mtdQty:425, mtdVal:'36.1 L', y12:'4.8 Cr', avgOrd:18, out:'0',     trend:18  },
  { name:'Jains International', place:'Sonipat',       density:'1400/1300', mtdQty:380, mtdVal:'32.3 L', y12:'4.1 Cr', avgOrd:22, out:'1.2 L', trend:12  },
  { name:'Gabsons',             place:'Bahadurgarh',   density:'1400',      mtdQty:295, mtdVal:'25.0 L', y12:'3.4 Cr', avgOrd:25, out:'0',     trend:-3  },
  { name:'Jain Poly',           place:'Sonipat',       density:'1400',      mtdQty:240, mtdVal:'20.4 L', y12:'2.6 Cr', avgOrd:20, out:'0',     trend:8   },
  { name:'Omgee',               place:'Faridabad',     density:'1400',      mtdQty:180, mtdVal:'15.3 L', y12:'2.1 Cr', avgOrd:15, out:'3.2 L', trend:24  },
  { name:'Shivani Industries',  place:'Greater Noida', density:'1400',      mtdQty:155, mtdVal:'13.1 L', y12:'1.9 Cr', avgOrd:14, out:'0',     trend:-7  },
  { name:'PolyChem East',       place:'Howrah',        density:'1450',      mtdQty:62,  mtdVal:'5.6 L',  y12:'72 L',   avgOrd:9,  out:'4.2 L', trend:35  },
  { name:'Bharat Plastomers',   place:'Mumbai',        density:'1300',      mtdQty:120, mtdVal:'9.4 L',  y12:'1.4 Cr', avgOrd:35, out:'0',     trend:-15 }
];

export const SAMARTH_HISTORY = [
  { m:'Nov', d:340 },
  { m:'Dec', d:380 },
  { m:'Jan', d:295 },
  { m:'Feb', d:410 },
  { m:'Mar', d:455 },
  { m:'Apr', d:425 }
];

export const SAMARTH_DENSITY = [
  { d:1300, pct:8  },
  { d:1400, pct:78 },
  { d:1450, pct:12 },
  { d:1500, pct:2  }
];

export const NIGHT_DUTY = [
  { name:'Anooj Kumar',    role:'Operator', plant:'Rehla',  pct:[28,42], status:'green', shift:'10pm-6am', last:'2 min ago',  initial:'AK' },
  { name:'Shubham Tiwari', role:'Helper',   plant:'Rehla',  pct:[34,45], status:'green', shift:'10pm-6am', last:'5 min ago',  initial:'ST' },
  { name:'Devkumar Singh', role:'Filling',  plant:'Rehla',  pct:[38,50], status:'green', shift:'10pm-6am', last:'1 min ago',  initial:'DS' },
  { name:'Shyam Lal',      role:'Operator', plant:'Ganjam', pct:[55,38], status:'green', shift:'10pm-6am', last:'3 min ago',  initial:'SL' },
  { name:'Devlal Kumar',   role:'Helper',   plant:'Ganjam', pct:[59,42], status:'green', shift:'10pm-6am', last:'7 min ago',  initial:'DK' },
  { name:'Amit Sharma',    role:'Operator', plant:'SHD',    pct:[18,28], status:'green', shift:'10pm-6am', last:'4 min ago',  initial:'AS' },
  { name:'Ramesh Kumar',   role:'Loader',   plant:'SHD',    pct:[20,30], status:'amber', shift:'10pm-6am', last:'18 min ago', initial:'RK' },
  { name:'Sherbham',       role:'Filling',  plant:'Rehla',  pct:[40,55], status:'green', shift:'10pm-6am', last:'2 min ago',  initial:'SB' },
  { name:'Vinod Kumar',    role:'Helper',   plant:'Bawana', pct:[12,18], status:'green', shift:'10pm-6am', last:'9 min ago',  initial:'VK' },
  { name:'Suresh',         role:'Security', plant:'Rehla',  pct:[30,52], status:'green', shift:'10pm-6am', last:'1 min ago',  initial:'SU' },
  { name:'Manoj',          role:'Security', plant:'Ganjam', pct:[78,52], status:'red',   shift:'10pm-6am', last:'42 min ago', initial:'MN' },
  { name:'Pradeep',        role:'Operator', plant:'Bawana', pct:[15,22], status:'green', shift:'10pm-6am', last:'6 min ago',  initial:'PR' }
];

export const MOVEMENTS = [
  { type:'batch',    title:'Batch 1229 closed at Rehla',         sub:'Final gravity 1390 · 32 drums · 52h 45m',           amt:'+32 drums', col:'#16A34A', when:'12 min ago' },
  { type:'sales',    title:'Dispatch to Samarth from Bawana',    sub:'30 drums @ 1400 · ₹85 · stock auto-OUT · contract -30', amt:'-30 drums', col:'#DC2626', when:'48 min ago' },
  { type:'purchase', title:'NP9 received at Rehla port',         sub:'52 MT · transporter Krishna · GR 7-tex',            amt:'+52 MT',    col:'#16A34A', when:'1 hr ago'   },
  { type:'maint',    title:'2" ball valve changed · Reactor R-1',sub:'Repair · Anooj · pic on file',                      amt:'closed',    col:'#475569', when:'2 hr ago'   },
  { type:'stock',    title:'NC Thinner at SHD below threshold',  sub:'Closing 3 · threshold 5',                           amt:'12 SKUs',   col:'#D97706', when:'2 hr ago'   },
  { type:'sales',    title:'HCL byproduct stocked in at Rehla',  sub:'63 MT auto-stock from Batch 1229',                  amt:'+63 MT',    col:'#16A34A', when:'3 hr ago'   },
  { type:'maint',    title:'70mm blank changed · Cooling tower', sub:'Repair · Devkumar',                                 amt:'closed',    col:'#475569', when:'3 hr ago'   },
  { type:'batch',    title:'Batch 1230 started at Ganjam',       sub:'Recipe 456 · target 1450',                          amt:'live',      col:'#F47651', when:'4 hr ago'   },
  { type:'purchase', title:'Marine ins. auto-deducted',          sub:'₹50 L · balance ₹9.50 Cr',                          amt:'-₹50 L',    col:'#DC2626', when:'5 hr ago'   },
  { type:'sales',    title:'Density change · Jains Int',         sub:'Booked 1400, took 1300 · spread ₹10',               amt:'10 drums',  col:'#F47651', when:'6 hr ago'   }
];

export const MODULES = [
  { name:'Purchase',         page:'purchase',  sub:'FAR · Maint · Activity · Store Req · POs · Marine · Labour', accent:true,  pending:7 },
  { name:'Sales',            page:'sales',     sub:'Contracts · dispatch · HCL/Acid', pending:2 },
  { name:'CPM Stock',        page:'stock',     sub:'Tanks · drums · 400+ store SKUs' },
  { name:'Batch Sheet',      page:'batch',     sub:'Reactor runs · QC · oil-ratio', pending:1 },
  { name:'Customer History', page:'customers', sub:'Ledger · density · payments' },
  { name:'Night Manager',    page:'nightmgr',  sub:'On-duty · GPS · photos' }
];

export const ALERTS = [
  { sev:'red',   text:'Marine ins. balance below threshold (12 Mar)', who:'Marine ledger',     when:'auto'   },
  { sev:'red',   text:'NC Thinner at SHD: 3 units · threshold 5',    who:'CPM Stock',         when:'2 hr'   },
  { sev:'amber', text:'Batch 1228 oil-ratio variance +2.4%',         who:'Batch · Oil Ratio', when:'today'  },
  { sev:'amber', text:'Customer Omgee · payment overdue 11 days',    who:'Sales · Payments',  when:'today'  },
  { sev:'amber', text:'Manoj (security · Ganjam) out of zone',       who:'Night Manager',     when:'42 min' },
  { sev:'low',   text:'2 maintenance items pending > 7 days',        who:'Maintenance',       when:'today'  },
  { sev:'low',   text:'Empty drum returns pending recon',            who:'CPM Stock',         when:'2 days' }
];

export const OIL_RATIO_SUNTEK = [
  { d:1100, np:'565 g', wx:'575 g', cl:'0.70', hcl:'1.05',  vr:-0.4, ok:true  },
  { d:1200, np:'510 g', wx:'520 g', cl:'0.95', hcl:'1.43',  vr:0.6,  ok:true  },
  { d:1300, np:'448 g', wx:'458 g', cl:'1.10', hcl:'1.65',  vr:-1.1, ok:true  },
  { d:1390, np:'395 g', wx:'405 g', cl:'1.29', hcl:'1.94',  vr:2.4,  ok:false },
  { d:1400, np:'390 g', wx:'400 g', cl:'1.30', hcl:'1.95',  vr:0.8,  ok:true  },
  { d:1450, np:'365 g', wx:'—',     cl:'1.40', hcl:'2.10',  vr:-0.2, ok:true  },
  { d:1500, np:'335 g', wx:'—',     cl:'1.65', hcl:'2.475', vr:0.3,  ok:true  }
];

export const OIL_RATIO_MANAV = [
  { d:1100, np:'571 g', wx:'581 g', cl:'0.68', hcl:'1.02',  vr:0,    ok:true },
  { d:1200, np:'516 g', wx:'526 g', cl:'0.92', hcl:'1.38',  vr:0.4,  ok:true },
  { d:1300, np:'453 g', wx:'463 g', cl:'1.08', hcl:'1.62',  vr:-0.5, ok:true },
  { d:1390, np:'399 g', wx:'409 g', cl:'1.25', hcl:'1.88',  vr:1.7,  ok:true },
  { d:1400, np:'394 g', wx:'404 g', cl:'1.25', hcl:'1.88',  vr:0.2,  ok:true },
  { d:1450, np:'369 g', wx:'—',     cl:'1.35', hcl:'2.03',  vr:0,    ok:true },
  { d:1500, np:'339 g', wx:'—',     cl:'1.60', hcl:'2.40',  vr:-0.3, ok:true }
];

// Batch grid pattern (35 dots): 3=orange, 2=light-orange, 1=gray
export const BATCH_GRID_PATTERN = [3,3,3,2,2,2,1,1,1,3,3,2,2,1,3,3,2,3,3,3,1,2,3,2,3,3,2,2,3,2,1,3,1,3,3];
