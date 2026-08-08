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

## Learner flow

1. ติดตั้งไฟล์ `.mcpb` ใน Claude Desktop
2. ใช้ `connect_instagram` เพื่อ OAuth กับ Instagram Professional account ของตัวเอง
3. ให้ Canva official MCP export ภาพ JPEG/PNG หนึ่งภาพแบบ standard quality
4. ใช้ `prepare_instagram_post` เพื่อดู account, ภาพ และ caption ใน preview
5. ตรวจให้เรียบร้อย แล้วตอบ `ยืนยันโพสต์` หรือ `Confirm post`
6. `publish_instagram_post` จะโพสต์ intent นั้นได้เพียงครั้งเดียวและคืน Media ID

Tools ที่ติดตั้ง:

- `instagram_auth_status`
- `connect_instagram`
- `prepare_instagram_post`
- `publish_instagram_post`

## Supported core lab

- Instagram Professional account (Business หรือ Creator)
- JPEG/PNG หนึ่งภาพ ขนาดไม่เกิน 8 MB
- caption ไม่เกิน 2,200 ตัวอักษร
- macOS ARM64/Intel และ Windows ARM64/x64

ไม่รวม carousel, video, Reel, Story, schedule, analytics และ comments ใน core lab
ไฟล์ export ต้องเป็น HTTPS URL ที่ Meta เข้าถึงได้และยังไม่หมดอายุ
Publisher ตรวจ signed Canva export ด้วย ranged `GET` เพราะ URL ของ Canva ผูกกับ HTTP method และใช้ `HEAD` แทนไม่ได้

OAuth ใช้ PiR2 Academy broker ที่ `https://meta-oauth.zie-agent.cloud/instagram` เพื่อเก็บ Meta App Secret ไว้ฝั่ง server; access token ของผู้เรียนถูกส่งกลับแบบ PKCE-bound และเก็บใน credential vault ของเครื่องเท่านั้น

Built for PiR2 Academy — Advanced Claude Cowork.
