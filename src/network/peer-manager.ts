/* ──────────────────────────────────────────────
   PeerJS Network Manager
   Host-Authoritative P2P via WebRTC DataChannel
   ────────────────────────────────────────────── */

import Peer, { DataConnection } from 'peerjs';
import type { NetworkPacket } from '../types/index';

const PEER_PREFIX = 'guessthe-';

export type PeerRole = 'host' | 'client' | 'solo';

interface PeerCallbacks {
  onPlayerJoin?: (peerId: string, name: string) => void;
  onPlayerLeave?: (peerId: string) => void;
  onReceive?: (peerId: string, packet: NetworkPacket) => void;
  onError?: (error: string) => void;
  onOpen?: (peerId: string) => void;
}

class PeerManager {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private lastSeen: Map<string, number> = new Map();
  private callbacks: PeerCallbacks = {};
  private _role: PeerRole = 'solo';
  private _roomCode: string = '';
  private _peerId: string = '';
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  private _isConnecting: boolean = false;

  get role(): PeerRole { return this._role; }
  get roomCode(): string { return this._roomCode; }
  get peerId(): string { return this._peerId; }
  get hostPeerId(): string {
    return this._role === 'client' ? PEER_PREFIX + this._roomCode : (this._peerId || '');
  }
  get connectedPeerIds(): string[] { return Array.from(this.connections.keys()); }
  get isHost(): boolean { return this._role === 'host' || this._role === 'solo'; }

  /** Set callbacks (replaces ALL previous callbacks) */
  on(callbacks: PeerCallbacks): void {
    this.callbacks = callbacks;
  }

  /** Merge additional callbacks onto existing ones */
  onMerge(callbacks: Partial<PeerCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /** Create a room as Host */
  async createRoom(roomCode: string): Promise<string> {
    this.destroy();
    this._role = 'host';
    this._roomCode = roomCode;

    return new Promise((resolve, reject) => {
      const peerId = PEER_PREFIX + roomCode;
      this.peer = new Peer(peerId, {
        debug: 0,
      });

      this.peer.on('open', (id) => {
        this._peerId = id;
        this.setupHostListeners();
        this.startHeartbeat();
        if (this.callbacks.onOpen) this.callbacks.onOpen(id);
        resolve(roomCode);
      });

      this.peer.on('error', (err) => {
        const errMsg = err.type === 'unavailable-id'
          ? `ห้อง ${roomCode} ถูกใช้งานอยู่แล้ว ลองรหัสใหม่`
          : `PeerJS Error: ${err.message}`;
        if (this.callbacks.onError) this.callbacks.onError(errMsg);
        reject(new Error(errMsg));
      });
    });
  }

  /** Join a room as Client */
  async joinRoom(roomCode: string, playerName: string): Promise<void> {
    if (this._isConnecting) {
      console.warn('[PeerManager] joinRoom already in progress, ignoring duplicate call');
      return;
    }
    this._isConnecting = true;
    this.destroy();
    this._role = 'client';
    this._roomCode = roomCode;

    return new Promise((resolve, reject) => {
      const finish = (err?: Error) => {
        this._isConnecting = false;
        if (err) reject(err);
        else resolve();
      };

      this.peer = new Peer({
        debug: 0,
      } as any);

      this.peer.on('open', (id) => {
        this._peerId = id;
        
        const hostPeerId = PEER_PREFIX + roomCode;
        const conn = this.peer!.connect(hostPeerId, { reliable: true });

        conn.on('open', () => {
          this.connections.set(hostPeerId, conn);
          // Send join packet
          this.send({ type: 'PLAYER_JOIN', peerId: id, name: playerName });
          this.setupDataListener(conn, hostPeerId);
          this.startHeartbeat();
          if (this.callbacks.onOpen) this.callbacks.onOpen(id);
          finish();
        });

        conn.on('close', () => {
          this.connections.delete(hostPeerId);
          if (this.callbacks.onPlayerLeave) this.callbacks.onPlayerLeave(hostPeerId);
        });

        conn.on('error', (err) => {
          this.connections.delete(hostPeerId);
          const errMsg = `ไม่สามารถเชื่อมต่อห้อง ${roomCode}: ${err.message || err}`;
          if (this.callbacks.onError) this.callbacks.onError(errMsg);
          finish(new Error(errMsg));
        });

        // Timeout after 10s
        setTimeout(() => {
          if (!conn.open) {
            finish(new Error(`หมดเวลาเชื่อมต่อห้อง ${roomCode}`));
          }
        }, 10000);
      });

      this.peer.on('error', (err) => {
        if (this.callbacks.onError) this.callbacks.onError(err.message);
        finish(new Error(err.message));
      });
    });
  }

  /** Host: listen for incoming connections */
  private setupHostListeners(): void {
    if (!this.peer) return;

    this.peer.on('connection', (conn) => {
      // Allow up to 9 connections for host (10 players total)
      if (this.connections.size >= 9) {
        conn.close();
        return;
      }

      let opened = false;
      const onOpen = () => {
        if (opened) return;
        opened = true;
        this.connections.set(conn.peer, conn);
        this.lastSeen.set(conn.peer, Date.now());
        this.setupDataListener(conn, conn.peer);
      };

      if (conn.open) {
        onOpen();
      } else {
        conn.on('open', onOpen);
      }
    });
  }

  /** Set up data listener on a connection */
  private setupDataListener(conn: DataConnection, remotePeerId: string): void {
    conn.on('data', (data) => {
      this.lastSeen.set(remotePeerId, Date.now());
      const packet = data as NetworkPacket;
      
      // Handle ping/pong silently
      if (packet.type === 'PING') {
        conn.send({ type: 'PONG' });
        return;
      }
      if (packet.type === 'PONG') return;

      if (this.callbacks.onReceive) {
        this.callbacks.onReceive(remotePeerId, packet);
      }

      // If host receives a PLAYER_JOIN, notify callback with remote peer ID
      if (this._role === 'host' && packet.type === 'PLAYER_JOIN') {
        if (this.callbacks.onPlayerJoin) {
          this.callbacks.onPlayerJoin(remotePeerId, packet.name);
        }
      }
    });

    conn.on('close', () => {
      this.connections.delete(remotePeerId);
      this.lastSeen.delete(remotePeerId);
      if (this.callbacks.onPlayerLeave) this.callbacks.onPlayerLeave(remotePeerId);
    });

    conn.on('error', () => {
      this.connections.delete(remotePeerId);
      this.lastSeen.delete(remotePeerId);
      if (this.callbacks.onPlayerLeave) this.callbacks.onPlayerLeave(remotePeerId);
    });
  }

  /** Explicitly close and remove a connection by peerId */
  closeConnection(peerId: string): void {
    const conn = this.connections.get(peerId);
    if (conn) {
      try { conn.close(); } catch { /* ignore */ }
      this.connections.delete(peerId);
    }
    this.lastSeen.delete(peerId);
  }

  /** Send packet to host (client) or to a specific peer (host) */
  send(packet: NetworkPacket, targetPeerId?: string): void {
    if (this._role === 'client') {
      // Client sends to host
      const hostConn = this.connections.values().next().value;
      if (hostConn && hostConn.open) {
        hostConn.send(packet);
      }
    } else if (targetPeerId) {
      const conn = this.connections.get(targetPeerId);
      if (conn && conn.open) {
        conn.send(packet);
      }
    }
  }

  /** Broadcast packet to all connected peers (host only) */
  broadcast(packet: NetworkPacket): void {
    for (const conn of this.connections.values()) {
      if (conn.open) {
        conn.send(packet);
      }
    }
  }

  /** Prune connections that are dead or stuck/idle for > 5 seconds */
  pruneInactivePeers(maxIdleMs = 5000): string[] {
    const now = Date.now();
    const pruned: string[] = [];
    for (const [peerId, conn] of Array.from(this.connections.entries())) {
      const last = this.lastSeen.get(peerId) ?? now;
      if (now - last > maxIdleMs || !conn.open) {
        try { conn.close(); } catch { /* ignore */ }
        this.connections.delete(peerId);
        this.lastSeen.delete(peerId);
        pruned.push(peerId);
        if (this.callbacks.onPlayerLeave) this.callbacks.onPlayerLeave(peerId);
      }
    }
    return pruned;
  }

  /** Heartbeat to keep connections alive and prune dead connections */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      // 1. Prune peers inactive for > 5s
      this.pruneInactivePeers(5000);

      // 2. Ping remaining active connections
      for (const [peerId, conn] of Array.from(this.connections.entries())) {
        if (!conn.open) continue;
        try {
          conn.send({ type: 'PING' });
        } catch {
          this.connections.delete(peerId);
          this.lastSeen.delete(peerId);
          if (this.callbacks.onPlayerLeave) this.callbacks.onPlayerLeave(peerId);
        }
      }
    }, 1500);
  }

  /** Clean up everything */
  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const conn of this.connections.values()) {
      try { conn.close(); } catch { /* ignore */ }
    }
    this.connections.clear();

    if (this.peer) {
      try { this.peer.destroy(); } catch { /* ignore */ }
      this.peer = null;
    }

    this._role = 'solo';
    this._roomCode = '';
    this._peerId = '';
    this._isConnecting = false;
    this.callbacks = {};
  }
}

// Singleton instance
export const peerManager = new PeerManager();

// Clean up peer connections when the browser tab is closed or reloaded
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    peerManager.destroy();
  });
}
