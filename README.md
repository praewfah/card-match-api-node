# Card Match API (Node + Express + Prisma)

API สำหรับเกมจับคู่การ์ด ใช้ Node.js, Express และ Prisma เชื่อมต่อ PostgreSQL

## คุณสมบัติ
- สร้างเกมใหม่และรับ token สำหรับสำรับไพ่
- เปิดไพ่ตามตำแหน่งอย่างปลอดภัยด้วย token
- บันทึกคะแนนผู้เล่น และดูคะแนนล่าสุด/อันดับต้นๆ

## ข้อกำหนดเบื้องต้น
- Node.js 20+
- Docker (ถ้าต้องการรันฐานข้อมูลผ่าน Docker)

## การตั้งค่า
1) ติดตั้ง dependencies
```bash
npm ci
```

2) คัดลอกไฟล์ตัวอย่าง env แล้วปรับค่าให้เหมาะสม
```bash
cp .env.example .env
```

## รันฐานข้อมูล (PostgreSQL)
ใช้ Docker Compose เพื่อสร้างฐานข้อมูลชื่อ `carddb`
```bash
docker compose up -d carddb
```

- ค่าเริ่มต้น: `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=postgres`, `POSTGRES_DB=cardmatch`
- สามารถปรับค่าผ่านไฟล์ `.env` ได้

## Prisma (สคีมา/ไมเกรชัน)
สร้างตารางและ generate client
```bash
npx prisma migrate dev --name init
npx prisma generate
```

## รันแอป (โหมดพัฒนา/เครื่องท้องถิ่น)
```bash
npm start
```
- ถ้า port 8000 ถูกใช้งาน ให้กำหนดพอร์ตเอง เช่น
```bash
PORT=8001 npm start
```

## รันผ่าน Docker (ตัวแอป)
สร้างอิมเมจและรันคอนเทนเนอร์ โดยแมปพอร์ต host:container เป็น 8001:8000 (กรณี 8000 ว่าง ใช้ 8000:8000 ได้)
```bash
docker build -t card-match-api .
docker run --rm -p 8001:8000 --env-file .env card-match-api
```
หมายเหตุ: ตัวแอปในคอนเทนเนอร์ฟังพอร์ต 8000 เสมอ เปลี่ยนเฉพาะฝั่งซ้ายของ `-p` ตามพอร์ตบน host ที่ว่าง

## Endpoint คร่าวๆ
- POST `/game/start` สร้างเกมใหม่
- GET `/game/reveal` เปิดไพ่ตามตำแหน่ง (ใช้ deck_token)
- POST `/score/submit` ส่งคะแนน
- GET `/score/last` ดูคะแนนล่าสุดของอุปกรณ์
- GET `/leaderboard/top3` อันดับคะแนนต้นๆ

## โครงสร้างโปรเจกต์
```
prisma/schema.prisma   # Prisma schema
src/server.js          # โค้ดหลักของ Express API
```

## หมายเหตุด้านความปลอดภัย
- เปลี่ยนค่า `SECRET_KEY` ให้มีความยาวและสุ่มอย่างเพียงพอใน production
- เก็บ `.env` นอกระบบควบคุมเวอร์ชัน และใช้ secret manager ใน production


