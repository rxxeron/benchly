/**
 * CSE246 Lab 4 / Lecture 9: Canonical Huffman Coding + AES-256-GCM Archive Engine
 * Compresses concluded 30-min / 100-message room transcripts in Redis via a custom
 * BinaryMinHeap and Canonical Prefix Codebook, then seals the compressed bitstream
 * with AES-256-GCM before persisting a single row into public.room_conversations.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

interface HuffmanTreeNode {
    symbol: string | null;
    frequency: number;
    left: HuffmanTreeNode | null;
    right: HuffmanTreeNode | null;
}

class BinaryMinHeap {
    private data: HuffmanTreeNode[] = [];

    get size(): number {
        return this.data.length;
    }

    insert(node: HuffmanTreeNode): void {
        this.data.push(node);
        this.siftUp(this.data.length - 1);
    }

    extractMin(): HuffmanTreeNode {
        if (this.data.length === 0) {
            throw new Error('Cannot extractMin from empty BinaryMinHeap');
        }
        const min = this.data[0];
        const last = this.data.pop()!;
        if (this.data.length > 0) {
            this.data[0] = last;
            this.siftDown(0);
        }
        return min;
    }

    private compare(a: HuffmanTreeNode, b: HuffmanTreeNode): number {
        if (a.frequency !== b.frequency) return a.frequency - b.frequency;
        return (a.symbol || '').localeCompare(b.symbol || '');
    }

    private siftUp(idx: number): void {
        let cur = idx;
        while (cur > 0) {
            const parent = (cur - 1) >> 1;
            if (this.compare(this.data[cur], this.data[parent]) < 0) {
                const tmp = this.data[cur];
                this.data[cur] = this.data[parent];
                this.data[parent] = tmp;
                cur = parent;
            } else {
                break;
            }
        }
    }

    private siftDown(idx: number): void {
        let cur = idx;
        const n = this.data.length;
        while (true) {
            const left = (cur << 1) + 1;
            const right = left + 1;
            let smallest = cur;
            if (left < n && this.compare(this.data[left], this.data[smallest]) < 0) {
                smallest = left;
            }
            if (right < n && this.compare(this.data[right], this.data[smallest]) < 0) {
                smallest = right;
            }
            if (smallest !== cur) {
                const tmp = this.data[cur];
                this.data[cur] = this.data[smallest];
                this.data[smallest] = tmp;
                cur = smallest;
            } else {
                break;
            }
        }
    }
}

export interface CompressedTranscriptMeta {
    originalLength: number;
    originalBytes: number;
    compressedBytes: number;
    savingsPercent: number;
    shannonEntropy: number;
    averageCodeLength: number;
    shannonVerified: boolean;
    distinctSymbols: number;
    codeLengths: Record<string, number>;
    packedBase64: string;
}

export interface EncryptedHuffmanArchive {
    algorithm: 'canonical-huffman+aes-256-gcm';
    originalLength: number;
    originalBytes: number;
    compressedBytes: number;
    savingsPercent: number;
    shannonEntropy: number;
    averageCodeLength: number;
    shannonVerified: boolean;
    distinctSymbols: number;
    codeLengths: Record<string, number>;
    ivBase64: string;
    authTagBase64: string;
    ciphertextBase64: string;
}

export interface VisualHuffmanTreeNode {
    id: string;
    symbol: string | null;
    bit: '0' | '1' | null;
    code: string;
    depth: number;
    frequency: number;
    left: VisualHuffmanTreeNode | null;
    right: VisualHuffmanTreeNode | null;
}

export class CanonicalHuffmanCodec {
    private static deriveKey(secret?: string): Buffer {
        const raw = secret || process.env.ARCHIVE_MASTER_KEY || process.env.SUPABASE_SERVICE_KEY || 'benchly-ephemeral-dev-key';
        return createHash('sha256').update(raw, 'utf8').digest();
    }

    /**
     * Deterministically rebuilds canonical prefix codes from (symbol -> bitLength)
     * using the exact (bitLength ASC, symbol ASC) order.
     */
    static buildCanonicalCodes(codeLengths: Record<string, number>): Record<string, string> {
        const sortedSyms = Object.keys(codeLengths).sort((a, b) => {
            const d = codeLengths[a] - codeLengths[b];
            return d !== 0 ? d : a.localeCompare(b);
        });
        const canonicalCodes: Record<string, string> = {};
        if (sortedSyms.length === 0) return canonicalCodes;

        let codeVal = 0;
        let prevLen = codeLengths[sortedSyms[0]];
        for (let i = 0; i < sortedSyms.length; i++) {
            const sym = sortedSyms[i];
            const curLen = codeLengths[sym];
            if (i > 0) {
                codeVal = (codeVal + 1) << (curLen - prevLen);
            }
            canonicalCodes[sym] = codeVal.toString(2).padStart(curLen, '0');
            prevLen = curLen;
        }
        return canonicalCodes;
    }

    static compressTranscriptJson(rawJson: string): CompressedTranscriptMeta {
        const input = rawJson || '[]';
        const freq: Record<string, number> = {};
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            freq[ch] = (freq[ch] || 0) + 1;
        }

        const symbols = Object.keys(freq);
        if (symbols.length === 0) {
            return {
                originalLength: 0,
                originalBytes: 0,
                compressedBytes: 0,
                savingsPercent: 0,
                shannonEntropy: 0,
                averageCodeLength: 0,
                shannonVerified: true,
                distinctSymbols: 0,
                codeLengths: {},
                packedBase64: ''
            };
        }

        const heap = new BinaryMinHeap();
        for (const sym of symbols) {
            heap.insert({ symbol: sym, frequency: freq[sym], left: null, right: null });
        }

        if (heap.size === 1) {
            const only = heap.extractMin();
            heap.insert({ symbol: null, frequency: only.frequency, left: only, right: null });
        }

        while (heap.size > 1) {
            const left = heap.extractMin();
            const right = heap.extractMin();
            heap.insert({
                symbol: null,
                frequency: left.frequency + right.frequency,
                left,
                right
            });
        }

        const root = heap.extractMin();
        const codeLengths: Record<string, number> = {};

        const extractDepth = (node: HuffmanTreeNode | null, depth: number) => {
            if (!node) return;
            if (!node.left && !node.right && node.symbol !== null) {
                codeLengths[node.symbol] = Math.max(1, depth);
                return;
            }
            extractDepth(node.left, depth + 1);
            extractDepth(node.right, depth + 1);
        };
        extractDepth(root, 0);

        // Canonical ordering: (bitLength ASC, symbol ASC)
        const sortedSyms = Object.keys(codeLengths).sort((a, b) => {
            const d = codeLengths[a] - codeLengths[b];
            return d !== 0 ? d : a.localeCompare(b);
        });

        const canonicalCodes: Record<string, string> = {};
        let codeVal = 0;
        let prevLen = codeLengths[sortedSyms[0]];

        for (let i = 0; i < sortedSyms.length; i++) {
            const sym = sortedSyms[i];
            const curLen = codeLengths[sym];
            if (i > 0) {
                codeVal = (codeVal + 1) << (curLen - prevLen);
            }
            canonicalCodes[sym] = codeVal.toString(2).padStart(curLen, '0');
            prevLen = curLen;
        }

        // Pack bitstream into bytes
        const bitChunks: string[] = [];
        for (let i = 0; i < input.length; i++) {
            bitChunks.push(canonicalCodes[input[i]]);
        }
        const bitString = bitChunks.join('');
        const byteLen = Math.ceil(bitString.length / 8);
        const byteBuffer = Buffer.alloc(byteLen);

        for (let i = 0; i < bitString.length; i++) {
            if (bitString[i] === '1') {
                byteBuffer[i >> 3] |= 1 << (7 - (i & 7));
            }
        }

        const n = input.length;
        let entropy = 0;
        let avgLen = 0;
        for (const sym of symbols) {
            const p = freq[sym] / n;
            entropy += -p * Math.log2(p);
            avgLen += p * codeLengths[sym];
        }

        const originalBytes = Buffer.byteLength(input, 'utf8');
        const compressedBytes = byteBuffer.length;
        const savingsPercent = originalBytes > 0
            ? Number((((originalBytes - compressedBytes) / originalBytes) * 100).toFixed(2))
            : 0;

        return {
            originalLength: input.length,
            originalBytes,
            compressedBytes,
            savingsPercent: Math.max(0, savingsPercent),
            shannonEntropy: Number(entropy.toFixed(4)),
            averageCodeLength: Number(avgLen.toFixed(4)),
            shannonVerified: avgLen + 1e-9 >= entropy && avgLen < entropy + 1.0,
            distinctSymbols: symbols.length,
            codeLengths,
            packedBase64: byteBuffer.toString('base64')
        };
    }

    /**
     * Lossless Canonical Huffman Decoder in O(N * L_bar) bit-steps.
     * Reconstructs the prefix decode trie solely from `codeLengths`.
     */
    static decompressTranscriptJson(
        packedBase64: string,
        codeLengths: Record<string, number>,
        originalLength: number
    ): string {
        if (!packedBase64 || originalLength <= 0) return '';
        const canonicalCodes = this.buildCanonicalCodes(codeLengths);

        interface DecodeNode {
            symbol: string | null;
            left: DecodeNode | null;
            right: DecodeNode | null;
        }
        const root: DecodeNode = { symbol: null, left: null, right: null };
        for (const [sym, bits] of Object.entries(canonicalCodes)) {
            let node = root;
            for (let i = 0; i < bits.length; i++) {
                if (bits[i] === '0') {
                    if (!node.left) node.left = { symbol: null, left: null, right: null };
                    node = node.left;
                } else {
                    if (!node.right) node.right = { symbol: null, left: null, right: null };
                    node = node.right;
                }
            }
            node.symbol = sym;
        }

        const buf = Buffer.from(packedBase64, 'base64');
        const out: string[] = [];
        let node = root;
        for (let byteIdx = 0; byteIdx < buf.length && out.length < originalLength; byteIdx++) {
            const byteVal = buf[byteIdx];
            for (let bit = 7; bit >= 0 && out.length < originalLength; bit--) {
                const isOne = (byteVal & (1 << bit)) !== 0;
                node = (isOne ? node.right : node.left) as DecodeNode;
                if (!node) {
                    throw new Error('Corrupted Canonical Huffman bitstream');
                }
                if (node.symbol !== null) {
                    out.push(node.symbol);
                    node = root;
                }
            }
        }
        return out.join('');
    }

    /**
     * Production Archive Pipeline: Canonical Huffman Compress -> AES-256-GCM Encrypt.
     * Ensures archived room transcripts are both storage-compact and unreadable at rest.
     */
    static sealEncryptedHuffmanArchive(rawJson: string, secret?: string): EncryptedHuffmanArchive {
        const compressed = this.compressTranscriptJson(rawJson);
        const key = this.deriveKey(secret);
        const iv = randomBytes(12); // 96-bit NIST-recommended GCM IV
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const rawPacked = Buffer.from(compressed.packedBase64, 'base64');
        const encrypted = Buffer.concat([cipher.update(rawPacked), cipher.final()]);
        const authTag = cipher.getAuthTag();

        return {
            algorithm: 'canonical-huffman+aes-256-gcm',
            originalLength: compressed.originalLength,
            originalBytes: compressed.originalBytes,
            compressedBytes: compressed.compressedBytes,
            savingsPercent: compressed.savingsPercent,
            shannonEntropy: compressed.shannonEntropy,
            averageCodeLength: compressed.averageCodeLength,
            shannonVerified: compressed.shannonVerified,
            distinctSymbols: compressed.distinctSymbols,
            codeLengths: compressed.codeLengths,
            ivBase64: iv.toString('base64'),
            authTagBase64: authTag.toString('base64'),
            ciphertextBase64: encrypted.toString('base64')
        };
    }

    /**
     * Moderation / Report Inspection Pipeline: AES-256-GCM Decrypt -> Canonical Huffman Decompress.
     * Only invoked when an abuse report requires inspecting a specific room_id.
     */
    static openEncryptedHuffmanArchive(archive: EncryptedHuffmanArchive, secret?: string): string {
        const key = this.deriveKey(secret);
        const iv = Buffer.from(archive.ivBase64, 'base64');
        const authTag = Buffer.from(archive.authTagBase64, 'base64');
        const ciphertext = Buffer.from(archive.ciphertextBase64, 'base64');

        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        const decryptedPacked = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

        return this.decompressTranscriptJson(
            decryptedPacked.toString('base64'),
            archive.codeLengths,
            archive.originalLength
        );
    }

    /**
     * Reconstructs a visualization-ready Canonical Huffman Binary Tree JSON
     * for the React Admin Panel, annotated with bit paths, codes, and symbol frequencies.
     */
    static buildVisualHuffmanTree(
        codeLengths: Record<string, number>,
        rawTextForFreq?: string
    ): {
        tree: VisualHuffmanTreeNode;
        canonicalCodes: Record<string, string>;
        symbolFrequencies: Record<string, number>;
    } {
        const canonicalCodes = this.buildCanonicalCodes(codeLengths);
        const symbolFrequencies: Record<string, number> = {};
        if (rawTextForFreq) {
            for (let i = 0; i < rawTextForFreq.length; i++) {
                const ch = rawTextForFreq[i];
                symbolFrequencies[ch] = (symbolFrequencies[ch] || 0) + 1;
            }
        }

        const root: VisualHuffmanTreeNode = {
            id: 'root',
            symbol: null,
            bit: null,
            code: '',
            depth: 0,
            frequency: 0,
            left: null,
            right: null
        };

        for (const [sym, bits] of Object.entries(canonicalCodes)) {
            let cur = root;
            const freq = symbolFrequencies[sym] || 1;
            cur.frequency += freq;
            for (let i = 0; i < bits.length; i++) {
                const b = bits[i] as '0' | '1';
                const prefix = bits.slice(0, i + 1);
                if (b === '0') {
                    if (!cur.left) {
                        cur.left = {
                            id: `n_${prefix}`,
                            symbol: null,
                            bit: '0',
                            code: prefix,
                            depth: i + 1,
                            frequency: 0,
                            left: null,
                            right: null
                        };
                    }
                    cur = cur.left;
                } else {
                    if (!cur.right) {
                        cur.right = {
                            id: `n_${prefix}`,
                            symbol: null,
                            bit: '1',
                            code: prefix,
                            depth: i + 1,
                            frequency: 0,
                            left: null,
                            right: null
                        };
                    }
                    cur = cur.right;
                }
                cur.frequency += freq;
            }
            cur.symbol = sym;
        }

        return { tree: root, canonicalCodes, symbolFrequencies };
    }
}
