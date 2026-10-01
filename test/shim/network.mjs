// Ağ durumu testten değiştirilir: globalThis.__net = 'wifi' | 'cell' | 'none'
export const NetworkStateType = { NONE: 'NONE', UNKNOWN: 'UNKNOWN', CELLULAR: 'CELLULAR', WIFI: 'WIFI', ETHERNET: 'ETHERNET', VPN: 'VPN', OTHER: 'OTHER' };
export async function getNetworkStateAsync() {
  globalThis.__netCalls = (globalThis.__netCalls || 0) + 1;
  const n = globalThis.__net || 'wifi';
  if (n === 'none') return { type: NetworkStateType.NONE, isConnected: false, isInternetReachable: false };
  return { type: n === 'wifi' ? NetworkStateType.WIFI : NetworkStateType.CELLULAR, isConnected: true, isInternetReachable: true };
}
