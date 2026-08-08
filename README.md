# PiR2 Academy — Instagram Publisher

MCP แบบ local สำหรับคลาส Advanced Claude Cowork ใช้เตรียม preview และโพสต์ภาพหนึ่งภาพไป Instagram หลังผู้เรียนยืนยันอย่างชัดเจน

## Safety contract

- รองรับ JPEG/PNG หนึ่งภาพต่อ post ใน core workshop
- ต้องสร้าง preview ก่อนทุกครั้ง
- โพสต์ได้เมื่อผู้เรียนตอบ `ยืนยันโพสต์` หรือ `Confirm post` เท่านั้น
- token อยู่ใน credential vault ของ macOS/Windows และไม่อยู่ในไฟล์ MCPB
- Meta App Secret อยู่ที่ OAuth Broker เท่านั้น
- retry จะไม่สร้าง post ซ้ำโดยอัตโนมัติ

## Development

Requires Node.js 20 or newer.

```bash
npm ci
npm run check
```

Built for PiR2 Academy — Advanced Claude Cowork.
