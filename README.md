# Tripwallet

Tripwallet is a responsive travel-expense app for keeping trip dates, transport details, hotel information, and day-to-day expenses together. The first release supports domestic travel in India; international travel has a separate entry point but is not enabled for expense recording yet. All travel expense amounts are displayed in Indian rupees (₹).

## Features

- Create an account, sign in, and keep each traveller's records private.
- Choose domestic or international travel after signing in.
- Create and update domestic trips with destination, dates, transport mode, and notes.
- Browse domestic trips in chronological departure-date order.
- Select an Indian state or union territory from the trip form and see whether trips are upcoming, in progress, or completed.
- View trip dates highlighted on a navigable calendar.
- Save, update, and delete hotel stays, booking details, and the amount paid.
- Record, update, and delete transport legs with mode-specific details and fare amounts for cars, two-wheelers, flights, trains, buses, taxis, and other transport.
- View saved hotel, transport, and expense records before opening their nested add/edit forms.
- Record and edit dated food, fuel, transport, and other expenses in INR.
- See hotel, food, fuel, transport, and other amounts inside each trip card.
- Review annual travel reports with category totals and per-trip breakdowns.
- View trip totals that include hotel payments and other expenses, and use the app on mobile or install it as a progressive web app.

Local development stores trip records in SQLite. Production uses PostgreSQL when `DATABASE_URL` is set; expense amounts are stored as integer paise to avoid floating-point currency totals. Hotel stays and expenses must fall within the trip dates.

## Requirements

- Node.js 22.13 or newer (uses the built-in `node:sqlite` module).
- npm.

## Run locally

```sh
npm install
npm run dev
```

Open `http://localhost:3001`. Local development enables account registration by default. The SQLite database is created at `data/travel-expense.sqlite`.

To configure the server, copy `.env.example` to `.env` and set:

- `PORT` — HTTP port (default `3001`).
- `DB_PATH` — SQLite database path for local development (default `data/travel-expense.sqlite`).
- `DATABASE_URL` — PostgreSQL connection URL; required in production and supplied by Neon.
- `ALLOW_REGISTRATION` — set to `false` to disable new accounts.
- `NODE_ENV` — set to `production` to enable secure session cookies and HSTS.

## Deploy to Render

The repository includes a `render.yaml` Blueprint for the Tripwallet web service. It runs on Node.js 22.13, uses `/api/config` for health checks, and connects to Neon PostgreSQL through the `DATABASE_URL` environment variable. The app automatically creates its PostgreSQL tables when it starts. The Render web service uses the paid Starter plan; the application database is managed separately by Neon.

1. Create a PostgreSQL project in [Neon](https://console.neon.tech), selecting the Singapore (`aws-ap-southeast-1`) region to keep it close to the Render service.
2. In Neon, open **Connect**, select the project's branch, database, and role, and copy the pooled connection string. Keep the password private.
3. Push this repository, including `render.yaml`, to GitHub.
4. In the [Render Dashboard](https://dashboard.render.com), choose **New** → **Blueprint** and connect the GitHub repository.
5. When prompted for `DATABASE_URL`, paste the Neon connection string. Review the service settings and create the Blueprint.
6. Wait for the deploy and confirm the service is healthy. Open the `onrender.com` URL shown in the service overview and create an account.
7. To disable public account creation after setting up accounts, change `ALLOW_REGISTRATION` to `false` in the service's environment settings and redeploy.

Local SQLite data is not copied into Neon automatically. Neon starts with a fresh production database unless you separately migrate existing records.

## Tests

```sh
npm test
```

The API integration test uses a temporary SQLite database and verifies authentication, per-user trip access, trip and hotel updates, expense validation, and totals.
