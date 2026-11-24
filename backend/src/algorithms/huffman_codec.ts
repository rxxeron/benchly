/**
 * CSE246 Lab 4 / Lecture 9: Canonical Huffman Coding + AES-256-GCM Archive Engine
 * Compresses concluded 30-min / 100-message room transcripts in Redis via a custom
 * BinaryMinHeap and Canonical Prefix Codebook, then seals the compressed bitstream
 * with AES-256-GCM before persisting a single row into public.room_conversations.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Symbol order used to break ties between equal-length canonical codes.
 * - 'codepoint': plain UTF-16 code-unit comparison. Locale-independent and never returns 0
 *   for distinct strings, so the codebook is identical no matter how codeLengths keys are
 *   reordered (e.g. by PostgreSQL JSONB).
 * - 'legacy-locale': String.localeCompare, used by archives written before symbolOrder existed.
 *   It treats some distinct symbols (control chars, U+00AD, U+200D, U+FE0F) as equal, so it is
 *   kept only to decode old rows.
 */
export type CanonicalSymbolOrder = 'codepoint' | 'legacy-locale';

function compareCodePoints(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

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
        return compareCodePoints(a.symbol || '', b.symbol || '');
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
    /** Exact unpadded bit count before byte alignment. */
    bitLength?: number;
    /** Packed Huffman bitstream only. */
    compressedBytes: number;
    /** Size of the codebook (JSON of codeLengths) that must be stored to decode. */
    codebookBytes: number;
    /** Net saving: (original - (bitstream + codebook)) / original. Negative when Huffman does not pay. */
    savingsPercent: number;
    /** Bitstream-only saving (ignores the codebook); shown for comparison. */
    payloadSavingsPercent: number;
    shannonEntropy: number;
    averageCodeLength: number;
    shannonVerified: boolean;
    distinctSymbols: number;
    codeLengths: Record<string, number>;
    symbolOrder: CanonicalSymbolOrder;
    packedBase64: string;
}

export interface HuffmanWirePacket {
    algorithm: 'canonical-huffman';
    packedBase64: string;
    codeLengths: Record<string, number>;
    originalLength: number;
    bitLength: number;
    originalBytes: number;
    compressedBytes: number;
    codebookBytes: number;
    shannonEntropy: number;
    averageCodeLength: number;
    shannonVerified: boolean;
    distinctSymbols: number;
    symbolOrder: 'codepoint';
}

export interface EncryptedHuffmanArchive {
    algorithm: 'canonical-huffman+aes-256-gcm';
    /**
     * 'huffman': ciphertext holds the packed bitstream. 'raw': Huffman would not have saved space
     * (short chats, where the codebook outweighs the gain), so ciphertext holds UTF-8 JSON.
     * Absent on older archives, which are always 'huffman'.
     */
    encoding?: 'huffman' | 'raw';
    originalLength: number;
    originalBytes: number;
    compressedBytes: number;
    codebookBytes?: number;
    /** Net saving including the codebook; 0 for 'raw'. Older archives stored the bitstream-only figure. */
    savingsPercent: number;
    payloadSavingsPercent?: number;
    shannonEntropy: number;
    averageCodeLength: number;
    shannonVerified: boolean;
    distinctSymbols: number;
    codeLengths: Record<string, number>;
    /** Absent on archives written before this field existed; those decode with 'legacy-locale'. */
    symbolOrder?: CanonicalSymbolOrder;
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
    private static warnedAboutKey = false;

    private static deriveKey(secret?: string): Buffer {
        if (!secret && !process.env.ARCHIVE_MASTER_KEY && !this.warnedAboutKey) {
            this.warnedAboutKey = true;
            // Do not change the fallback order: existing archives were sealed with it.
            console.warn(
                '⚠️ ARCHIVE_MASTER_KEY is not set; transcript archives fall back to ' +
                    (process.env.SUPABASE_SERVICE_KEY ? 'SUPABASE_SERVICE_KEY' : 'a hard-coded dev key') +
                    '. Rotating that value would make existing archives undecryptable.'
            );
        }
        const raw = secret || process.env.ARCHIVE_MASTER_KEY || process.env.SUPABASE_SERVICE_KEY || 'benchly-ephemeral-dev-key';
        return createHash('sha256').update(raw, 'utf8').digest();
    }

    /**
     * Deterministically rebuilds canonical prefix codes from (symbol -> bitLength)
     * using the exact (bitLength ASC, symbol ASC) order.
     */
    static buildCanonicalCodes(
        codeLengths: Record<string, number>,
        symbolOrder: CanonicalSymbolOrder = 'codepoint'
    ): Record<string, string> {
        const tieBreak = symbolOrder === 'legacy-locale'
            ? (a: string, b: string) => a.localeCompare(b)
            : compareCodePoints;
        const sortedSyms = Object.keys(codeLengths).sort((a, b) => {
            const d = codeLengths[a] - codeLengths[b];
            return d !== 0 ? d : tieBreak(a, b);
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
        const input = (rawJson || '[]').replace(/\u0000/g, '');
        // Iterate by full Unicode code points (prevents splitting emoji UTF-16 surrogate pairs
        // into lone surrogates that PostgreSQL JSONB rejects as invalid JSON).
        const chars = Array.from(input);
        const freq: Record<string, number> = {};
        for (const ch of chars) {
            freq[ch] = (freq[ch] || 0) + 1;
        }

        const symbols = Object.keys(freq);
        if (symbols.length === 0) {
            return {
                originalLength: 0,
                originalBytes: 0,
                compressedBytes: 0,
                codebookBytes: 0,
                savingsPercent: 0,
                payloadSavingsPercent: 0,
                shannonEntropy: 0,
                averageCodeLength: 0,
                shannonVerified: true,
                distinctSymbols: 0,
                codeLengths: {},
                symbolOrder: 'codepoint',
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

        // Canonical ordering: (bitLength ASC, symbol ASC by code point)
        const canonicalCodes = this.buildCanonicalCodes(codeLengths, 'codepoint');

        // Pack bitstream into bytes
        const bitChunks: string[] = [];
        for (const ch of chars) {
            bitChunks.push(canonicalCodes[ch]);
        }
        const bitString = bitChunks.join('');
        const byteLen = Math.ceil(bitString.length / 8);
        const byteBuffer = Buffer.alloc(byteLen);

        for (let i = 0; i < bitString.length; i++) {
            if (bitString[i] === '1') {
                byteBuffer[i >> 3] |= 1 << (7 - (i & 7));
            }
        }

        const n = chars.length;
        let entropy = 0;
        let avgLen = 0;
        for (const sym of symbols) {
            const p = freq[sym] / n;
            entropy += -p * Math.log2(p);
            avgLen += p * codeLengths[sym];
        }

        const originalBytes = Buffer.byteLength(input, 'utf8');
        const compressedBytes = byteBuffer.length;
        const codebookBytes = Buffer.byteLength(JSON.stringify(codeLengths), 'utf8');
        const pct = (saved: number) =>
            originalBytes > 0 ? Number(((saved / originalBytes) * 100).toFixed(2)) : 0;
        const savingsPercent = pct(originalBytes - compressedBytes - codebookBytes);
        const payloadSavingsPercent = pct(originalBytes - compressedBytes);

        return {
            originalLength: chars.length,
            originalBytes,
            bitLength: bitString.length,
            compressedBytes,
            codebookBytes,
            savingsPercent,
            payloadSavingsPercent,
            shannonEntropy: Number(entropy.toFixed(4)),
            averageCodeLength: Number(avgLen.toFixed(4)),
            shannonVerified:
                avgLen + 1e-9 >= entropy &&
                (symbols.length <= 1 ? avgLen <= entropy + 1.0 + 1e-9 : avgLen < entropy + 1.0),
            distinctSymbols: symbols.length,
            codeLengths,
            symbolOrder: 'codepoint',
            packedBase64: byteBuffer.toString('base64')
        };
    }

    /**
     * Encodes a single live chat message into a Canonical Huffman wire packet
     * (packed bitstream + `codeLengths` tree specification, zero plaintext).
     */
    static encodeLiveMessage(rawMessage: string): HuffmanWirePacket {
        const cleaned = (rawMessage ?? '').replace(/\u0000/g, '');
        if (cleaned.length === 0) {
            return {
                algorithm: 'canonical-huffman',
                packedBase64: '',
                codeLengths: {},
                originalLength: 0,
                bitLength: 0,
                originalBytes: 0,
                compressedBytes: 0,
                codebookBytes: 2,
                shannonEntropy: 0,
                averageCodeLength: 0,
                shannonVerified: true,
                distinctSymbols: 0,
                symbolOrder: 'codepoint'
            };
        }
        const meta = this.compressTranscriptJson(cleaned);
        return {
            algorithm: 'canonical-huffman',
            packedBase64: meta.packedBase64,
            codeLengths: meta.codeLengths,
            originalLength: meta.originalLength,
            bitLength: meta.bitLength ?? meta.compressedBytes * 8,
            originalBytes: meta.originalBytes,
            compressedBytes: meta.compressedBytes,
            codebookBytes: meta.codebookBytes,
            shannonEntropy: meta.shannonEntropy,
            averageCodeLength: meta.averageCodeLength,
            shannonVerified: meta.shannonVerified,
            distinctSymbols: meta.distinctSymbols,
            symbolOrder: 'codepoint'
        };
    }

    /**
     * Safely validates and decodes an untrusted Canonical Huffman wire packet from a client socket.
     * Guards against oversized lengths, invalid bit-depths, and malformed bitstreams.
     */
    static decodeLiveMessage(rawPacket: any, maxSymbols = 600): string {
        if (!rawPacket || typeof rawPacket !== 'object') {
            throw new Error('Invalid Huffman packet');
        }
        const packedBase64 = typeof rawPacket.packedBase64 === 'string' ? rawPacket.packedBase64 : '';
        const origLen = Number(rawPacket.originalLength);
        const rawLengths = rawPacket.codeLengths;
        if (!Number.isInteger(origLen) || origLen < 0 || origLen > maxSymbols) {
            throw new Error('Invalid Huffman originalLength');
        }
        if (origLen === 0) return '';
        if (!packedBase64 || packedBase64.length > maxSymbols * 8 || !rawLengths || typeof rawLengths !== 'object') {
            throw new Error('Invalid Huffman payload');
        }
        const keys = Object.keys(rawLengths);
        if (keys.length === 0 || keys.length > maxSymbols) {
            throw new Error('Invalid Huffman codebook size');
        }
        const safeLengths: Record<string, number> = {};
        for (const k of keys) {
            const symChars = Array.from(k);
            const len = Number(rawLengths[k]);
            if (symChars.length !== 1 || !Number.isInteger(len) || len < 1 || len > 30) {
                throw new Error('Invalid Huffman symbol or bit length');
            }
            safeLengths[k] = len;
        }
        const order: CanonicalSymbolOrder = rawPacket.symbolOrder === 'legacy-locale' ? 'legacy-locale' : 'codepoint';
        return this.decompressTranscriptJson(packedBase64, safeLengths, origLen, order);
    }

    /**
     * Lossless Canonical Huffman Decoder in O(N * L_bar) bit-steps.
     * Reconstructs the prefix decode trie solely from `codeLengths`.
     */
    static decompressTranscriptJson(
        packedBase64: string,
        codeLengths: Record<string, number>,
        originalLength: number,
        symbolOrder: CanonicalSymbolOrder = 'codepoint'
    ): string {
        if (!packedBase64 || originalLength <= 0) return '';
        const canonicalCodes = this.buildCanonicalCodes(codeLengths, symbolOrder);

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
        if (out.length !== originalLength) {
            throw new Error('Truncated Canonical Huffman bitstream');
        }
        return out.join('');
    }

    /**
     * Production Archive Pipeline: Canonical Huffman Compress -> AES-256-GCM Encrypt.
     * Ensures archived room transcripts are both storage-compact and unreadable at rest.
     */
    static sealEncryptedHuffmanArchive(rawJson: string, secret?: string): EncryptedHuffmanArchive {
        const compressed = this.compressTranscriptJson(rawJson);
        // Store raw when bitstream + codebook would be no smaller than the original.
        const useHuffman = compressed.savingsPercent > 0;
        const key = this.deriveKey(secret);
        const iv = randomBytes(12); // 96-bit NIST-recommended GCM IV
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const plain = useHuffman
            ? Buffer.from(compressed.packedBase64, 'base64')
            : Buffer.from((rawJson || '[]').replace(/\u0000/g, ''), 'utf8');
        const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
        const authTag = cipher.getAuthTag();

        return {
            algorithm: 'canonical-huffman+aes-256-gcm',
            encoding: useHuffman ? 'huffman' : 'raw',
            originalLength: compressed.originalLength,
            originalBytes: compressed.originalBytes,
            compressedBytes: useHuffman ? compressed.compressedBytes : compressed.originalBytes,
            codebookBytes: useHuffman ? compressed.codebookBytes : 0,
            savingsPercent: useHuffman ? compressed.savingsPercent : 0,
            payloadSavingsPercent: compressed.payloadSavingsPercent,
            shannonEntropy: compressed.shannonEntropy,
            averageCodeLength: compressed.averageCodeLength,
            shannonVerified: compressed.shannonVerified,
            distinctSymbols: compressed.distinctSymbols,
            codeLengths: compressed.codeLengths,
            symbolOrder: compressed.symbolOrder,
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
        if (archive.encoding === 'raw') return decryptedPacked.toString('utf8');

        return this.decompressTranscriptJson(
            decryptedPacked.toString('base64'),
            archive.codeLengths,
            archive.originalLength,
            archive.symbolOrder ?? 'legacy-locale'
        );
    }

    /**
     * Reconstructs a visualization-ready Canonical Huffman Binary Tree JSON
     * for the React Admin Panel, annotated with bit paths, codes, and symbol frequencies.
     */
    static buildVisualHuffmanTree(
        codeLengths: Record<string, number>,
        rawTextForFreq?: string,
        symbolOrder: CanonicalSymbolOrder = 'codepoint'
    ): {
        tree: VisualHuffmanTreeNode;
        canonicalCodes: Record<string, string>;
        symbolFrequencies: Record<string, number>;
    } {
        const canonicalCodes = this.buildCanonicalCodes(codeLengths, symbolOrder);
        const symbolFrequencies: Record<string, number> = {};
        if (rawTextForFreq) {
            // Count by full code points, matching how compressTranscriptJson splits symbols
            // (indexing by UTF-16 unit would split emoji into lone surrogates).
            for (const ch of rawTextForFreq) {
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
