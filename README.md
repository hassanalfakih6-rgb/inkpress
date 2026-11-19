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

## What's in v2

**Pages**
- **Dashboard** — orders report (Total Orders, In Progress, Completed, Received, Canceled, Total Sales), performance by Far Delivery / Local Delivery / Pickup, and for admins: sales, expenses, net, cash in drawer, Whish (mobile money), money held by delivery companies (with **Settle** and **Add delivery company** buttons), expenses and balance adjustments. Filter by today / week / month / year / all time.
- **Order Intake** — every new order lands here, sorted by date. Admins set priority (Normal / High / Urgent), add notes, assign to one designer, to themselves, or to **all designers**, edit or delete permanently. Designers can only take an intake order for themselves.
- **In Progress** — everyone sees every order; designers see **My orders** by default and can filter by designer or priority. Orders sent to all designers appear first under **Orders to be claimed** until someone claims them. Mark as done → Completed, Cancel → Canceled. Admin-only **Edit** changes absolutely everything.
- **Hand-offs** — a designer can take an order from another designer directly, but sending their own order to someone else needs admin approval in **Approvals**.
- **Logistics** — read-only: order number, client name, number and total in USD, filtered by delivery type, with **Print invoice** and (admin) **Mark as received**.
- **Completed / Canceled** — undo, restore, print and edit for admins.
- **Clients** — every client who ordered, searchable by name or number, with order count, open orders, total spent and full history. Built automatically from orders (phone number is the key); the order form recognises returning clients.
- **Settings (admin)** — team & logins (add, edit, reset password, delete designers/admins), staff analytics (completed orders and revenue per designer, with chart), product types (shown as a dropdown on every order), delivery companies, and invoice printing (business details, footer, A4 / A5 / 80 mm receipt, copies).
- Everyone can change their own password from the sidebar.

**How money is counted**
- Money paid at the shop (Paid or Down Payment) goes to Cash or Whish, depending on the order's payment method.
- When a Pickup (or own-driver delivery) order is marked Received, the remaining balance is recorded as paid.
- When an order that uses a delivery company is marked Received, the balance counts as **held by that company** until an admin clicks **Settle**, which moves it into Cash or Whish.
- Expenses come out of Cash or Whish; adjustments (for example an opening balance) can be positive or negative.
- Total Sales = value of completed and received orders. Canceled orders are excluded everywhere.

## Roles

| Action | Designer | Admin |
| --- | --- | --- |
| Create orders (go to Intake) | ✓ | ✓ |
| Take an intake order / claim an order sent to everyone | ✓ (for themselves) | ✓ |
| Assign to a specific designer or to all designers | | ✓ |
| Set priority, edit any field, delete | | ✓ |
| Take an order from another designer | ✓ | ✓ |
| Send own order to another designer | needs admin approval | ✓ directly |
| Mark done / cancel | own orders | any |
| Undo, restore, mark received, settle, expenses, settings | | ✓ |

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

Run the permission tests with `npm test`.

## Upgrading an existing database

Two migrations ship with v2 (`20261119000000_intake_status`, `20261119000100_workflow_finance_clients`). `npx prisma migrate deploy` (already part of the Render pre-deploy command) applies them. Existing orders keep their status, get order numbers starting at #1001 by creation date, and the client database is built from their phone numbers. Fully paid and received orders count as paid. Down payments recorded before v2 had no amount, so edit those orders if you want the cash figures to be exact.

## API overview

All routes except health and login require a signed-in user. (A) = admin only.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /api/orders?view=intake\|progress\|logistics\|completed\|canceled\|all | List orders |
| GET | /api/orders/counts | Badge counts |
| POST | /api/orders | Create (always Intake) |
| PATCH | /api/orders/:id (A) | Edit everything |
| PATCH | /api/orders/:id/priority (A) | Set priority |
| DELETE | /api/orders/:id (A) | Delete permanently |
| POST | /api/orders/:id/claim | Take intake / open order |
| POST | /api/orders/:id/assign (A) | `{userId}` or `{all:true}` |
| POST | /api/orders/:id/reassign | `{userId}` — direct or approval request |
| PATCH | /api/orders/:id/status | DONE / CANCELED (assignee or admin), IN_PROGRESS (A) |
| PATCH | /api/orders/:id/received (A) | Done → Received |
| GET | /api/orders/:id/invoice | Invoice data + print settings |
| GET/POST | /api/transfers, /api/transfers/:id/approve\|reject (A) | Hand-off approvals |
| GET | /api/users/team | Team list |
| GET/POST/PATCH/DELETE | /api/users (A) | Designers and logins |
| GET/POST/DELETE | /api/catalog/product-types, /api/catalog/delivery-companies | Lists (manage: A) |
| GET | /api/clients?q=, /api/clients/lookup?phone=, /api/clients/:id | Client database |
| GET | /api/finance/summary?from=&to= | Dashboard (money parts: A) |
| GET/POST/DELETE | /api/finance/entries (A) | Expenses & adjustments |
| POST | /api/finance/settle/:companyId (A) | Settle a delivery company |
| GET | /api/finance/staff (A) | Staff analytics |
| GET/PUT | /api/finance/print-settings | Printing settings (save: A) |

## Deploy to Render

The included `render.yaml` is a Render Blueprint that provisions a PostgreSQL database and a Node web service.

1. Push the project to GitHub.
2. In Render, choose **New + → Blueprint** and connect the repository.
3. Render reads `render.yaml` and proposes the database and web service.
4. When prompted, enter `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` (at least 12 characters). `JWT_SECRET` is generated by Render. Confirm the resources.
5. Wait for the build and deploy. The pre-deploy command applies migrations and seeds the first admin. The service health check uses `/api/health`.
6. Open the generated `https://...onrender.com` URL and sign in with the admin credentials you configured.
7. Create designer logins from Settings → Team & logins. Do not share the admin login with staff.

**Important:** Render plan availability and pricing can change. Review the plan and database storage/backup options in Render before confirming. For a production business system, enable appropriate database backups and keep a separate copy of critical business data.

## Security and operational notes

- Passwords are hashed with bcrypt; the raw password is never stored.
- The JWT is in an HttpOnly, SameSite=Strict cookie, not localStorage.
- Login attempts are rate-limited; Helmet sets common security headers.
- Server-side authorization protects status-changing routes. Hiding buttons in the UI is not the security boundary.
- The admin seed uses `upsert` and does not overwrite an existing admin password. To change an existing admin password, use a dedicated password-reset workflow or update the account securely; changing `ADMIN_PASSWORD` after the first seed does not rotate it.
- All amounts are in USD.
- Tailwind and Chart.js are loaded from CDNs in this starter. For a stricter offline / supply-chain-controlled production build, install and bundle these assets locally.
- Add HTTPS (Render provides it), keep dependencies updated, and periodically test database restore procedures.
