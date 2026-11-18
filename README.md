# Inkpress Order Manager

A standalone order and logistics application for a printing press / graphic design business.

## Stack

- Node.js 20+ and Express 5
- PostgreSQL
- Prisma ORM and versioned SQL migrations
- Vanilla JavaScript frontend with Tailwind CSS utility classes
- Chart.js for staff analytics
- bcrypt password hashing, JWT in an HttpOnly cookie, Helmet, and login rate limiting

The browser UI is served by the same Express application as the API, so the deployment is same-origin and does not need a separate frontend host or CORS configuration.

## Included features

- Admin and Staff roles
- Admin-only lifecycle changes (Done, Canceled, Undo, Received)
- Staff can create orders and edit order details, but cannot change order status
- In Progress, Logistics, Completed, Canceled, and Admin-only Staff Analytics views
- Logistics includes Delivery / Local Delivery / Pick up orders until the order reaches Received
- Mark as Received atomically changes both `status` and `receivingMethod`
- Search, sorting, responsive layout, and order entry/edit modal
- Admin can create staff accounts from the API (see below)

## Directory structure

```text
inkpress/
├── prisma/
│   ├── migrations/
│   │   ├── migration_lock.toml
│   │   └── 20261118000000_init/migration.sql
│   ├── schema.prisma
│   └── seed.js
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   ├── db.js
│   ├── validation.js
│   ├── middleware/auth.js
│   └── routes/
│       ├── auth.js
│       └── orders.js
├── .env.example
├── .gitignore
├── package.json
├── render.yaml
├── server.js
└── README.md
```

## Data model

The Prisma schema creates:

- `User`: UUID, name, unique email, bcrypt password hash, role
- `Order`: UUID, date, staff/labor name, customer, phone, details, decimal price, payment state, receiving method, payment method, status, timestamps, and optional link to the staff user who entered it

Database enums are stored as:
- `Role`: `ADMIN`, `STAFF`
- `PaymentDetail`: `PAID`, `NOT_PAID`, `DOWN_PAYMENT`
- `ReceivingMethod`: `DELIVERY`, `LOCAL_DELIVERY`, `PICK_UP`, `RECEIVED`
- `OrderStatus`: `IN_PROGRESS`, `DONE`, `CANCELED`, `RECEIVED`

The interface displays friendly labels. Price is a PostgreSQL `DECIMAL(12,2)`, not a floating-point database value.

## Run locally

Requirements: Node.js 20+ and PostgreSQL 14+.

1. Create a PostgreSQL database, for example:

   ```sql
   CREATE DATABASE inkpress;
   ```

2. Copy `.env.example` to `.env` and edit the values:

   ```bash
   cp .env.example .env
   ```

   Set `DATABASE_URL` to your local PostgreSQL connection string. Set `JWT_SECRET` to a long random value (at least 32 characters). Set a strong `ADMIN_PASSWORD` of at least 12 characters.

3. Install and initialize:

   ```bash
   npm install
   npx prisma generate
   npx prisma migrate deploy
   npm run seed
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000` and sign in using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`.

For local schema development after changing `prisma/schema.prisma`, run `npx prisma migrate dev --name describe_change`, then commit the generated migration folder.

## API overview

All order routes except the health check require a signed-in user.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | Public | Render health check |
| POST | `/api/auth/login` | Public | Sign in |
| POST | `/api/auth/logout` | Signed in | Clear session cookie |
| GET | `/api/auth/me` | Signed in | Current user |
| POST | `/api/auth/staff` | Admin | Create a staff account |
| GET | `/api/orders?view=progress` | Signed in | List a view (`progress`, `logistics`, `done`, `canceled`, `received`, `all`) |
| POST | `/api/orders` | Signed in | Create order; status is always `IN_PROGRESS` |
| PATCH | `/api/orders/:id` | Signed in | Edit order fields; status cannot be supplied |
| PATCH | `/api/orders/:id/status` | Admin | `DONE`, `CANCELED`, or `IN_PROGRESS` (undo) |
| PATCH | `/api/orders/:id/received` | Admin | Only a Done order; sets status and receiving method to `RECEIVED` |
| GET | `/api/orders/analytics/staff` | Admin | Done/canceled counts by labor name |

Example admin-only staff creation request (send while signed in; cookie is automatically used by same-origin browser clients):

```http
POST /api/auth/staff
Content-Type: application/json

{
  "name": "Designer One",
  "email": "designer@inkpress.com",
  "password": "Use-A-Strong-Unique-Password"
}
```

## Push to GitHub

1. Create a new **private** GitHub repository, e.g. `inkpress-order-manager`.
2. In this project folder, initialize Git and push:

   ```bash
   git init
   git add .
   git commit -m "Initial Inkpress order manager"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/inkpress-order-manager.git
   git push -u origin main
   ```

3. Do not commit `.env`; it is excluded by `.gitignore`. Never place database passwords, JWT secrets, or real staff credentials in source control.

## Deploy to Render

The included `render.yaml` is a Render Blueprint that provisions a PostgreSQL database and a Node web service.

1. Push the project to GitHub.
2. In Render, choose **New + → Blueprint** and connect the repository.
3. Render reads `render.yaml` and proposes the database and web service.
4. When prompted, enter `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` (at least 12 characters). `JWT_SECRET` is generated by Render. Confirm the resources.
5. Wait for the build and deploy. The pre-deploy command applies migrations and seeds the first admin. The service health check uses `/api/health`.
6. Open the generated `https://...onrender.com` URL and sign in with the admin credentials you configured.
7. Create staff accounts through the admin-only API endpoint described above. Do not share the admin login with staff.

**Important:** Render plan availability and pricing can change. Review the plan and database storage/backup options in Render before confirming. For a production business system, enable appropriate database backups and keep a separate copy of critical business data.

## Security and operational notes

- Passwords are hashed with bcrypt; the raw password is never stored.
- The JWT is in an HttpOnly, SameSite=Strict cookie, not localStorage.
- Login attempts are rate-limited; Helmet sets common security headers.
- Server-side authorization protects status-changing routes. Hiding buttons in the UI is not the security boundary.
- The admin seed uses `upsert` and does not overwrite an existing admin password. To change an existing admin password, use a dedicated password-reset workflow or update the account securely; changing `ADMIN_PASSWORD` after the first seed does not rotate it.
- The app currently assumes a single business currency and displays the numeric price without a currency symbol. Add your preferred currency label (for example USD or LBP) before using it operationally.
- Tailwind and Chart.js are loaded from CDNs in this starter. For a stricter offline / supply-chain-controlled production build, install and bundle these assets locally.
- Add HTTPS (Render provides it), keep dependencies updated, and periodically test database restore procedures.

## Before going live

- Change the seeded admin password to a unique strong password.
- Confirm the Render database plan, backups, and retention meet your business needs.
- Decide the business currency and add its display label.
- Test Staff and Admin accounts separately, especially status permissions and the Received workflow.
- Confirm whether staff should be allowed to edit all orders or only orders they created. The current implementation allows signed-in staff to edit any order's details, as requested.
