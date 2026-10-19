import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { database } from './src/db.js';

const app = express();
const scrypt = promisify(crypto.scrypt);
const port = Number(process.env.PORT || 3001);
const isProduction = process.env.NODE_ENV === 'production';
const registrationEnabled = (process.env.ALLOW_REGISTRATION ?? 'true').toLowerCase() !== 'false';
const sessionCookie = 'travel_expense_session';
const sessionDuration = 30 * 24 * 60 * 60 * 1000;
const rateBuckets = new Map();
const usernamePattern = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const expenseCategories = new Set(['food', 'fuel', 'transport', 'other']);
const transportModes = new Set(['car', 'train', 'bus', 'flight', 'taxi', 'two-wheeler', 'other']);
const transportFields = {
  car: [],
  'two-wheeler': [
    { name: 'vehicleNumber', label: 'Vehicle number', max: 30 },
    { name: 'startLocation', label: 'From', max: 120, required: true },
    { name: 'endLocation', label: 'To', max: 120, required: true },
    { name: 'distanceKm', label: 'Distance (km)', numeric: true },
  ],
  flight: [
    { name: 'operator', label: 'Airline', max: 100, required: true },
    { name: 'serviceNumber', label: 'Flight number', max: 30 },
    { name: 'startLocation', label: 'Departure airport', max: 120, required: true },
    { name: 'endLocation', label: 'Arrival airport', max: 120, required: true },
    { name: 'bookingReference', label: 'PNR / booking reference', max: 40 },
  ],
  train: [
    { name: 'operator', label: 'Train name', max: 100, required: true },
    { name: 'serviceNumber', label: 'Train number', max: 30 },
    { name: 'startLocation', label: 'From station', max: 120, required: true },
    { name: 'endLocation', label: 'To station', max: 120, required: true },
    { name: 'class', label: 'Coach / class', max: 40 },
    { name: 'bookingReference', label: 'PNR', max: 20 },
  ],
  bus: [
    { name: 'operator', label: 'Bus operator', max: 100 },
    { name: 'startLocation', label: 'From', max: 120, required: true },
    { name: 'endLocation', label: 'To', max: 120, required: true },
    { name: 'bookingReference', label: 'Booking reference', max: 40 },
  ],
  taxi: [
    { name: 'operator', label: 'Taxi provider', max: 100 },
    { name: 'startLocation', label: 'Pickup location', max: 120, required: true },
    { name: 'endLocation', label: 'Drop-off location', max: 120, required: true },
    { name: 'vehicleNumber', label: 'Vehicle number', max: 30 },
  ],
  other: [
    { name: 'operator', label: 'Operator / provider', max: 100 },
    { name: 'startLocation', label: 'From', max: 120 },
    { name: 'endLocation', label: 'To', max: 120 },
    { name: 'bookingReference', label: 'Booking reference', max: 40 },
  ],
};
const dummySalt = Buffer.alloc(16, 7).toString('hex');
const dummyHash = await scrypt('not-a-real-password', dummySalt, 64);

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb', strict: true }));
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url)), { index: 'index.html', etag: true }));

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.path}:${req.ip}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) return fail(res, 429, 'Too many attempts. Please try again later.');
    next();
  };
}

const authLimiter = rateLimit(10, 15 * 60 * 1000);
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function validDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function text(value, max, { optional = false } = {}) {
  return typeof value === 'string' && value.length <= max && (optional || value.trim().length > 0);
}
function setSessionCookie(res, token) {
  const flags = [`${sessionCookie}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${sessionDuration / 1000}`];
  if (isProduction) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}
function clearSessionCookie(res) {
  const flags = [`${sessionCookie}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (isProduction) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}
function requestCookie(req) {
  for (const item of (req.headers.cookie || '').split(';')) {
    const [name, ...value] = item.trim().split('=');
    if (name === sessionCookie) return value.join('=');
  }
  return '';
}
async function requireAuth(req, res, next) {
  try {
    const token = requestCookie(req);
    if (!token) return fail(res, 401, 'Sign in to continue.');
    const session = database.prepare(`SELECT users.id, users.username
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(hashToken(token), Date.now());
    if (!session) return fail(res, 401, 'Sign in to continue.');
    req.user = session;
    next();
  } catch (error) {
    next(error);
  }
}
async function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, Date.now() + sessionDuration);
  setSessionCookie(res, token);
}
function ownsTrip(userId, tripId) {
  return Number.isSafeInteger(tripId) && database.prepare('SELECT id FROM trips WHERE id = ? AND user_id = ?').get(tripId, userId);
}
function tripData(body) {
  const { name, destinationCity, destinationState, startDate, endDate, transportMode, notes = '' } = body ?? {};
  if (!text(name, 100) || !text(destinationCity, 100) || !text(destinationState, 100)
      || !validDate(startDate) || !validDate(endDate) || endDate < startDate
      || !transportModes.has(transportMode) || !text(notes, 2000, { optional: true })) return null;
  return {
    name: name.trim(), destinationCity: destinationCity.trim(), destinationState: destinationState.trim(),
    startDate, endDate, transportMode, notes: notes.trim(),
  };
}
function stayData(body, trip) {
  const { hotelName, address = '', phone = '', bookingReference = '', checkIn, checkOut, hotelAmount = 0, notes = '' } = body ?? {};
  if (!text(hotelName, 120) || !text(address, 300, { optional: true }) || !text(phone, 40, { optional: true })
      || !text(bookingReference, 80, { optional: true }) || !validDate(checkIn) || !validDate(checkOut)
      || checkOut < checkIn || checkIn < trip.start_date || checkOut > trip.end_date
      || !Number.isFinite(hotelAmount) || hotelAmount < 0 || hotelAmount > 10_000_000
      || !text(notes, 1000, { optional: true })) return null;
  return {
    hotelName: hotelName.trim(), address: address.trim(), phone: phone.trim(), bookingReference: bookingReference.trim(),
    checkIn, checkOut, hotelAmountPaise: Math.round(hotelAmount * 100), notes: notes.trim(),
  };
}
function expenseData(body, trip) {
  const { expenseDate, category, description, amount, paymentMethod = '', notes = '' } = body ?? {};
  if (!validDate(expenseDate) || expenseDate < trip.start_date || expenseDate > trip.end_date
      || !expenseCategories.has(category) || !text(description, 160) || !Number.isFinite(amount)
      || amount <= 0 || amount > 10_000_000 || !text(paymentMethod, 40, { optional: true })
      || !text(notes, 1000, { optional: true })) return null;
  return { expenseDate, category, description: description.trim(), amountPaise: Math.round(amount * 100), paymentMethod: paymentMethod.trim(), notes: notes.trim() };
}
function transportData(body, trip) {
  const { mode, amount } = body ?? {};
  if (!transportModes.has(mode) || !Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return null;
  const date = mode === 'car' ? trip.start_date : body.transportDate;
  if (!validDate(date) || date < trip.start_date || date > trip.end_date) return null;
  const details = mode === 'car' ? {} : body.details ?? {};
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const cleanDetails = {};
  for (const field of transportFields[mode]) {
    const value = details[field.name];
    if (field.numeric) {
      if (value === '' || value === undefined || value === null) {
        if (field.required) return null;
        continue;
      }
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0 || number > 1_000_000) return null;
      cleanDetails[field.name] = number;
    } else {
      if (value === undefined && !field.required) continue;
      if (!text(value, field.max, { optional: !field.required })) return null;
      if (value.trim()) cleanDetails[field.name] = value.trim();
    }
  }
  return { transportDate: date, mode, amountPaise: Math.round(amount * 100), details: cleanDetails };
}

app.get('/api/config', (req, res) => res.json({ registrationEnabled }));
app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    if (!registrationEnabled) return fail(res, 403, 'Registration is currently disabled.');
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || !usernamePattern.test(username.toLowerCase())
        || typeof password !== 'string' || password.length < 10 || password.length > 128) {
      return fail(res, 400, 'Use a username with 3–32 letters, numbers, dots, dashes, or underscores and a password of at least 10 characters.');
    }
    const normalized = username.toLowerCase();
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = await scrypt(password, salt, 64);
    const result = database.prepare('INSERT INTO users (username, password_hash, password_salt) VALUES (?, ?, ?)').run(normalized, passwordHash.toString('hex'), salt);
    await createSession(Number(result.lastInsertRowid), res);
    res.status(201).json({ user: { id: Number(result.lastInsertRowid), username: normalized } });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail(res, 409, 'That username is already taken.');
    next(error);
  }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = usernamePattern.test(username)
      ? database.prepare('SELECT id, username, password_hash, password_salt FROM users WHERE username = ?').get(username)
      : null;
    const actual = await scrypt(password.slice(0, 128), user?.password_salt || dummySalt, 64);
    const expected = Buffer.from(user?.password_hash || dummyHash.toString('hex'), 'hex');
    if (password.length > 128 || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected) || !user) {
      return fail(res, 401, 'Invalid username or password.');
    }
    await createSession(user.id, res);
    res.json({ user: { id: user.id, username: user.username } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(requestCookie(req)));
  clearSessionCookie(res);
  res.json({ ok: true });
});

function tripSummaries(userId, startDate, endDate) {
  const dateFilter = startDate ? 'AND trips.start_date >= ? AND trips.start_date < ?' : '';
  const parameters = startDate ? [userId, startDate, endDate] : [userId];
  return database.prepare(`SELECT trips.*,
    (SELECT COUNT(*) FROM expenses WHERE expenses.trip_id = trips.id)
      + (SELECT COUNT(*) FROM transport_records WHERE transport_records.trip_id = trips.id) AS expense_count,
    COALESCE((SELECT SUM(stays.hotel_amount_paise) FROM stays WHERE stays.trip_id = trips.id), 0) AS hotel_total_paise,
    COALESCE((SELECT SUM(expenses.amount_paise) FROM expenses WHERE expenses.trip_id = trips.id AND expenses.category = 'food'), 0) AS food_total_paise,
    COALESCE((SELECT SUM(expenses.amount_paise) FROM expenses WHERE expenses.trip_id = trips.id AND expenses.category = 'fuel'), 0) AS fuel_total_paise,
    COALESCE((SELECT SUM(expenses.amount_paise) FROM expenses WHERE expenses.trip_id = trips.id AND expenses.category = 'transport'), 0)
      + COALESCE((SELECT SUM(transport_records.amount_paise) FROM transport_records WHERE transport_records.trip_id = trips.id), 0) AS transport_total_paise,
    COALESCE((SELECT SUM(expenses.amount_paise) FROM expenses WHERE expenses.trip_id = trips.id AND expenses.category = 'other'), 0) AS other_total_paise,
    COALESCE((SELECT SUM(expenses.amount_paise) FROM expenses WHERE expenses.trip_id = trips.id), 0)
      + COALESCE((SELECT SUM(stays.hotel_amount_paise) FROM stays WHERE stays.trip_id = trips.id), 0)
      + COALESCE((SELECT SUM(transport_records.amount_paise) FROM transport_records WHERE transport_records.trip_id = trips.id), 0) AS total_paise
    FROM trips
    WHERE trips.user_id = ? ${dateFilter}
      ORDER BY trips.start_date ASC, trips.id ASC`).all(...parameters);
}

app.get('/api/trips', requireAuth, (req, res) => {
  res.json({ trips: tripSummaries(req.user.id) });
});

app.get('/api/reports/annual', requireAuth, (req, res) => {
  const year = req.query.year;
  if (typeof year !== 'string' || !/^\d{4}$/.test(year) || Number(year) < 1900) {
    return fail(res, 400, 'Choose a valid report year.');
  }
  const trips = tripSummaries(req.user.id, `${year}-01-01`, `${String(Number(year) + 1).padStart(4, '0')}-01-01`);
  const totals = trips.reduce((result, trip) => {
    result.hotel_paise += trip.hotel_total_paise;
    result.food_paise += trip.food_total_paise;
    result.fuel_paise += trip.fuel_total_paise;
    result.transport_paise += trip.transport_total_paise;
    result.other_paise += trip.other_total_paise;
    result.total_paise += trip.total_paise;
    return result;
  }, { hotel_paise: 0, food_paise: 0, fuel_paise: 0, transport_paise: 0, other_paise: 0, total_paise: 0 });
  res.json({ year: Number(year), totals, trips });
});

app.post('/api/trips', requireAuth, (req, res) => {
  if (req.body?.travelType === 'international') return fail(res, 409, 'International travel is coming in a future release.');
  if (req.body?.travelType !== 'domestic') return fail(res, 400, 'Choose domestic travel to create a trip.');
  const trip = tripData(req.body);
  if (!trip) return fail(res, 400, 'Please check the trip name, dates, destination, and transport mode.');
  const result = database.prepare(`INSERT INTO trips
    (user_id, travel_type, name, destination_city, destination_state, start_date, end_date, transport_mode, notes)
    VALUES (?, 'domestic', ?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, trip.name, trip.destinationCity, trip.destinationState, trip.startDate, trip.endDate, trip.transportMode, trip.notes);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.get('/api/trips/:tripId', requireAuth, (req, res) => {
  const trip = ownsTrip(req.user.id, Number(req.params.tripId));
  if (!trip) return fail(res, 404, 'Trip not found.');
  const tripDetails = database.prepare('SELECT * FROM trips WHERE id = ?').get(Number(req.params.tripId));
  const stays = database.prepare('SELECT * FROM stays WHERE trip_id = ? ORDER BY check_in, id').all(trip.id);
  const expenses = database.prepare('SELECT * FROM expenses WHERE trip_id = ? ORDER BY expense_date DESC, id DESC').all(trip.id);
  const transports = database.prepare('SELECT * FROM transport_records WHERE trip_id = ? ORDER BY transport_date DESC, id DESC')
    .all(trip.id).map((item) => ({ ...item, details: JSON.parse(item.details_json) }));
  res.json({ trip: tripDetails, stays, expenses, transports });
});

app.put('/api/trips/:tripId', requireAuth, (req, res) => {
  const tripId = Number(req.params.tripId);
  const existing = ownsTrip(req.user.id, tripId) && database.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
  if (!existing) return fail(res, 404, 'Trip not found.');
  const trip = tripData(req.body);
  if (!trip) return fail(res, 400, 'Please check the trip name, dates, destination, and transport mode.');
  const outsideStay = database.prepare('SELECT 1 FROM stays WHERE trip_id = ? AND (check_in < ? OR check_out > ?) LIMIT 1').get(tripId, trip.startDate, trip.endDate);
  const outsideExpense = database.prepare('SELECT 1 FROM expenses WHERE trip_id = ? AND (expense_date < ? OR expense_date > ?) LIMIT 1').get(tripId, trip.startDate, trip.endDate);
  const outsideTransport = database.prepare('SELECT 1 FROM transport_records WHERE trip_id = ? AND (transport_date < ? OR transport_date > ?) LIMIT 1')
    .get(tripId, trip.startDate, trip.endDate);
  if (outsideStay || outsideExpense || outsideTransport) return fail(res, 409, 'The new travel dates must include all existing hotel stays, transport records, and expenses. Update or remove entries first.');
  database.prepare(`UPDATE trips SET name = ?, destination_city = ?, destination_state = ?, start_date = ?,
    end_date = ?, transport_mode = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(trip.name, trip.destinationCity, trip.destinationState, trip.startDate, trip.endDate, trip.transportMode, trip.notes, tripId);
  res.json({ ok: true });
});

app.delete('/api/trips/:tripId', requireAuth, (req, res) => {
  const result = database.prepare('DELETE FROM trips WHERE id = ? AND user_id = ?').run(Number(req.params.tripId), req.user.id);
  if (!result.changes) return fail(res, 404, 'Trip not found.');
  res.json({ ok: true });
});

app.post('/api/trips/:tripId/stays', requireAuth, (req, res) => {
  const trip = ownsTrip(req.user.id, Number(req.params.tripId)) && database.prepare('SELECT * FROM trips WHERE id = ?').get(Number(req.params.tripId));
  if (!trip) return fail(res, 404, 'Trip not found.');
  const stay = stayData(req.body, trip);
  if (!stay) return fail(res, 400, 'Please check the hotel details and dates; the stay must fall within this trip.');
  const result = database.prepare(`INSERT INTO stays
    (trip_id, hotel_name, address, phone, booking_reference, check_in, check_out, hotel_amount_paise, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    trip.id, stay.hotelName, stay.address, stay.phone, stay.bookingReference, stay.checkIn, stay.checkOut, stay.hotelAmountPaise, stay.notes,
  );
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.put('/api/trips/:tripId/stays/:stayId', requireAuth, (req, res) => {
  const tripId = Number(req.params.tripId);
  const trip = ownsTrip(req.user.id, tripId) && database.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
  if (!trip) return fail(res, 404, 'Trip not found.');
  const stayId = Number(req.params.stayId);
  const existing = database.prepare('SELECT id FROM stays WHERE id = ? AND trip_id = ?').get(stayId, tripId);
  if (!existing) return fail(res, 404, 'Hotel stay not found.');
  const stay = stayData(req.body, trip);
  if (!stay) return fail(res, 400, 'Please check the hotel details and dates; the stay must fall within this trip.');
  database.prepare(`UPDATE stays SET hotel_name = ?, address = ?, phone = ?, booking_reference = ?,
    check_in = ?, check_out = ?, hotel_amount_paise = ?, notes = ? WHERE id = ? AND trip_id = ?`)
    .run(stay.hotelName, stay.address, stay.phone, stay.bookingReference, stay.checkIn, stay.checkOut, stay.hotelAmountPaise, stay.notes, stayId, tripId);
  res.json({ ok: true });
});

app.delete('/api/trips/:tripId/stays/:stayId', requireAuth, (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!ownsTrip(req.user.id, tripId)) return fail(res, 404, 'Trip not found.');
  const result = database.prepare('DELETE FROM stays WHERE id = ? AND trip_id = ?').run(Number(req.params.stayId), tripId);
  if (!result.changes) return fail(res, 404, 'Hotel stay not found.');
  res.json({ ok: true });
});

app.post('/api/trips/:tripId/expenses', requireAuth, (req, res) => {
  const tripId = Number(req.params.tripId);
  const trip = ownsTrip(req.user.id, tripId) && database.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
  if (!trip) return fail(res, 404, 'Trip not found.');
  const expense = expenseData(req.body, trip);
  if (!expense) return fail(res, 400, 'Please check the expense amount, category, and travel date.');
  const result = database.prepare(`INSERT INTO expenses
    (trip_id, expense_date, category, description, amount_paise, payment_method, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(tripId, expense.expenseDate, expense.category, expense.description, expense.amountPaise, expense.paymentMethod, expense.notes);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.put('/api/trips/:tripId/expenses/:expenseId', requireAuth, (req, res) => {
  const tripId = Number(req.params.tripId);
  const trip = ownsTrip(req.user.id, tripId) && database.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
  if (!trip) return fail(res, 404, 'Trip not found.');
  const expenseId = Number(req.params.expenseId);
  if (!database.prepare('SELECT id FROM expenses WHERE id = ? AND trip_id = ?').get(expenseId, tripId)) return fail(res, 404, 'Expense not found.');
  const expense = expenseData(req.body, trip);
  if (!expense) return fail(res, 400, 'Please check the expense amount, category, and travel date.');
  database.prepare(`UPDATE expenses SET expense_date = ?, category = ?, description = ?, amount_paise = ?,
    payment_method = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND trip_id = ?`)
    .run(expense.expenseDate, expense.category, expense.description, expense.amountPaise, expense.paymentMethod, expense.notes, expenseId, tripId);
  res.json({ ok: true });
});

app.delete('/api/trips/:tripId/expenses/:expenseId', requireAuth, (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!ownsTrip(req.user.id, tripId)) return fail(res, 404, 'Trip not found.');
  const result = database.prepare('DELETE FROM expenses WHERE id = ? AND trip_id = ?').run(Number(req.params.expenseId), tripId);
  if (!result.changes) return fail(res, 404, 'Expense not found.');
  res.json({ ok: true });
});

app.post('/api/trips/:tripId/transports', requireAuth, (req, res) => {
  const tripId = Number(req.params.tripId);
  const trip = ownsTrip(req.user.id, tripId) && database.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
  if (!trip) return fail(res, 404, 'Trip not found.');
  const transport = transportData(req.body, trip);
  if (!transport) return fail(res, 400, 'Please check the transport mode, required travel details, amount, and date.');
  const result = database.prepare(`INSERT INTO transport_records (trip_id, transport_date, mode, amount_paise, details_json)
    VALUES (?, ?, ?, ?, ?)`).run(
    tripId, transport.transportDate, transport.mode, transport.amountPaise, JSON.stringify(transport.details),
  );
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.put('/api/trips/:tripId/transports/:transportId', requireAuth, (req, res) => {
  const tripId = Number(req.params.tripId);
  const trip = ownsTrip(req.user.id, tripId) && database.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
  if (!trip) return fail(res, 404, 'Trip not found.');
  const transportId = Number(req.params.transportId);
  if (!database.prepare('SELECT id FROM transport_records WHERE id = ? AND trip_id = ?').get(transportId, tripId)) {
    return fail(res, 404, 'Transport record not found.');
  }
  const transport = transportData(req.body, trip);
  if (!transport) return fail(res, 400, 'Please check the transport mode, required travel details, amount, and date.');
  database.prepare(`UPDATE transport_records SET transport_date = ?, mode = ?, amount_paise = ?, details_json = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND trip_id = ?`)
    .run(transport.transportDate, transport.mode, transport.amountPaise, JSON.stringify(transport.details), transportId, tripId);
  res.json({ ok: true });
});

app.delete('/api/trips/:tripId/transports/:transportId', requireAuth, (req, res) => {
  const tripId = Number(req.params.tripId);
  if (!ownsTrip(req.user.id, tripId)) return fail(res, 404, 'Trip not found.');
  const result = database.prepare('DELETE FROM transport_records WHERE id = ? AND trip_id = ?')
    .run(Number(req.params.transportId), tripId);
  if (!result.changes) return fail(res, 404, 'Transport record not found.');
  res.json({ ok: true });
});

app.use('/api', (req, res) => fail(res, 404, 'API route not found.'));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.status === 413) return fail(res, 413, 'Request body must be 20 KB or smaller.');
  if (error.status === 400 && error.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON body.');
  console.error(error);
  return fail(res, 500, 'Something went wrong. Please try again.');
});

const cleanup = setInterval(() => {
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}, 60 * 60 * 1000);
cleanup.unref();
app.listen(port, () => console.log(`Travel Expense listening on port ${port}`));
