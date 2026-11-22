import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { HuffmanTreeView } from '../HuffmanTreeView';

interface RoomsTabProps {
  rooms: any[];
  selectedRoom: any;
  onInspectRoom: (roomId: string) => void;
}

export function RoomsTab({ rooms, selectedRoom, onInspectRoom }: RoomsTabProps) {
  const [roomFilter, setRoomFilter] = useState<'all' | 'human' | 'ai' | 'encrypted'>('all');
  const [roomSearch, setRoomSearch] = useState('');

  const filteredRooms = rooms.filter((r) => {
    if (roomFilter === 'human' && r.isAiRoom) return false;
    if (roomFilter === 'ai' && !r.isAiRoom) return false;
    if (roomFilter === 'encrypted' && !r.encrypted) return false;
    if (roomSearch.trim()) {
      const q = roomSearch.toLowerCase();
      if (!`${r.roomId} ${r.user1Alias} ${r.user2Alias}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16, minWidth: 0 }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Archived Rooms ({rooms.length})</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {([
              { key: 'all', label: 'All' },
              { key: 'human', label: 'Human' },
              { key: 'ai', label: 'AI Companion' },
              { key: 'encrypted', label: 'Encrypted' }
            ] as const).map((f) => (
              <button key={f.key} className={`btn ${roomFilter === f.key ? 'primary' : ''}`} onClick={() => setRoomFilter(f.key)}>
                {f.label}
              </button>
            ))}
            <input
              className="input"
              value={roomSearch}
              onChange={(e) => setRoomSearch(e.target.value)}
              placeholder="Search room ID or alias..."
              style={{ width: 200 }}
            />
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Participants</th>
                <th>Match</th>
                <th>Msgs</th>
                <th>Savings</th>
                <th>H(X) / L̄</th>
                <th>Encryption</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRooms.map((r) => (
                <tr key={r.roomId}>
                  <td className="mono">{String(r.roomId).slice(0, 8)}...</td>
                  <td>{r.user1Alias} × {r.user2Alias}</td>
                  <td>
                    <span className={`badge ${r.isAiRoom ? 'sky' : 'emerald'}`}>{r.isAiRoom ? 'AI' : 'Human'}</span>
                  </td>
                  <td className="mono">{r.messagesCount}</td>
                  <td className="mono" style={{ color: '#047857' }}>{r.compressionSavingsPct}%</td>
                  <td className="mono">
                    {r.shannonEntropy ?? '-'} / {r.averageCodeLength ?? '-'}
                  </td>
                  <td>
                    <span className={`badge ${r.encrypted ? 'emerald' : 'amber'}`}>
                      <Lock size={11} /> {r.encrypted ? 'AES-256-GCM' : 'Legacy'}
                    </span>
                  </td>
                  <td>
                    <button className="btn primary" onClick={() => onInspectRoom(r.roomId)}>
                      Decrypt &amp; Tree
                    </button>
                  </td>
                </tr>
              ))}
              {filteredRooms.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: '#575049' }}>No matching archived rooms found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRoom && (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>
                Canonical Huffman Binary Tree — Room <span className="mono">{selectedRoom.roomId}</span>
              </h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="badge emerald">Saved {selectedRoom.stats?.savingsPercent}%</span>
                <span className="badge sky">
                  {selectedRoom.stats?.originalBytes}B → {selectedRoom.stats?.compressedBytes}B
                </span>
                <span className="badge emerald">
                  H(X)={selectedRoom.stats?.shannonEntropy} ≤ L̄={selectedRoom.stats?.averageCodeLength}
                </span>
              </div>
            </div>
            <HuffmanTreeView tree={selectedRoom.huffmanTree} />
          </div>

          <div className="grid-2">
            <div className="card">
              <h3>Decrypted Transcript ({selectedRoom.messages?.length ?? 0} messages)</h3>
              <div style={{ maxHeight: 340, overflowY: 'auto', display: 'grid', gap: 8 }}>
                {(selectedRoom.messages || []).map((m: any, idx: number) => (
                  <div
                    key={m.id || idx}
                    style={{
                      background: '#fff4e4',
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(30,27,24,0.12)'
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#047857', fontWeight: 600 }}>
                      {m.author_alias || m.authorAlias || 'Student'}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 2 }}>{m.content}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h3>Canonical Prefix Codebook ({Object.keys(selectedRoom.canonicalCodes || {}).length} symbols)</h3>
              <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Freq</th>
                      <th>Bits</th>
                      <th>Canonical Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(selectedRoom.canonicalCodes || {}).map(([sym, code]) => (
                      <tr key={sym}>
                        <td className="mono">{sym === ' ' ? '[SPACE]' : sym}</td>
                        <td className="mono">{selectedRoom.symbolFrequencies?.[sym] ?? '-'}</td>
                        <td className="mono">{selectedRoom.codeLengths?.[sym]}</td>
                        <td className="mono" style={{ color: '#047857' }}>{String(code)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
