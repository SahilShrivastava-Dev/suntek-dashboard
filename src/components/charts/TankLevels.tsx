import React from 'react';
import { clsx } from 'clsx';
import { AlertTriangle } from 'lucide-react';
export interface TankLevel {
  name: string;
  plant: string;
  levelPct: number;
  product: string;
  isAlert: boolean;
  alertThresholdPct: number;
}

interface TankLevelsProps {
  tanks: TankLevel[];
}

function TankBar({ tank }: { tank: TankLevel }) {
  const { name, plant, levelPct, product, isAlert, alertThresholdPct } = tank;

  const fillColor = isAlert
    ? 'bg-red-500'
    : levelPct >= 70
    ? 'bg-blue-500'
    : levelPct >= 40
    ? 'bg-green-500'
    : 'bg-amber-400';

  return (
    <div className="flex items-center gap-3 py-2">
      {/* Tank visual (pictorial bar) */}
      <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
        {/* Tank outline */}
        <div className="w-8 h-16 border-2 border-gray-300 rounded-sm relative overflow-hidden bg-gray-50">
          <div
            className={clsx('absolute bottom-0 left-0 right-0 transition-all duration-500', fillColor)}
            style={{ height: `${levelPct}%` }}
          />
          {/* Alert threshold line */}
          <div
            className="absolute left-0 right-0 border-t border-dashed border-red-400/60 z-10"
            style={{ bottom: `${alertThresholdPct}%` }}
            title={`Alert at ${alertThresholdPct}%`}
          />
        </div>
        <span className={clsx(
          'text-[10px] font-bold',
          isAlert ? 'text-red-600' : 'text-gray-500'
        )}>
          {levelPct}%
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
          {isAlert && (
            <AlertTriangle size={12} className="text-red-500 flex-shrink-0" />
          )}
        </div>
        <p className="text-xs text-gray-500">{product} · {plant}</p>
        {isAlert && (
          <p className="text-[10px] text-red-500 font-medium mt-0.5">
            Below {alertThresholdPct}% threshold — refill required
          </p>
        )}
      </div>
    </div>
  );
}

export function TankLevels({ tanks }: TankLevelsProps) {
  const alertTanks = tanks.filter((t) => t.isAlert);
  const normalTanks = tanks.filter((t) => !t.isAlert);

  return (
    <div>
      {alertTanks.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wide mb-1">
            ⚠ Alert
          </p>
          <div className="divide-y divide-red-100 bg-red-50/30 rounded-lg px-3 border border-red-100">
            {alertTanks.map((t) => <TankBar key={t.name} tank={t} />)}
          </div>
        </div>
      )}
      <div className="divide-y divide-gray-100">
        {normalTanks.map((t) => <TankBar key={t.name} tank={t} />)}
      </div>
    </div>
  );
}
