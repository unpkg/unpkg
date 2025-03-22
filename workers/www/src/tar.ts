const BLOCK_SIZE = 512;

const MAGIC = {
  USTAR: "ustar\0",
  GNU: "ustar ",
};

export const EntryType = {
  FILE: 0,
  LINK: 1,
  SYMLINK: 2,
  CHAR: 3,
  BLOCK: 4,
  DIRECTORY: 5,
  FIFO: 6,
  CONTIGUOUS: 7,
  EXTENDED_HEADER: "x",
  GLOBAL_EXTENDED_HEADER: "g",
  LONG_NAME: "L",
  LONG_LINK: "K",
} as const;

export type EntryType = (typeof EntryType)[keyof typeof EntryType];

export interface TarEntry {
  type: EntryType;
  name: string;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  mtime: number;
  linkname?: string;
  uname?: string;
  gname?: string;
  devmajor?: number;
  devminor?: number;
  atime?: number;
  ctime?: number;
  content: Uint8Array;
}

interface TarHeader {
  name: string;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  mtime: number;
  typeFlag: number | string;
  linkname: string;
  magic: string;
  version: string;
  uname: string;
  gname: string;
  devmajor: number;
  devminor: number;
  prefix: string;
}

function extractString(buffer: Uint8Array, offset: number, size: number): string {
  let end = offset;
  while (end < offset + size && buffer[end] !== 0) {
    end++;
  }

  return new TextDecoder().decode(buffer.slice(offset, end));
}

function parseOctal(str: string): number {
  let trimmed = str.trim();
  if (!trimmed) {
    return 0;
  }

  // Handle GNU tar base-256 encoding
  if (trimmed[0] === "\x80" || trimmed[0] === "\x00") {
    let value = 0;
    for (let i = 1; i < trimmed.length; i++) {
      value = (value << 8) + (trimmed.charCodeAt(i) & 0xff);
    }
    return value;
  }

  return parseInt(trimmed, 8);
}

function calculateChecksum(header: Uint8Array): number {
  let sum = 0;

  for (let i = 0; i < BLOCK_SIZE; i++) {
    // Checksum field is treated as if it were filled with spaces
    if (i >= 148 && i < 156) {
      sum += 32; // ASCII for space
    } else {
      sum += header[i];
    }
  }

  return sum;
}

function verifyChecksum(header: Uint8Array): boolean {
  let checksumStr = extractString(header, 148, 8);
  let expectedSum = parseOctal(checksumStr);
  let actualSum = calculateChecksum(header);

  return expectedSum === actualSum;
}

function isEmptyBlock(block: Uint8Array): boolean {
  // Optimized empty block check
  const dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const len = block.length >> 2; // Divide by 4 to get number of 32-bit integers

  for (let i = 0; i < len; i++) {
    if (dv.getUint32(i * 4) !== 0) {
      return false;
    }
  }

  // Check remaining bytes
  for (let i = len * 4; i < block.length; i++) {
    if (block[i] !== 0) {
      return false;
    }
  }

  return true;
}

function parseHeader(headerBuffer: Uint8Array, strict: boolean): TarHeader | null {
  // Check if it's an empty (all zeros) block
  if (isEmptyBlock(headerBuffer)) {
    return null; // End of archive marker
  }

  // First verify checksum before further processing
  if (strict && !verifyChecksum(headerBuffer)) {
    throw new Error("Invalid checksum in tar header");
  }

  let name = extractString(headerBuffer, 0, 100);
  let mode = parseOctal(extractString(headerBuffer, 100, 8));
  let uid = parseOctal(extractString(headerBuffer, 108, 8));
  let gid = parseOctal(extractString(headerBuffer, 116, 8));
  let size = parseOctal(extractString(headerBuffer, 124, 12));
  let mtime = parseOctal(extractString(headerBuffer, 136, 12));
  let typeFlag = extractString(headerBuffer, 156, 1);
  let linkname = extractString(headerBuffer, 157, 100);
  let magic = extractString(headerBuffer, 257, 6);
  let version = extractString(headerBuffer, 263, 2);
  let uname = extractString(headerBuffer, 265, 32);
  let gname = extractString(headerBuffer, 297, 32);
  let devmajor = parseOctal(extractString(headerBuffer, 329, 8));
  let devminor = parseOctal(extractString(headerBuffer, 337, 8));
  let prefix = extractString(headerBuffer, 345, 155);

  // Validate magic number
  if (strict && magic !== MAGIC.USTAR && magic !== MAGIC.GNU) {
    throw new Error(`Invalid tar format: incorrect magic number "${magic}"`);
  }

  // Directory detection fallback (common in some tar implementations)
  if (typeFlag === "" || typeFlag === "0") {
    if (name.endsWith("/")) {
      typeFlag = "5"; // Directory
    } else {
      typeFlag = "0"; // Regular file
    }
  }

  return {
    name,
    mode,
    uid,
    gid,
    size,
    mtime,
    typeFlag: typeFlag === "" ? "0" : typeFlag,
    linkname,
    magic,
    version,
    uname,
    gname,
    devmajor,
    devminor,
    prefix,
  };
}

function normalizeFilename(header: TarHeader): string {
  let name = header.name;

  if (header.prefix && (header.magic === MAGIC.USTAR || header.magic === MAGIC.GNU)) {
    name = header.prefix + "/" + name;
  }

  name = name.replace(/\\/g, "/");
  name = name.replace(/\/+/g, "/");
  name = name.replace(/^[A-Z]:[\/\\]+/i, "");
  name = name.replace(/^\/+/, "");

  return name;
}

export interface TarParserOptions {
  strict?: boolean;
  maxHeaderSize?: number;
  ignoreExtended?: boolean;
}

export class TarParser {
  #buffer: Uint8Array;
  #options: Required<TarParserOptions>;
  #longName: string | null;
  #longLink: string | null;
  #globalExtendedHeaders: Record<string, string>;
  #extendedHeaders: Record<string, string>;
  #endOfArchive: boolean;

  constructor(options?: TarParserOptions) {
    this.#buffer = new Uint8Array(0);
    this.#options = {
      strict: options?.strict ?? false,
      maxHeaderSize: options?.maxHeaderSize ?? 1024 * 1024,
      ignoreExtended: options?.ignoreExtended ?? false,
    };
    this.#longName = null;
    this.#longLink = null;
    this.#globalExtendedHeaders = {};
    this.#extendedHeaders = {};
    this.#endOfArchive = false;
  }

  write(chunk: Uint8Array): TarEntry[] {
    // If we've already seen the end of archive marker, don't process any more data
    if (this.#endOfArchive) {
      return [];
    }

    let newBuffer = new Uint8Array(this.#buffer.length + chunk.length);
    newBuffer.set(this.#buffer);
    newBuffer.set(chunk, this.#buffer.length);
    this.#buffer = newBuffer;

    let entries: TarEntry[] = [];

    while (this.#buffer.length >= BLOCK_SIZE) {
      let headerBuf = this.#buffer.slice(0, BLOCK_SIZE);

      // Handle empty blocks - potential end of archive markers
      if (isEmptyBlock(headerBuf)) {
        this.#buffer = this.#buffer.slice(BLOCK_SIZE);

        // Check for a second empty block (official end of archive)
        if (this.#buffer.length >= BLOCK_SIZE) {
          let nextBlock = this.#buffer.slice(0, BLOCK_SIZE);

          if (isEmptyBlock(nextBlock)) {
            // Found two consecutive empty blocks - end of archive
            this.#buffer = this.#buffer.slice(BLOCK_SIZE);
            this.#endOfArchive = true;
            break;
          }
        }

        continue;
      }

      let header;
      try {
        header = parseHeader(headerBuf, this.#options.strict);
      } catch (err) {
        if (this.#options.strict) {
          throw err;
        } else {
          console.warn(`Tar parsing error: ${(err as Error).message}`);
          // Skip this block and try to continue
          this.#buffer = this.#buffer.slice(BLOCK_SIZE);
          continue;
        }
      }

      // If header is null, it was an empty block
      if (header === null) {
        continue;
      }

      let contentSize = header.size;
      let paddedSize = Math.ceil(contentSize / BLOCK_SIZE) * BLOCK_SIZE;
      let totalSize = BLOCK_SIZE + paddedSize;

      // Don't have enough data yet
      if (this.#buffer.length < totalSize) {
        break;
      }

      let contentBuf = this.#buffer.slice(BLOCK_SIZE, BLOCK_SIZE + contentSize);
      let typeFlag = header.typeFlag.toString();

      if (typeFlag === EntryType.LONG_NAME) {
        this.#longName = new TextDecoder().decode(contentBuf).replace(/\0+$/, "");
        this.#buffer = this.#buffer.slice(totalSize);
        continue;
      } else if (typeFlag === EntryType.LONG_LINK) {
        this.#longLink = new TextDecoder().decode(contentBuf).replace(/\0+$/, "");
        this.#buffer = this.#buffer.slice(totalSize);
        continue;
      } else if (typeFlag === EntryType.GLOBAL_EXTENDED_HEADER && !this.#options.ignoreExtended) {
        this.#processExtendedHeader(contentBuf, this.#globalExtendedHeaders);
        this.#buffer = this.#buffer.slice(totalSize);
        continue;
      } else if (typeFlag === EntryType.EXTENDED_HEADER && !this.#options.ignoreExtended) {
        this.#extendedHeaders = {};
        this.#processExtendedHeader(contentBuf, this.#extendedHeaders);
        this.#buffer = this.#buffer.slice(totalSize);
        continue;
      }

      let entry = this.#createEntry(header, contentBuf);
      entries.push(entry);

      this.#extendedHeaders = {};
      this.#buffer = this.#buffer.slice(totalSize);
    }

    return entries;
  }

  end(): void {
    if (this.#buffer.length > 0 && !this.#endOfArchive) {
      throw new Error("Incomplete tar data");
    }
  }

  #processExtendedHeader(buffer: Uint8Array, target: Record<string, string>): void {
    let content = new TextDecoder().decode(buffer);
    let pos = 0;

    while (pos < content.length) {
      let spacePos = content.indexOf(" ", pos);
      if (spacePos === -1) break;

      let length: number;
      try {
        length = parseInt(content.substring(pos, spacePos), 10);
      } catch (e) {
        break;
      }

      if (isNaN(length) || length <= 0) break;

      let data = content.substring(spacePos + 1, pos + length - 1);
      let equalsPos = data.indexOf("=");

      if (equalsPos !== -1) {
        let key = data.substring(0, equalsPos);
        let value = data.substring(equalsPos + 1);
        target[key] = value;
      }

      pos += length;
    }
  }

  #createEntry(header: TarHeader, content: Uint8Array): TarEntry {
    let name = this.#longName !== null ? this.#longName : normalizeFilename(header);
    this.#longName = null;

    let linkname = this.#longLink !== null ? this.#longLink : header.linkname;
    this.#longLink = null;

    let typeNum = parseInt(header.typeFlag.toString(), 10);
    let type: EntryType;

    if (!isNaN(typeNum) && typeNum >= 0 && typeNum <= 7) {
      type = typeNum as EntryType;
    } else {
      switch (header.typeFlag.toString()) {
        case "x":
          type = EntryType.EXTENDED_HEADER;
          break;
        case "g":
          type = EntryType.GLOBAL_EXTENDED_HEADER;
          break;
        case "L":
          type = EntryType.LONG_NAME;
          break;
        case "K":
          type = EntryType.LONG_LINK;
          break;
        default:
          type = EntryType.FILE;
      }
    }

    let mtime = header.mtime;
    let atime: number | undefined;
    let ctime: number | undefined;

    if (this.#extendedHeaders["mtime"]) {
      mtime = parseFloat(this.#extendedHeaders["mtime"]);
    } else if (this.#globalExtendedHeaders["mtime"]) {
      mtime = parseFloat(this.#globalExtendedHeaders["mtime"]);
    }

    if (this.#extendedHeaders["atime"]) {
      atime = parseFloat(this.#extendedHeaders["atime"]);
    } else if (this.#globalExtendedHeaders["atime"]) {
      atime = parseFloat(this.#globalExtendedHeaders["atime"]);
    }

    if (this.#extendedHeaders["ctime"]) {
      ctime = parseFloat(this.#extendedHeaders["ctime"]);
    } else if (this.#globalExtendedHeaders["ctime"]) {
      ctime = parseFloat(this.#globalExtendedHeaders["ctime"]);
    }

    if (this.#extendedHeaders["path"]) {
      name = this.#extendedHeaders["path"];
    } else if (this.#globalExtendedHeaders["path"]) {
      name = this.#globalExtendedHeaders["path"];
    }

    if (this.#extendedHeaders["linkpath"]) {
      linkname = this.#extendedHeaders["linkpath"];
    } else if (this.#globalExtendedHeaders["linkpath"]) {
      linkname = this.#globalExtendedHeaders["linkpath"];
    }

    let entry: TarEntry = {
      type,
      name,
      mode: header.mode,
      uid: header.uid,
      gid: header.gid,
      size: header.size,
      mtime: mtime,
      content,
    };

    if (linkname) entry.linkname = linkname;
    if (header.uname) entry.uname = header.uname;
    if (header.gname) entry.gname = header.gname;
    if (header.devmajor !== undefined) entry.devmajor = header.devmajor;
    if (header.devminor !== undefined) entry.devminor = header.devminor;
    if (atime !== undefined) entry.atime = atime;
    if (ctime !== undefined) entry.ctime = ctime;

    return entry;
  }
}

export async function* parseTarStream(
  stream: ReadableStream<Uint8Array>,
  options?: TarParserOptions,
): AsyncGenerator<TarEntry, void, unknown> {
  let parser = new TarParser(options);
  let reader = stream.getReader();

  try {
    while (true) {
      let result = await reader.read();

      if (result.done) {
        parser.end();
        break;
      }

      let entries = parser.write(result.value);
      for (let entry of entries) {
        yield entry;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
