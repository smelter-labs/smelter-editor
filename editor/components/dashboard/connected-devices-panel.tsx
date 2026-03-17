'use client';

import { useState } from 'react';
import { Wifi, WifiOff, ChevronDown, ChevronUp } from 'lucide-react';
import type { ConnectedPeer } from '@/components/control-panel/hooks/use-room-websocket';

interface ConnectedDevicesPanelProps {
  peers: ConnectedPeer[];
}

export function ConnectedDevicesPanel({ peers }: ConnectedDevicesPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  const connected = peers.length > 0;

  return (
    <div className='h-full overflow-y-auto p-3 border border-neutral-800 rounded-md bg-neutral-900'>
      <div className='flex items-center gap-2 px-2.5 py-1.5 border-b border-neutral-700/60'>
        {connected ? (
          <Wifi className='w-3.5 h-3.5 text-green-400 shrink-0' />
        ) : (
          <WifiOff className='w-3.5 h-3.5 text-neutral-500 shrink-0' />
        )}
        <span className='text-[11px] font-semibold text-neutral-300 uppercase tracking-wider flex-1'>
          Connected ({peers.length})
        </span>
        <button
          className='text-neutral-500 hover:text-neutral-200 transition-colors p-0.5 cursor-pointer'
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand connected devices' : 'Collapse connected devices'}
          aria-expanded={!collapsed}
          aria-controls='connected-devices-panel-content'>
          {collapsed ? (
            <ChevronDown className='w-3.5 h-3.5' />
          ) : (
            <ChevronUp className='w-3.5 h-3.5' />
          )}
        </button>
      </div>

      {!collapsed && (
        <div
          id='connected-devices-panel-content'
          className='px-2.5 py-2 flex flex-col gap-1'>
          {peers.length === 0 ? (
            <span className='text-[11px] text-neutral-500 italic'>
              No devices connected
            </span>
          ) : (
            peers.map((peer) => (
              <div key={peer.clientId} className='flex items-center gap-2'>
                <span className='w-1.5 h-1.5 rounded-full bg-green-400 shrink-0' />
                <span className='text-[12px] text-neutral-200 truncate'>
                  {peer.name ?? 'Unknown'}
                </span>
                <span className='text-[10px] text-neutral-600 font-mono truncate ml-auto'>
                  {peer.clientId.slice(0, 8)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
