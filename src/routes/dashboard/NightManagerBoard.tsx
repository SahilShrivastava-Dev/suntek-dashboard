import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';

const PIN_COLOR: Record<string, string> = {
  green: '#16A34A',
  amber: '#D97706',
  red:   '#DC2626',
};

const PLANT_COORDS: Record<string, [number, number]> = {
  'Rehla': [24.1856, 84.0644],
  'Ganjam': [19.3800, 85.0700],
  'SHD': [28.6600, 77.2900],
  'Bawana': [28.8000, 77.0400],
  'Delhi': [28.7041, 77.1025],
};

interface CheckInLog {
  id?: string;
  name: string;
  role: string;
  plant: string;
  coords: [number, number];
  status: string;
  shift: string;
  last: string;
  submitted_at: string;
  initial: string;
  ip_address: string | null;
  isMapped: boolean;
  phone: string | null;
  photo_url: string | null;
}

// OpenStreetMap/CartoDB Voyager tile layer for highly readable and premium maps
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

function getCoords(plantName: string, realLat: number | null, realLng: number | null, index: number): [number, number] {
  if (realLat !== null && realLng !== null && !isNaN(realLat) && !isNaN(realLng)) {
    return [realLat, realLng];
  }
  
  const cleanName = Object.keys(PLANT_COORDS).find(k => plantName.includes(k)) || 'Rehla';
  const base = PLANT_COORDS[cleanName] || [24.1856, 84.0644];
  
  // Golden angle offset to beautifully spread out markers around the factory to prevent overlaps
  const angle = (index * 137.5) * (Math.PI / 180);
  const r = 0.005 + (index % 4) * 0.003;
  const jitterLat = Math.sin(angle) * r;
  const jitterLng = Math.cos(angle) * r;
  
  return [base[0] + jitterLat, base[1] + jitterLng];
}

function formatRelativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(dateStr).toLocaleDateString('en-IN');
}


function MapController({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

const createCustomIcon = (initials: string, status: string) => {
  const color = PIN_COLOR[status] || '#16A34A';
  return L.divIcon({
    html: `
      <div style="transform: translate(-18px, -44px); display: flex; flex-direction: column; align-items: center; cursor: pointer;">
        <div style="
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #ffffff;
          border: 2px solid ${color};
          box-shadow: 0 4px 10px rgba(0,0,0,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 11px;
          color: ${color};
          font-family: Inter, sans-serif;
        ">
          ${initials}
        </div>
        <div style="
          width: 0;
          height: 0;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-top: 8px solid ${color};
          margin-top: -1px;
        "></div>
      </div>
    `,
    className: 'custom-leaflet-marker',
    iconSize: [36, 44],
    iconAnchor: [18, 44],
  });
};

export function NightManagerBoard() {
  const [liveDuty, setLiveDuty] = useState<CheckInLog[]>([]);
  const [deviceMappings, setDeviceMappings] = useState<any[]>([]);
  const [selectedCheckIn, setSelectedCheckIn] = useState<CheckInLog | null>(null);
  
  // Start centered broadly on our Indian plants
  const [mapCenter, setMapCenter] = useState<[number, number]>([22.9734, 78.6569]);
  const [mapZoom, setMapZoom] = useState<number>(5);

  // Modal details
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState<{
    ip_address: string;
    name: string;
    department: string;
    phone: string;
  } | null>(null);
  const [isSubmittingMapping, setIsSubmittingMapping] = useState(false);

  const loadAllData = async () => {
    try {
      // 1. Fetch current mappings
      const { data: mappingsData } = await supabase.from('device_mappings').select('*') as any;
      const activeMappings = mappingsData || [];
      setDeviceMappings(activeMappings);

      // 2. Fetch shift logs
      const { data: logsData } = await supabase
        .from('shift_logs')
        .select('*, profiles(name, role, phone), plants(name)')
        .order('submitted_at', { ascending: false }) as any;
      
      const logs = logsData || [];
      
      // 3. Format shift logs with mapping resolution
      const formatted = logs.map((row: any, index: number) => {
        const isGuest = !row.employee_id;
        const ip = row.ip_address;
        
        let name = row.profiles?.name || 'Live Check-In';
        let role = row.profiles?.role || 'L1';
        let phone = row.profiles?.phone || null;
        let isMapped = false;
        
        if (isGuest && ip) {
          const mapping = activeMappings.find((m: any) => m.ip_address === ip);
          if (mapping) {
            name = mapping.name;
            role = mapping.department ? `${mapping.department} (Guest)` : 'Guest';
            phone = mapping.phone;
            isMapped = true;
          } else {
            name = `Guest (${ip})`;
            role = 'Unknown Department';
            isMapped = false;
          }
        }
        
        const plant = row.plants?.name || 'Unknown Plant';
        const coords = getCoords(plant, row.lat, row.lng, index);
        
        return {
          id: row.id,
          name,
          role,
          plant,
          coords,
          status: row.is_on_site ? 'green' : 'red',
          shift: 'Live Check-in',
          last: formatRelativeTime(row.submitted_at),
          submitted_at: row.submitted_at,
          initial: name.substring(0, 2).toUpperCase(),
          ip_address: ip,
          isMapped,
          phone,
          photo_url: row.photo_url,
        };
      });

      setLiveDuty(formatted);
    } catch (e) {
      console.error('Error loading board data:', e);
    }
  };

  useEffect(() => {
    loadAllData();

    // Subscribe to real-time additions of logs and mappings
    const logsChannel = supabase.channel('shift_logs_board_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shift_logs' },
        () => { loadAllData(); }
      )
      .subscribe();

    const mappingsChannel = supabase.channel('device_mappings_board_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'device_mappings' },
        () => { loadAllData(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(logsChannel);
      supabase.removeChannel(mappingsChannel);
    };
  }, []);

  const sortedDuty = [...liveDuty].sort(
    (a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
  );

  const openMappingModal = (d: CheckInLog) => {
    if (!d.ip_address) return;
    const existing = deviceMappings.find(m => m.ip_address === d.ip_address);
    setModalData({
      ip_address: d.ip_address,
      name: existing?.name || '',
      department: existing?.department || '',
      phone: existing?.phone || '',
    });
    setIsModalOpen(true);
  };

  const handleSaveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalData) return;
    setIsSubmittingMapping(true);
    try {
      const { error } = await (supabase
        .from('device_mappings') as any)
        .upsert({
          ip_address: modalData.ip_address,
          name: modalData.name,
          department: modalData.department || null,
          phone: modalData.phone || null,
        });

      if (error) {
        alert(`Error saving mapping: ${error.message}`);
      } else {
        setIsModalOpen(false);
        setModalData(null);
        await loadAllData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingMapping(false);
    }
  };

  return (
    <>
      {/* KPIs */}
      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">On duty now</div>
          <div className="text-[28px] font-extrabold mt-1 num text-slate-900">{liveDuty.filter(d => d.status === 'green').length}</div>
          <div className="text-[11px] text-slate-500 mt-1">across {new Set(liveDuty.map(d => d.plant)).size || 0} factories</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Geo-tagged check-ins</div>
          <div className="text-[28px] font-extrabold mt-1 num text-slate-900">{liveDuty.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">today</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Out-of-zone</div>
          <div className="text-[28px] font-extrabold mt-1 num text-amber-600">{liveDuty.filter(d => d.status === 'red').length}</div>
          <div className="text-[11px] text-amber-600 mt-1">flagged</div>
        </div>
        <div className="col-span-12 lg:col-span-3 card p-5">
          <div className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Photo proof %</div>
          <div className="text-[28px] font-extrabold mt-1 num text-slate-900">
            {liveDuty.length > 0 ? Math.round((liveDuty.filter(d => d.photo_url).length / liveDuty.length) * 100) : 0}%
          </div>
        </div>
      </div>

      {/* Map + duty list */}
      <div className="grid grid-cols-12 gap-5">
        {/* Map - Leaflet container */}
        <div className="col-span-12 lg:col-span-7 card p-6" style={{ background: 'var(--amber-soft)', border: '1px solid #fde68a' }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-base font-bold text-slate-900">Live check-in map</div>
              <div className="text-xs text-slate-500">GPS coordinates tagged · click pins to see role details & photo</div>
            </div>
            {selectedCheckIn && (
              <button 
                onClick={() => {
                  setMapCenter([22.9734, 78.6569]);
                  setMapZoom(5);
                  setSelectedCheckIn(null);
                }}
                className="text-xs px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-600 border border-amber-200 rounded-lg shadow-sm font-semibold transition-colors"
              >
                Reset Map
              </button>
            )}
          </div>

          <div className="relative h-[380px] rounded-2xl bg-slate-100 overflow-hidden shadow-inner border border-slate-200" style={{ zIndex: 1 }}>
            <MapContainer
              center={mapCenter}
              zoom={mapZoom}
              scrollWheelZoom={true}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                attribution={TILE_ATTRIBUTION}
                url={TILE_URL}
              />
              <MapController center={mapCenter} zoom={mapZoom} />
              
              {sortedDuty.map((d, i) => (
                <Marker
                  key={i}
                  position={d.coords}
                  icon={createCustomIcon(d.initial, d.status)}
                  eventHandlers={{
                    click: () => {
                      setSelectedCheckIn(d);
                    }
                  }}
                >
                  <Popup minWidth={220}>
                    <div className="p-1 text-slate-800" style={{ fontFamily: 'Inter, sans-serif' }}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center font-bold text-[10px] text-slate-600">
                          {d.initial}
                        </div>
                        <div>
                          <div className="font-extrabold text-[13px] leading-tight text-slate-950">{d.name}</div>
                          <div className="text-[10px] text-slate-500 font-medium">{d.role}</div>
                        </div>
                      </div>

                      <div className="space-y-1 text-[11px] bg-slate-50 p-2 rounded-lg border border-slate-100 mb-2">
                        <div><strong className="text-slate-500">Plant:</strong> <span className="font-semibold">{d.plant}</span></div>
                        <div><strong className="text-slate-500">Seen:</strong> <span className="font-semibold">{d.last}</span></div>
                        {d.ip_address && (
                          <div>
                            <strong className="text-slate-500">Device IP:</strong> <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-[10px]">{d.ip_address}</code>
                          </div>
                        )}
                        {d.phone && (
                          <div><strong className="text-slate-500">Phone:</strong> <span className="font-semibold">{d.phone}</span></div>
                        )}
                        <div>
                          <strong className="text-slate-500">Status:</strong>{' '}
                          <span className={`font-bold ${d.status === 'green' ? 'text-emerald-600' : d.status === 'amber' ? 'text-amber-600' : 'text-rose-600'}`}>
                            {d.status === 'green' ? 'On Site · In Zone' : d.status === 'amber' ? 'On Site · Zone Edge' : 'Out of Zone'}
                          </span>
                        </div>
                      </div>

                      {d.photo_url && (
                        <div className="mb-2 rounded-lg overflow-hidden border border-slate-100 max-h-[120px] flex items-center justify-center bg-slate-50">
                          <img src={d.photo_url} alt="Compliance Proof" className="w-full h-full object-cover" />
                        </div>
                      )}

                      {d.ip_address && (
                        <button
                          onClick={() => openMappingModal(d)}
                          className="w-full text-center py-1.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm shadow-blue-500/10"
                        >
                          {d.isMapped ? 'Edit IP Details' : 'Register IP Details'}
                        </button>
                      )}
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>

          <div className="flex items-center gap-3 mt-3 text-[11px] text-slate-600 font-semibold">
            <span className="flex items-center gap-1.5">
              <span className="status-dot sd-green animate-pulse" style={{ width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block' }}></span>
              On site · in zone
            </span>
            <span className="flex items-center gap-1.5">
              <span className="status-dot sd-amber" style={{ width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block' }}></span>
              On site · zone edge
            </span>
            <span className="flex items-center gap-1.5">
              <span className="status-dot sd-red" style={{ width: '8px', height: '8px', borderRadius: '50%', display: 'inline-block' }}></span>
              Out of zone
            </span>
          </div>
        </div>

        {/* Duty list */}
        <div className="col-span-12 lg:col-span-5 card p-6" style={{ background: 'var(--amber-soft)', border: '1px solid #fde68a' }}>
          <div className="text-base font-bold mb-1 text-slate-900 font-serif serif text-lg">On duty · current shift</div>
          <div className="text-[11px] text-slate-500 mb-4">Latest check-ins automatically appear at the top. Click any to locate them.</div>
          
          <div className="space-y-2.5 max-h-[400px] overflow-y-auto pr-1">
            {sortedDuty.map((d, i) => {
              const dotColor = PIN_COLOR[d.status];
              const isSelected = selectedCheckIn?.name === d.name;
              
              return (
                <div
                  key={i}
                  onClick={() => {
                    setMapCenter(d.coords);
                    setMapZoom(13);
                    setSelectedCheckIn(d);
                  }}
                  className={`flex items-center gap-3 p-3 rounded-2xl hover:bg-white/80 active:bg-white transition-all cursor-pointer border ${
                    isSelected ? 'bg-white shadow-md border-amber-300 transform -translate-y-0.5' : 'border-transparent bg-white/40'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-200 to-slate-400 flex items-center justify-center text-slate-700 font-extrabold text-xs shadow-sm">
                    {d.initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm text-slate-900 leading-tight flex items-center gap-2 flex-wrap">
                      <span>{d.name}</span>
                      {d.ip_address && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openMappingModal(d);
                          }}
                          className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold border transition-colors ${
                            d.isMapped
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 animate-pulse'
                          }`}
                          title={`IP: ${d.ip_address}. Click to manage assignment.`}
                        >
                          {d.isMapped ? 'Mapped' : 'Unmapped IP'}
                        </button>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">{d.role} · {d.plant} · {d.shift}</div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 justify-end">
                      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }}></span>
                      {d.last}
                    </div>
                    <div className="text-[10px] text-slate-400 font-semibold mt-1">GPS · pic</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Glassmorphism Device Registration Modal */}
      {isModalOpen && modalData && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadein" style={{ animation: 'fadein 200ms ease' }}>
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-6 border border-slate-100 overflow-hidden relative">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-extrabold text-slate-950">Assign Device IP Details</h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors font-bold"
              >
                ✕
              </button>
            </div>
            
            <div className="mb-4 bg-slate-50 border border-slate-100 p-3.5 rounded-2xl flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-bold font-mono">
                IP
              </div>
              <div>
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Device IP Address</div>
                <div className="font-mono text-sm font-semibold text-slate-700">{modalData.ip_address}</div>
              </div>
            </div>

            <form onSubmit={handleSaveMapping} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={modalData.name}
                  onChange={e => setModalData({ ...modalData, name: e.target.value })}
                  placeholder="e.g. Anooj Kumar"
                  className="w-full p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                  Department / Role *
                </label>
                <input
                  type="text"
                  required
                  value={modalData.department}
                  onChange={e => setModalData({ ...modalData, department: e.target.value })}
                  placeholder="e.g. Operator, Helper, Security"
                  className="w-full p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={modalData.phone}
                  onChange={e => setModalData({ ...modalData, phone: e.target.value })}
                  placeholder="e.g. +91 98765 43210"
                  className="w-full p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-medium"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 text-sm bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingMapping}
                  className="flex-1 py-3 rounded-xl font-bold text-white text-sm bg-blue-600 hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20 disabled:bg-slate-400"
                >
                  {isSubmittingMapping ? 'Saving...' : 'Register Device'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
