import zlib, struct, os

ROOT = os.path.dirname(os.path.abspath(__file__))

def decode(path):
    d = open(path, 'rb').read()
    w, h = struct.unpack('>II', d[16:24])
    ct = d[25]
    bpp = 4 if ct == 6 else 3  # Edge 截图无透明通道时输出 RGB(2)
    pos, idat = 8, b''
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos+4])[0]
        typ = d[pos+4:pos+8]
        if typ == b'IDAT':
            idat += d[pos+8:pos+8+ln]
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * bpp + 1
    prev = bytearray(w * bpp)
    rows = []
    for row in range(h):
        f = raw[row * stride]
        line = bytearray(raw[row*stride+1:(row+1)*stride])
        for i in range(len(line)):
            a = line[i-bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i-bpp] if i >= bpp else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if (pa <= pb and pa <= pc) else (b if pb <= pc else c))) & 255
        prev = line
        rows.append(bytes(line))
    return w, h, ct, rows, bpp

def encode(path, w, h, rows):
    raw = b''.join(b'\x00' + r for r in rows)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    open(path, 'wb').write(png)

src = os.path.join(ROOT, 'avatar-960.png')
dst = os.path.join(ROOT, 'avatar-500.png')
w, h, ct, rows, bpp = decode(src)
print('源图:', w, 'x', h, 'ct', ct)

SW = SH = 500
sx, sy = w / SW, h / SH
small = []
for y in range(SH):
    y0 = int(y * sy)
    y1 = max(y0 + 1, int((y + 1) * sy))
    line = bytearray()
    for x in range(SW):
        x0 = int(x * sx)
        x1 = max(x0 + 1, int((x + 1) * sx))
        rs = gs = bs = n = 0
        for yy in range(y0, y1):
            row = rows[yy]
            for xx in range(x0, x1):
                o = xx * bpp
                rs += row[o]
                gs += row[o + 1]
                bs += row[o + 2]
                n += 1
        line += bytes((rs // n, gs // n, bs // n, 255))
    small.append(bytes(line))

encode(dst, SW, SH, small)
w2, h2, ct2, rows2, _ = decode(dst)
print('输出:', w2, 'x', h2, 'ct', ct2, os.path.getsize(dst), 'bytes')
print('背景左上(期望约 253,243,227):', list(rows2[2][8:12]))
mid = rows2[250]
warm = sum(1 for i in range(0, w2 * 4, 4) if mid[i] > 200 and mid[i+1] < 180)
print('中线暖色/主体像素数(有主体则 >0):', warm)
