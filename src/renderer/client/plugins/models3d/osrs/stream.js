// Big-endian reader over cache file bytes, with the same methods as
// RuneLite's InputStream so ported loaders read identically.
export class ByteStream {
  constructor(bytes) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.offset = 0;
  }

  get length() {
    return this.bytes.length;
  }

  setOffset(offset) {
    this.offset = offset;
  }

  getOffset() {
    return this.offset;
  }

  skip(count) {
    this.offset += count;
  }

  remaining() {
    return this.bytes.length - this.offset;
  }

  peek() {
    return this.bytes[this.offset];
  }

  readUnsignedByte() {
    return this.bytes[this.offset++];
  }

  readByte() {
    return (this.bytes[this.offset++] << 24) >> 24;
  }

  readUnsignedShort() {
    const value = (this.bytes[this.offset] << 8) | this.bytes[this.offset + 1];
    this.offset += 2;
    return value;
  }

  readShort() {
    return (this.readUnsignedShort() << 16) >> 16;
  }

  readInt() {
    const b = this.bytes, o = this.offset;
    this.offset += 4;
    return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
  }

  readShortSmart() {
    return this.peek() < 128 ? this.readUnsignedByte() - 64 : this.readUnsignedShort() - 0xc000;
  }

  readUnsignedShortSmart() {
    return this.peek() < 128 ? this.readUnsignedByte() : this.readUnsignedShort() - 0x8000;
  }

  // Zero-terminated Latin-1 string (close enough to the cache's CP1252 for names).
  readString() {
    let text = "";
    for (let ch = this.readUnsignedByte(); ch !== 0; ch = this.readUnsignedByte()) text += String.fromCharCode(ch);
    return text;
  }
}
